/**
 * Given three nodes in one Project, an opted-in Agent discovers its controller and siblings,
 * distinguishes duplicate ids, and reads only enabled skills without reading workspace data.
 * With the switch missing or off, no peer or controller catalog is queried. Disconnecting
 * removes the controller and pending queries; malformed or foreign-Project replies are refused.
 * The real config and relay API enforce Project access, admin-only controller connections,
 * lease-scoped replies, and persistence of the independent Agent switch.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { installSkill, setSkillEnabled, systemConfigPath } from "@prismshadow/penguin-core";
import type { GlobalAgentCatalog } from "@prismshadow/penguin-core";
import type { AgentConfigResponse } from "../src/api/types.js";
import { AgentDirectoryService } from "../src/services/agent-directory.js";
import type { DirectoryQuery, DirectoryTarget } from "../src/services/agent-directory.js";
import {
  apiClient,
  createTestApp,
  loginAdmin,
  makeTempRoot,
  provisionUser,
  removeTempRoot,
} from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("Project discovery across a controller and two peers", () => {
  let root: string;
  let hub: AgentDirectoryService, left: AgentDirectoryService, right: AgentDirectoryService;
  let reads = 0;
  const detach: Array<() => void> = [];
  const P = "shared";
  async function write(node: string, id: string, enabled?: boolean, description = id) {
    const file = systemConfigPath(path.join(root, node), P, id);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({
        system_prompt: "Do the task",
        name: id,
        description,
        ...(enabled === undefined ? {} : { global_agent_discovery: enabled }),
      }),
    );
  }
  beforeAll(async () => {
    root = await makeTempRoot();
    for (const node of ["hub", "left", "right"]) await write(node, "writer");
    const foreign = systemConfigPath(path.join(root, "right"), "private", "hidden");
    await fs.mkdir(path.dirname(foreign), { recursive: true });
    await fs.writeFile(
      foreign,
      JSON.stringify({ system_prompt: "private", description: "private-role" }),
    );
    await fs.writeFile(path.join(root, "workspace.txt"), "workspace must stay unchanged");
    await installSkill(path.join(root, "right"), P, "writer", {
      name: "enabled",
      content: "---\nname: enabled\n---\n",
    });
    await installSkill(path.join(root, "right"), P, "writer", {
      name: "disabled",
      content: "---\nname: disabled\n---\n",
    });
    await setSkillEnabled(path.join(root, "right"), P, "writer", "disabled", false);
    const leaf = (name: string) => ({
      local: () => ({ nodeId: name, nodeName: name }),
      peers: () => [],
      read: async () => {
        throw new Error("no peers");
      },
    });
    left = new AgentDirectoryService(path.join(root, "left"), leaf("left"));
    right = new AgentDirectoryService(path.join(root, "right"), leaf("right"));
    hub = new AgentDirectoryService(path.join(root, "hub"), {
      local: () => ({ nodeId: "hub", nodeName: "hub" }),
      peers: (projectId) =>
        projectId === P
          ? [
              { nodeId: "left", nodeName: "left" },
              { nodeId: "right", nodeName: "right" },
            ]
          : [],
      read: async (nodeId, projectId, agentId) => {
        reads++;
        return (nodeId === "left" ? left : right).local(projectId, agentId);
      },
    });
    for (const node of [left, right])
      detach.push(
        node.relay(P, "hub").subscribe((event) => {
          if (event.event !== "agent_discovery_query") return;
          const query = JSON.parse(event.data) as DirectoryQuery;
          void hub
            .aggregate(P, query)
            .then((catalog) => node.answer(P, query.leaseId, query.requestId, catalog));
        }),
      );
  });
  afterAll(async () => {
    for (const stop of detach) stop();
    hub.close();
    left.close();
    right.close();
    await removeTempRoot(root);
  });

  it("keeps missing and disabled switches local without asking any controller", async () => {
    const before = reads;
    const missing = await left.forAgent(P, "writer");
    expect(missing.agents.map((agent) => agent.nodeId)).toEqual(["left"]);
    await write("left", "writer", false);
    const off = await left.forAgent(P, "writer");
    expect(off.agents.map((agent) => agent.nodeId)).toEqual(["left"]);
    await expect(
      left.forAgent(P, "writer", { nodeId: "right", agentId: "writer" }),
    ).rejects.toThrow("disabled");
    expect(reads).toBe(before);
  });

  it("discovers sibling roles in the same Project with node-qualified duplicate ids", async () => {
    await write("left", "writer", true);
    await write("right", "writer", undefined, "Reviews the selected code");
    const catalog = await left.forAgent(P, "writer");
    expect(catalog.agents.map((agent) => [agent.nodeId, agent.agentId])).toEqual([
      ["hub", "writer"],
      ["left", "writer"],
      ["right", "writer"],
    ]);
    expect(catalog.agents.find((agent) => agent.nodeId === "right")).toMatchObject({
      description: "Reviews the selected code",
      local: false,
      canDelegate: true,
    });
    expect(catalog.agents.find((agent) => agent.nodeId === "left")!.canDelegate).toBe(true);
    expect(JSON.stringify(catalog)).not.toContain("private-role");
    expect(await fs.readFile(path.join(root, "workspace.txt"), "utf8")).toBe(
      "workspace must stay unchanged",
    );
  });

  it("inspects a remote Agent's enabled skills while unqualified ids stay local", async () => {
    const remote = await left.forAgent(P, "writer", { nodeId: "right", agentId: "writer" });
    expect(remote.agents).toHaveLength(1);
    expect(remote.agents[0]!.skills).toEqual(["enabled"]);
    const local = await left.forAgent(P, "writer", { agentId: "writer" });
    expect(local.agents.map((agent) => agent.nodeId)).toEqual(["left"]);
    expect(await fs.readFile(path.join(root, "workspace.txt"), "utf8")).toBe(
      "workspace must stay unchanged",
    );
  });

  it("keeps local discovery available after the controller disconnects", async () => {
    detach[0]!();
    const catalog = await left.forAgent(P, "writer");
    expect(catalog.agents.map((agent) => agent.nodeId)).toEqual(["left"]);
  });

  it("bounds a stalled peer read while preserving the local roster", async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const service = new AgentDirectoryService(path.join(root, "left"), {
      local: () => ({ nodeId: "left", nodeName: "left" }),
      peers: () => [{ nodeId: "stalled", nodeName: "stalled" }],
      read: () => {
        started();
        return new Promise(() => {});
      },
    });
    vi.useFakeTimers();
    try {
      const pending = service.discover(P);
      await ready;
      await vi.advanceTimersByTimeAsync(5001);
      const result = await pending;
      expect(result.agents.map((agent) => agent.nodeId)).toEqual(["left"]);
      expect(result.unavailableNodes.map((node) => node.nodeId)).toEqual(["stalled"]);
    } finally {
      vi.useRealTimers();
      service.close();
    }
  });

  it("rejects outstanding queries when their controller lease closes", async () => {
    const service = new AgentDirectoryService(path.join(root, "left"), {
      local: () => ({ nodeId: "left", nodeName: "left" }),
      peers: () => [],
      read: async () => {
        throw new Error("no peers");
      },
    });
    let observed!: (query: DirectoryQuery) => void;
    const request = new Promise<DirectoryQuery>((resolve) => {
      observed = resolve;
    });
    const stop = service.relay(P, "stalled").subscribe((event) => {
      if (event.event === "agent_discovery_query") observed(JSON.parse(event.data));
    });
    const pending = service.discover(P);
    const query = await request;
    expect(service.answer(P, "wrong", query.requestId, {})).toBe(false);
    stop();
    const result = await pending;
    expect(result.agents.map((agent) => agent.nodeId)).toEqual(["left"]);
    expect(result.unavailableNodes.map((node) => node.nodeId)).toEqual(["stalled"]);
    expect(service.answer(P, query.leaseId, query.requestId, {})).toBe(false);
    service.close();
  });
});

describe("Agent config and directory relay API", () => {
  let app: TestApp;
  let admin: ReturnType<typeof apiClient>, member: ReturnType<typeof apiClient>;
  let privateProject: string;
  const prefix = "/api/projects/default_project/agent-discovery";
  const configPath = "/api/projects/default_project/agents/default_agent/config";
  beforeAll(async () => {
    app = await createTestApp();
    admin = apiClient(app.app, (await loginAdmin(app.app)).cookie);
    member = apiClient(app.app, (await provisionUser(app.app, "directory_user")).cookie);
    const listed = (await (await member.get("/api/projects")).json()) as {
      projects: Array<{ projectId: string }>;
    };
    privateProject = listed.projects[0]!.projectId;
  });
  afterAll(async () => {
    await app.cleanup();
  });

  it("persists the switch without changing other Agent settings and refuses non-booleans", async () => {
    const before = (await (await admin.get(configPath)).json()) as AgentConfigResponse;
    expect(before.config.globalAgentDiscovery).toBe(false);
    expect((await admin.put(configPath, { config: { globalAgentDiscovery: true } })).status).toBe(
      200,
    );
    const enabled = (await (await admin.get(configPath)).json()) as AgentConfigResponse;
    expect(enabled.config.globalAgentDiscovery).toBe(true);
    expect(enabled.config.systemPrompt).toBe(before.config.systemPrompt);
    expect((await admin.put(configPath, { config: { globalAgentDiscovery: "true" } })).status).toBe(
      400,
    );
    expect(
      ((await (await admin.get(configPath)).json()) as AgentConfigResponse).config
        .globalAgentDiscovery,
    ).toBe(true);
    await admin.put(configPath, { config: { globalAgentDiscovery: false } });
  });

  it("limits catalog reads to the Project and controller streams to admins", async () => {
    expect((await member.get(prefix + "/local")).status).toBe(404);
    const own = `/api/projects/${privateProject}/agent-discovery`;
    expect((await member.get(own + "/local")).status).toBe(200);
    expect((await member.get(own + "/relay?controller_id=hub")).status).toBe(403);
    expect((await admin.get(prefix + "/relay?controller_id=../bad")).status).toBe(400);
  });

  it("accepts only the live lease's same-Project reply and forwards no workspace or secrets", async () => {
    const stream = await admin.get(prefix + "/relay?controller_id=test_hub");
    const reader = stream.body!.getReader();
    let buffer = "";
    const next = async (name: string) => {
      for (;;) {
        const cut = buffer.indexOf("\n\n");
        if (cut >= 0) {
          const event = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          if (event.includes(`event: ${name}\n`))
            return JSON.parse(
              event
                .split("\n")
                .find((line) => line.startsWith("data: "))!
                .slice(6),
            );
        } else {
          const chunk = await reader.read();
          if (chunk.done) throw new Error("Relay ended early");
          buffer += new TextDecoder().decode(chunk.value);
        }
      }
    };
    try {
      const ready = await next("agent_discovery_ready");
      const pending = admin.get(prefix);
      const query = await next("agent_discovery_query");
      expect(query.leaseId).toBe(ready.leaseId);
      const body = {
        projectId: "default_project",
        currentNodeId: "test_hub",
        unavailableNodes: [],
        agents: [
          {
            nodeId: "remote",
            nodeName: "remote host",
            agentId: "reviewer",
            name: "Reviewer",
            description: "Reviews code",
            local: true,
            canDelegate: true,
            secret: "must-not-be-forwarded",
            workspace: "/private/workspace",
          },
        ],
      };
      const reply = `${prefix}/relay/${query.leaseId}/${query.requestId}`;
      expect((await admin.post(`${prefix}/relay/wrong/${query.requestId}`, body)).status).toBe(404);
      expect((await admin.post(reply, { ...body, projectId: privateProject })).status).toBe(400);
      expect((await admin.post(reply, body)).status).toBe(204);
      const result = (await (await pending).json()) as GlobalAgentCatalog;
      expect(
        result.agents.find((agent: { nodeId: string }) => agent.nodeId === "remote"),
      ).toMatchObject({ canDelegate: true, local: false });
      expect(JSON.stringify(result)).not.toContain("must-not-be-forwarded");
      expect(JSON.stringify(result)).not.toContain("/private/workspace");
      expect((await admin.post(reply, body)).status).toBe(404);
    } finally {
      await reader.cancel();
    }
  });
});
