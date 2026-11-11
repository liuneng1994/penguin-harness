/**
 * - An opted-in parent delegates data research through the target API into an empty temporary
 *   workspace; output and approvals reach the parent, and the target has no delegation tools.
 * - Denied tool calls do not write research files. Follow-ups and idle revival keep the same
 *   workspace and history without replaying output or restoring a second delegation level.
 * - A remote qualifier cannot hit the same-named local Agent. Default/off discovery sends no
 *   remote work; foreign Projects, non-admin connections and another parent are refused.
 * - A leaf can reach a sibling through a controller's held relay; a disconnected controller
 *   fails its requests, then an existing child can continue after controller reconnection.
 * - Releasing a child while its Session is resuming must not resurrect it.
 * - A steering request rejected by an already-finished target is reported as unaccepted.
 *   An interrupted research round denies pending approval and settles.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  createAgent,
  isCompleteModelMessage,
  saveProjectConfig,
  systemConfigPath,
  userText,
} from "@prismshadow/penguin-core";
import type {
  AmspRecord,
  ApproveFn,
  GlobalAgentCatalog,
  SubagentHandle,
} from "@prismshadow/penguin-core";
import { AgentDirectoryService } from "../src/services/agent-directory.js";
import { AgentDelegationHost } from "../src/services/agent-delegation-host.js";
import { AgentDelegationClient } from "../src/services/agent-delegation-client.js";
import type {
  DelegationCall,
  DelegationRequest,
  DelegationSpawn,
} from "../src/services/agent-delegation-protocol.js";
import type { DirectoryQuery } from "../src/services/agent-directory.js";
import {
  apiClient,
  createTestApp,
  loginAdmin,
  makeTempRoot,
  provisionUser,
  removeTempRoot,
  waitFor,
} from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { stubFetch } from "./fixtures/fetch.js";

const P = "default_project",
  A = "default_agent";
let app: TestApp, root: string;
let admin: ReturnType<typeof apiClient>, member: ReturnType<typeof apiClient>;
let directory: AgentDirectoryService, client: AgentDelegationClient;
let nodeId: string;
const calls: DelegationRequest[] = [];
const base = `/api/projects/${P}/agent-discovery`;
const config = {
  default_model: { provider: "custom", model_id: "m" },
  providers: {
    custom: {
      client_type: "openai-chat" as const,
      base_url: "http://127.0.0.1:1/v1",
      api_key: "test",
    },
  },
  models: [{ provider: "custom", model_id: "m", context_window: 100000 }],
};
const owner = { projectId: P, agentId: A, sessionId: "parent", nodeId: "left" };
const invoke: DelegationCall = async (request) => {
  calls.push(request);
  const response = await admin.post(`${base}/delegate`, request);
  const body: unknown = await response.json();
  if (response.status !== 200) throw new Error(JSON.stringify(body));
  return body;
};
async function enabled(value: boolean) {
  const file = systemConfigPath(root, P, A);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({ system_prompt: "Research data", global_agent_discovery: value }),
  );
}
function script(command = false) {
  return stubFetch((_call, index) => {
    const tool = command && index === 0;
    const delta = tool
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "research",
              type: "function",
              function: {
                name: "exec_command",
                arguments: JSON.stringify({
                  cmd: 'node -e \'require("fs").writeFileSync("research.txt","42")\'',
                }),
              },
            },
          ],
        }
      : { role: "assistant", content: `Research answer ${index}` };
    const chunk = {
      id: "reply",
      object: "chat.completion.chunk",
      model: "m",
      created: 0,
      choices: [{ index: 0, delta, finish_reason: null }],
    };
    const stop = {
      ...chunk,
      choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 1, total_tokens: 101 },
    };
    return new Response(
      `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(stop)}\n\ndata: [DONE]\n\n`,
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
}
async function spawn(sessionId = randomUUID()) {
  return client
    .runner({ projectId: P, agentId: A, sessionId })
    .spawn({ nodeId, agentId: A, modelId: "m", provider: "custom" });
}
async function drain(
  handle: SubagentHandle,
  text: string,
  approve: ApproveFn = async () => "allow",
) {
  const records: AmspRecord[] = [];
  const iterator = handle.run({ messages: [userText(text, "parent_agent")], approve });
  for (;;) {
    const step = await iterator.next();
    if (step.done) return { records, cutoff: step.value };
    records.push(step.value);
  }
}
beforeAll(async () => {
  app = await createTestApp();
  admin = apiClient(app.app, (await loginAdmin(app.app)).cookie);
  member = apiClient(app.app, (await provisionUser(app.app, "research_member")).cookie);
  await saveProjectConfig(app.root, P, config);
  root = await makeTempRoot();
  await enabled(true);
  await fs.writeFile(path.join(root, "research.txt"), "parent workspace");
  const local = (await (await admin.get(`${base}/local`)).json()) as GlobalAgentCatalog;
  nodeId = local.currentNodeId;
  directory = new AgentDirectoryService(root, {
    local: () => ({ nodeId: "left", nodeName: "left" }),
    peers: (projectId) => (projectId === P ? [{ nodeId, nodeName: "right" }] : []),
    read: async () => (await (await admin.get(`${base}/local`)).json()) as GlobalAgentCatalog,
    call: async (_nodeId, _projectId, request) => invoke(request),
  });
  client = new AgentDelegationClient(directory, "left", (_projectId, request) => invoke(request));
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(async () => {
  directory.close();
  await app.cleanup();
  await removeTempRoot(root);
});

it("runs remote data research in an empty temporary workspace with parent approvals and one delegation level", async () => {
  const fake = script(true);
  const handle = await spawn();
  const meta = handle.takeMeta!()!;
  const workspace = (meta.payload as { workspace: string }).workspace;
  expect(await fs.readdir(workspace)).toEqual([]);
  expect(workspace.startsWith(app.root)).toBe(true);
  const approvals: AmspRecord[] = [];
  const result = await drain(
    handle,
    "Collect a temporary data sample",
    async (...args: AmspRecord[]) => {
      approvals.push(args[0]!);
      return "allow" as const;
    },
  );
  expect(result.cutoff).toBeNull();
  expect(approvals).toHaveLength(1);
  expect(approvals[0]!.origin).toEqual([handle.sessionId]);
  expect(await fs.readFile(path.join(workspace, "research.txt"), "utf8")).toBe("42");
  expect(await fs.readFile(path.join(root, "research.txt"), "utf8")).toBe("parent workspace");
  expect(result.records.every((record) => record.origin?.[0] === handle.sessionId)).toBe(true);
  const toolNames = JSON.parse(fake.calls[0]!.body).tools.map(
    (tool: { function: { name: string } }) => tool.function.name,
  );
  expect(toolNames).not.toContain("run_subagent");
  expect(toolNames).not.toContain("input_subagent");
  expect(
    result.records.some(
      (record) =>
        isCompleteModelMessage(record) &&
        record.payload.type === "text" &&
        record.payload.text.includes("Research answer"),
    ),
  ).toBe(true);
  handle.dispose();
});

it("denies remote writes through the parent's decision", async () => {
  script(true);
  const handle = await spawn();
  const meta = handle.takeMeta!()!;
  const result = await drain(handle, "Collect data", async () => "deny");
  expect(result.cutoff).toBeNull();
  await expect(
    fs.access(path.join((meta.payload as { workspace: string }).workspace, "research.txt")),
  ).rejects.toThrow();
  handle.dispose();
});

it("keeps remote history and workspace through follow-ups and idle revival without restoring delegation tools", async () => {
  const fake = script();
  const context = { projectId: P, agentId: A, sessionId: randomUUID() };
  const runner = client.runner(context);
  const handle = await runner.spawn({ nodeId, agentId: A, modelId: "m", provider: "custom" });
  const meta = handle.takeMeta!()!;
  await drain(handle, "First research question");
  const next = await drain(handle, "Follow up on the first answer");
  expect(
    next.records
      .filter(
        (record) =>
          isCompleteModelMessage(record) &&
          record.payload.type === "text" &&
          record.payload.role === "assistant",
      )
      .map((record) => (record.payload as { text: string }).text),
  ).toEqual(["Research answer 1"]);
  handle.dispose();
  await waitFor(() =>
    calls.some((call) => call.sessionId === handle.sessionId && call.operation === "dispose"),
  );
  const revived = await runner.resume!({ nodeId, agentId: A, sessionId: handle.sessionId });
  expect((revived.takeMeta!()!.payload as { workspace: string }).workspace).toBe(
    (meta.payload as { workspace: string }).workspace,
  );
  const result = await drain(revived, "Continue this temporary research");
  expect(result.cutoff).toBeNull();
  const request = JSON.parse(fake.calls[2]!.body);
  expect(JSON.stringify(request.messages)).toContain("First research question");
  expect(
    request.tools.map((tool: { function: { name: string } }) => tool.function.name),
  ).not.toContain("run_subagent");
  revived.dispose();
});

it("refuses disabled and foreign targets before sending any remote work", async () => {
  const before = calls.length;
  await enabled(false);
  await expect(spawn()).rejects.toThrow("disabled");
  await enabled(true);
  await expect(
    client
      .runner({ projectId: P, agentId: A, sessionId: randomUUID() })
      .spawn({ nodeId: "foreign", agentId: A }),
  ).rejects.toThrow("unavailable");
  expect(calls).toHaveLength(before);
});

it("enforces Project, admin access and parent ownership at the target API", async () => {
  const request: DelegationRequest = {
    operation: "spawn",
    owner,
    requestId: randomUUID(),
    agentId: A,
    modelId: "m",
    provider: "custom",
  };
  expect((await member.post(`${base}/delegate`, request)).status).toBe(404);
  const projects = (await (await member.get("/api/projects")).json()) as {
    projects: Array<{ projectId: string }>;
  };
  const memberProject = projects.projects[0]!.projectId;
  expect(
    (
      await member.post(`/api/projects/${memberProject}/agent-discovery/delegate`, {
        ...request,
        owner: { ...owner, projectId: memberProject },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await admin.post(`${base}/delegate`, {
        ...request,
        owner: { ...owner, projectId: "foreign" },
      })
    ).status,
  ).toBe(400);
  expect((await admin.post(`${base}/delegate`, { ...request, workspaceDir: root })).status).toBe(
    400,
  );
  expect(
    (await admin.post(`${base}/delegate`, { ...request, thinkingLevel: ["high"] })).status,
  ).toBe(400);
  expect((await admin.post(`${base}/delegate`, { ...request, decision: ["allow"] })).status).toBe(
    400,
  );
  const remote = (await invoke(request)) as DelegationSpawn;
  const access = {
    operation: "poll" as const,
    owner: { ...owner, sessionId: "another-parent" },
    requestId: randomUUID(),
    sessionId: remote.sessionId,
    capability: remote.capability,
  };
  expect((await admin.post(`${base}/delegate`, access)).status).toBe(409);
  expect(
    (await admin.post(`${base}/delegate`, { ...access, owner, capability: "wrong" })).status,
  ).toBe(409);
  await invoke({ ...access, owner, operation: "dispose" });
});

it("reaches a sibling through the same-Project controller relay and refuses a disconnected lease", async () => {
  script();
  const leaf = new AgentDirectoryService(root, {
    local: () => ({ nodeId: "leaf", nodeName: "leaf" }),
    peers: () => [],
    read: async () => {
      throw new Error("no peers");
    },
  });
  const connect = () =>
    leaf.relay(P, "hub").subscribe((event) => {
      if (event.event !== "agent_discovery_query") return;
      const query = JSON.parse(event.data) as DirectoryQuery;
      void (
        query.rpc
          ? invoke(query.rpc.request).then((result) => ({ rpc: true, controllerId: "hub", result }))
          : directory.aggregate(P, query).then((catalog) => ({ ...catalog, currentNodeId: "hub" }))
      ).then((reply) => leaf.answer(P, query.leaseId, query.requestId, reply));
    });
  let stop = connect();
  const remoteClient = new AgentDelegationClient(leaf, "leaf", (_projectId, request) =>
    invoke(request),
  );
  const handle = await remoteClient
    .runner({ projectId: P, agentId: A, sessionId: randomUUID() })
    .spawn({ nodeId, agentId: A, modelId: "m", provider: "custom" });
  expect((await drain(handle, "Research using the sibling node")).cutoff).toBeNull();
  stop();
  await expect(leaf.delegationRoute(P, nodeId)).rejects.toThrow("disconnected");
  stop = connect();
  try {
    const followUp = await drain(handle, "Continue after the controller reconnects");
    expect(followUp.cutoff).toBeNull();
    expect(
      followUp.records.some(
        (record) =>
          isCompleteModelMessage(record) &&
          record.payload.type === "text" &&
          record.payload.text === "Research answer 1",
      ),
    ).toBe(true);
    handle.dispose();
  } finally {
    stop();
    leaf.close();
  }
});

it("aborts remote work while the parent is waiting for an approval", async () => {
  script(true);
  const handle = await spawn();
  const abort = new AbortController();
  let observed!: () => void;
  const approval = new Promise<void>((resolve) => {
    observed = resolve;
  });
  const iterator = handle.run({
    messages: [userText("Collect data")],
    signal: abort.signal,
    approve: () => {
      observed();
      return new Promise(() => {});
    },
  });
  const result = (async () => {
    for (;;) {
      const step = await iterator.next();
      if (step.done) return step.value;
    }
  })();
  await approval;
  abort.abort();
  expect(await result).toMatchObject({ kind: "abort" });
  handle.dispose();
});

it("reuses a retried spawn and refuses a missing Agent without creating it", async () => {
  const request: DelegationRequest = {
    operation: "spawn",
    owner,
    requestId: randomUUID(),
    agentId: A,
    modelId: "m",
    provider: "custom",
  };
  const [first, second] = (await Promise.all([invoke(request), invoke(request)])) as [
    DelegationSpawn,
    DelegationSpawn,
  ];
  expect(first.sessionId).toBe(second.sessionId);
  expect(first.capability).toBe(second.capability);
  expect(
    (
      await admin.post(`${base}/delegate`, {
        ...request,
        requestId: randomUUID(),
        agentId: "missing-researcher",
      })
    ).status,
  ).toBe(409);
  await expect(
    fs.access(path.dirname(systemConfigPath(app.root, P, "missing-researcher"))),
  ).rejects.toThrow();
  await invoke({
    ...request,
    operation: "dispose",
    sessionId: first.sessionId,
    capability: first.capability,
  });
});

it("stops abandoned remote research after its parent stops polling", async () => {
  script(true);
  const request: DelegationRequest = {
    operation: "spawn",
    owner,
    requestId: randomUUID(),
    agentId: A,
    modelId: "m",
    provider: "custom",
  };
  const remote = (await invoke(request)) as DelegationSpawn;
  const access = { ...request, sessionId: remote.sessionId, capability: remote.capability };
  await invoke({
    ...access,
    operation: "run",
    requestId: randomUUID(),
    messages: [userText("Research data")],
  });
  let cursor = 0;
  for (;;) {
    const batch = (await invoke({
      ...access,
      operation: "poll",
      cursor,
    })) as import("../src/services/agent-delegation-protocol.js").DelegationBatch;
    cursor = batch.records.at(-1)?.cursor ?? cursor;
    if (batch.approvals.length) break;
  }
  vi.useFakeTimers();
  try {
    // Refresh the lease under fake time, then simulate a disappeared parent.
    const poll = invoke({ ...access, operation: "poll", cursor });
    await vi.advanceTimersByTimeAsync(60_001);
    await poll;
    expect(
      (await admin.post(`${base}/delegate`, { ...access, operation: "poll", cursor })).status,
    ).toBe(409);
    await expect(
      fs.access(
        path.join((remote.meta.payload as { workspace: string }).workspace, "research.txt"),
      ),
    ).rejects.toThrow();
  } finally {
    vi.useRealTimers();
  }
});

it("ignores a delayed abort for an earlier research round", async () => {
  script(true);
  const request: DelegationRequest = {
    operation: "spawn",
    owner,
    requestId: randomUUID(),
    agentId: A,
    modelId: "m",
    provider: "custom",
  };
  const remote = (await invoke(request)) as DelegationSpawn;
  const access = { ...request, sessionId: remote.sessionId, capability: remote.capability };
  const roundId = randomUUID();
  await invoke({
    ...access,
    operation: "run",
    requestId: roundId,
    messages: [userText("Research data")],
  });
  let cursor = 0,
    approvalId: string;
  for (;;) {
    const batch = (await invoke({
      ...access,
      operation: "poll",
      cursor,
    })) as import("../src/services/agent-delegation-protocol.js").DelegationBatch;
    cursor = batch.records.at(-1)?.cursor ?? cursor;
    if (batch.approvals.length) {
      approvalId = batch.approvals[0]!.id;
      break;
    }
  }
  await invoke({ ...access, operation: "abort", roundId: "previous-round" });
  await invoke({ ...access, operation: "approve", approvalId, decision: "allow" });
  for (;;) {
    const batch = (await invoke({
      ...access,
      operation: "poll",
      cursor,
    })) as import("../src/services/agent-delegation-protocol.js").DelegationBatch;
    cursor = batch.records.at(-1)?.cursor ?? cursor;
    if (batch.done) {
      expect(batch.cutoff).toBeNull();
      break;
    }
  }
  expect(
    await fs.readFile(
      path.join((remote.meta.payload as { workspace: string }).workspace, "research.txt"),
      "utf8",
    ),
  ).toBe("42");
  await invoke({ ...access, operation: "dispose" });
});

it("reports remote steering as unaccepted when the target has already finished", async () => {
  script();
  let observed!: () => void, deliver!: () => void;
  const completedAtTarget = new Promise<void>((resolve) => {
    observed = resolve;
  });
  const receive = new Promise<void>((resolve) => {
    deliver = resolve;
  });
  const delayed = new AgentDirectoryService(root, {
    local: () => ({ nodeId: "left", nodeName: "left" }),
    peers: () => [{ nodeId, nodeName: "right" }],
    read: async () => (await (await admin.get(`${base}/local`)).json()) as GlobalAgentCatalog,
    call: async (_nodeId, _projectId, request) => {
      const result = await invoke(request);
      if (request.operation === "poll" && (result as { done: boolean }).done) {
        observed();
        await receive;
      }
      return result;
    },
  });
  const delayedClient = new AgentDelegationClient(delayed, "left", (_projectId, request) =>
    invoke(request),
  );
  const handle = await delayedClient
    .runner({ projectId: P, agentId: A, sessionId: randomUUID() })
    .spawn({ nodeId, agentId: A, modelId: "m", provider: "custom" });
  const result = drain(handle, "Research data");
  await completedAtTarget;
  try {
    expect(await handle.steer!([userText("A late follow-up")])).toBe(false);
  } finally {
    deliver();
    await result;
    handle.dispose();
    delayed.close();
  }
});

it("does not resurrect a remote child released while resume is pending", async () => {
  const agent = await createAgent({ root: app.root, projectId: P, agentId: A });
  let entered!: () => void, release!: () => void;
  const resuming = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const host = new AgentDelegationHost(async (_projectId, request) => {
    if (request.operation === "resume") {
      entered();
      await gate;
    }
    return agent.createSession({
      sessionId: request.sessionId,
      subagentDepth: 1,
      source: "subagent",
    });
  });
  const request: DelegationRequest = {
    operation: "spawn",
    owner,
    requestId: randomUUID(),
    agentId: A,
  };
  const spawn = (await host.execute(P, request)) as DelegationSpawn;
  const access = { ...request, sessionId: spawn.sessionId, capability: spawn.capability };
  await host.execute(P, { ...access, operation: "dispose" });
  const revived = host.execute(P, { ...access, operation: "resume" });
  await resuming;
  await host.execute(P, { ...access, operation: "dispose" });
  release();
  try {
    await expect(revived).rejects.toThrow("released while resuming");
    await expect(
      host.execute(P, { ...access, operation: "run", messages: [userText("Research")] }),
    ).rejects.toThrow("released");
  } finally {
    host.close();
  }
});
