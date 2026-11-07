/**
 * - Given an installed skill, members can toggle it without changing its content; outsiders,
 *   missing skills and invalid payloads are refused without writing settings.
 * - Given selections and reads in retained traces, stats distinguish successful and failed
 *   reads, deduplicate names within a message and exclude forwarded children and unrelated files.
 * - Given a growing/rotated/deleted Trace, another read refreshes the totals, including a
 *   tool call whose result lands in the next shard; requesting no stats returns metadata alone.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agentStateDir,
  buildSkillsMessage,
  installSkill,
  sessionMeta,
  toolCall,
  toolCallOutput,
  userText,
  withOrigin,
} from "@prismshadow/penguin-core";
import type { AmspRecord } from "@prismshadow/penguin-core";
import type { AgentSkillsResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("skill management", () => {
  let t: TestApp, projectId: string;
  let member: ReturnType<typeof apiClient>, outsider: ReturnType<typeof apiClient>;
  const A = "skills_agent";
  const base = () => `/api/projects/${projectId}/agents/${A}/skills`;
  const at = (time: string, msg: AmspRecord) => ({ ...msg, timestamp: time });
  const meta = (sid: string) =>
    sessionMeta({
      session_id: sid,
      provider: "custom",
      model_id: "m",
      model_context_window: 100000,
      system_prompt: "sp",
      agent_state: agentStateDir(t.root, projectId, A),
      workspace: "/work",
      source: "user",
    });
  const call = (id: string, file?: string) =>
    toolCall({
      name: "read_file",
      arguments: JSON.stringify({
        file_path: file ?? path.join(agentStateDir(t.root, projectId, A), "skills/demo/SKILL.md"),
      }),
      toolCallId: id,
    });
  const read = async (usage = true) =>
    (await (await member.get(base() + (usage ? "?usage=true" : ""))).json()) as AgentSkillsResponse;
  beforeAll(async () => {
    t = await createTestApp();
    member = apiClient(t.app, (await provisionUser(t.app, "skill_member")).cookie);
    outsider = apiClient(t.app, (await provisionUser(t.app, "skill_outsider")).cookie);
    const p = (await (
      await member.post("/api/projects", { projectId: "skill_member-skills", name: "Skills" })
    ).json()) as ProjectCreateResponse;
    projectId = p.project.projectId;
    expect((await member.post(`/api/projects/${projectId}/agents`, { agentId: A })).status).toBe(
      201,
    );
    await installSkill(t.root, projectId, A, {
      name: "demo",
      content: "---\nname: demo\n---\nKeep my edits\n",
    });
  });
  afterAll(async () => {
    await t.cleanup();
  });
  it("toggles without changing files and refuses unauthorized, missing or malformed writes", async () => {
    const file = path.join(agentStateDir(t.root, projectId, A), "skills/demo/SKILL.md");
    const before = await fs.readFile(file, "utf8");
    expect((await member.patch(base() + "/demo", { enabled: false })).status).toBe(200);
    expect((await read()).skills.find((skill) => skill.name === "demo")).toMatchObject({
      name: "demo",
      enabled: false,
    });
    expect(await fs.readFile(file, "utf8")).toBe(before);
    expect((await outsider.patch(base() + "/demo", { enabled: true })).status).toBe(404);
    expect((await member.patch(base() + "/missing", { enabled: false })).status).toBe(404);
    expect((await member.patch(base() + "/demo", { enabled: "false" })).status).toBe(400);
    expect((await read()).skills.find((skill) => skill.name === "demo")!.enabled).toBe(false);
    await expect(
      fs.access(path.join(agentStateDir(t.root, projectId, A), "skill-settings/missing.json")),
    ).rejects.toThrow();
    expect((await member.patch(base() + "/demo", { enabled: true })).status).toBe(200);
  });
  it("derives selections and completed reads without counting children or unrelated files", async () => {
    const selected = at(
      "2026-11-06T01:00:00Z",
      userText(buildSkillsMessage(["demo", "demo"], "Task")),
    );
    await writeTraceFile(t.root, projectId, A, "2026-11-06", "usage-one", 1, [
      meta("usage-one"),
      selected,
      call("ok"),
      at(
        "2026-11-06T02:00:00Z",
        toolCallOutput({ output: "Body", toolCallId: "ok", status: "completed" }),
      ),
      call("bad"),
      toolCallOutput({ output: "Denied", toolCallId: "bad", status: "aborted" }),
      withOrigin(selected, "child"),
      withOrigin(call("child"), "child"),
      withOrigin(
        toolCallOutput({ output: "Body", toolCallId: "child", status: "completed" }),
        "child",
      ),
      call("ordinary", "/work/SKILL.md"),
      toolCallOutput({ output: "Other", toolCallId: "ordinary", status: "completed" }),
    ]);
    const skill = (await read()).skills.find((skill) => skill.name === "demo")!;
    expect(skill.usage).toEqual({
      invocations: 1,
      reads: 1,
      failedReads: 1,
      sessions: 1,
      lastUsedAt: "2026-11-06T02:00:00.000Z",
    });
    expect(
      (await read(false)).skills.find((skill) => skill.name === "demo")!.usage,
    ).toBeUndefined();
    expect((await outsider.get(base() + "?usage=true")).status).toBe(404);
  });
  it("refreshes appended and rotated shards, pairs across shards and drops deleted sessions", async () => {
    const file = await writeTraceFile(t.root, projectId, A, "2026-11-06", "usage-two", 1, [
      meta("usage-two"),
      call("later"),
    ]);
    expect((await read()).skills.find((skill) => skill.name === "demo")!.usage!.reads).toBe(1);
    await fs.appendFile(
      file,
      "\nnot json\n" +
        JSON.stringify(
          at("2026-11-06T03:00:00Z", userText(buildSkillsMessage(["demo"], "Next task"))),
        ) +
        "\n",
    );
    expect((await read()).skills.find((skill) => skill.name === "demo")!.usage!.invocations).toBe(
      2,
    );
    const shard = await writeTraceFile(t.root, projectId, A, "2026-11-06", "usage-two", 2, [
      at(
        "2026-11-06T04:00:00Z",
        toolCallOutput({ output: "Body", toolCallId: "later", status: "completed" }),
      ),
    ]);
    expect((await read()).skills.find((skill) => skill.name === "demo")!.usage).toEqual({
      invocations: 2,
      reads: 2,
      failedReads: 1,
      sessions: 2,
      lastUsedAt: "2026-11-06T04:00:00.000Z",
    });
    await fs.unlink(file);
    await fs.unlink(shard);
    expect((await read()).skills.find((skill) => skill.name === "demo")!.usage!.sessions).toBe(1);
  });
});
