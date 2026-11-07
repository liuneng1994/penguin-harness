/**
 * - Given General's existing skills, members see and export shared files without copying; switches remain independent.
 * - Given an explicit private-copy request, only one concurrent request creates it; updates and removal preserve source and switches.
 * - Given native consumer reads, retained Trace statistics count them for that Agent, not for General or forwarded children.
 * - Given a shared-only entry or another Project, deletion and unauthorized copying cannot change General's files.
 * - Given a shared skill has no saved switch, creating a private copy preserves default-off; explicit enablement survives copying and removal.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  agentStateDir,
  DEFAULT_AGENT_ID,
  installSkill,
  sessionMeta,
  skillsDir,
  toolCall,
  toolCallOutput,
  withOrigin,
} from "@prismshadow/penguin-core";
import type { AgentSkillsResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("shared skill management", () => {
  let t: TestApp, p: string;
  let member: ReturnType<typeof apiClient>, outsider: ReturnType<typeof apiClient>;
  const A = "writer",
    B = "reviewer",
    G = DEFAULT_AGENT_ID;
  const base = (agentId = A) => `/api/projects/${p}/agents/${agentId}/skills`;
  const file = (agentId = G) => path.join(skillsDir(t.root, p, agentId), "shared_demo", "SKILL.md");
  const read = async (agentId = A, usage = false) => {
    const response = await member.get(base(agentId) + (usage ? "?usage=true" : ""));
    expect(response.status).toBe(200);
    return ((await response.json()) as AgentSkillsResponse).skills.find(
      (skill) => skill.name === "shared_demo",
    )!;
  };
  const install = (body: string) =>
    installSkill(t.root, p, G, {
      name: "shared_demo",
      content: `---\nname: shared_demo\n---\n${body}\n`,
      files: { "references/data.txt": "Shared reference" },
    });
  beforeAll(async () => {
    t = await createTestApp();
    member = apiClient(t.app, (await provisionUser(t.app, "shared_member")).cookie);
    outsider = apiClient(t.app, (await provisionUser(t.app, "shared_outsider")).cookie);
    p = (
      (await (
        await member.post("/api/projects", { projectId: "shared_member-skills", name: "Shared" })
      ).json()) as ProjectCreateResponse
    ).project.projectId;
    await install("Existing source");
    for (const agentId of [A, B])
      expect((await member.post(`/api/projects/${p}/agents`, { agentId })).status).toBe(201);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("exposes and exports General's existing skills while preserving each Agent's switch and files", async () => {
    const before = await fs.readFile(file(), "utf8");
    expect(await read()).toMatchObject({ sourceAgentId: G, enabled: false });
    await expect(fs.access(file(A))).rejects.toThrow();
    expect((await member.patch(base(G) + "/shared_demo", { enabled: false })).status).toBe(200);
    expect((await read()).enabled).toBe(false);
    expect((await member.patch(base() + "/shared_demo", { enabled: false })).status).toBe(200);
    expect((await read()).enabled).toBe(false);
    expect((await read(B)).enabled).toBe(false);
    const archive = await member.get(base() + "/shared_demo/archive");
    expect(archive.status).toBe(200);
    const zip = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    expect(strFromU8(zip["shared_demo/SKILL.md"]!)).toBe(before);
    expect(strFromU8(zip["shared_demo/references/data.txt"]!)).toBe("Shared reference");
    expect(await fs.readFile(file(), "utf8")).toBe(before);
    await expect(fs.access(file(A))).rejects.toThrow();
  });

  it("creates one private copy on explicit requests, preserves it across source updates and restores sharing on removal", async () => {
    const responses = await Promise.all([
      member.post(base() + "/shared_demo/local-copy"),
      member.post(base() + "/shared_demo/local-copy"),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await read()).toMatchObject({ overridesShared: true, enabled: false });
    expect((await read()).sourceAgentId).toBeUndefined();
    expect(await fs.readFile(file(A), "utf8")).toContain("Existing source");
    expect(await fs.readFile(path.join(path.dirname(file(A)), "references/data.txt"), "utf8")).toBe(
      "Shared reference",
    );
    await install("Updated source");
    expect(await fs.readFile(file(A), "utf8")).toContain("Existing source");
    expect((await member.post(base() + "/shared_demo/local-copy")).status).toBe(409);
    expect((await member.delete(base() + "/shared_demo")).status).toBe(204);
    expect(await read()).toMatchObject({ sourceAgentId: G, enabled: false });
    expect(await fs.readFile(file(), "utf8")).toContain("Updated source");
    await expect(fs.access(file(A))).rejects.toThrow();
  });

  it("attributes shared entry reads to their native consumer without counting forwarded children", async () => {
    const call = toolCall({
      name: "read_file",
      arguments: JSON.stringify({ file_path: file() }),
      toolCallId: "read-shared",
    });
    const result = toolCallOutput({
      output: "Shared body",
      toolCallId: "read-shared",
      status: "completed",
    });
    await writeTraceFile(t.root, p, A, "2026-11-07", "shared-read", 1, [
      sessionMeta({
        session_id: "shared-read",
        provider: "custom",
        model_id: "m",
        model_context_window: 100000,
        system_prompt: "sp",
        agent_state: agentStateDir(t.root, p, A),
        workspace: "/work",
        source: "user",
      }),
      call,
      result,
      withOrigin(call, "child"),
      withOrigin(result, "child"),
    ]);
    expect((await read(A, true)).usage).toMatchObject({ reads: 1, sessions: 1 });
    expect((await read(G, true)).usage).toMatchObject({ reads: 0, sessions: 0 });
    expect((await read(B, true)).usage).toMatchObject({ reads: 0, sessions: 0 });
  });

  it("refuses shared-source deletion through consumers and unauthorized copy requests", async () => {
    const before = await fs.readFile(file(), "utf8");
    expect((await member.delete(base() + "/shared_demo")).status).toBe(409);
    expect((await outsider.post(base() + "/shared_demo/local-copy")).status).toBe(404);
    expect((await member.post(base(G) + "/shared_demo/local-copy")).status).toBe(409);
    expect((await member.post(base() + "/missing/local-copy")).status).toBe(404);
    expect(await fs.readFile(file(), "utf8")).toBe(before);
    await expect(fs.access(file(A))).rejects.toThrow();
    await expect(
      fs.access(path.join(agentStateDir(t.root, p, A), "skills/missing")),
    ).rejects.toThrow();
  });

  it("preserves default-off and explicitly enabled switches when creating and removing private copies", async () => {
    expect((await read(B)).enabled).toBe(false);
    expect((await member.post(base(B) + "/shared_demo/local-copy")).status).toBe(201);
    expect(await read(B)).toMatchObject({ overridesShared: true, enabled: false });
    expect((await member.delete(base(B) + "/shared_demo")).status).toBe(204);
    expect(await read(B)).toMatchObject({ sourceAgentId: G, enabled: false });
    expect((await member.patch(base(B) + "/shared_demo", { enabled: true })).status).toBe(200);
    expect((await member.post(base(B) + "/shared_demo/local-copy")).status).toBe(201);
    expect((await read(B)).enabled).not.toBe(false);
    expect((await member.delete(base(B) + "/shared_demo")).status).toBe(204);
    expect(await read(B)).toMatchObject({ sourceAgentId: G });
    expect((await read(B)).enabled).not.toBe(false);
  });
});
