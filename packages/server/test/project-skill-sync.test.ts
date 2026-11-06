/**
 * - Given a preview, members see pending skills without installing them; only the owner can sync.
 * - Given an explicit sync, copies update within this Project, preserve independent switches
 *   and local edits, and include new and unmanaged Agents only after that explicit action.
 * - Given source edits, new Agents or metadata reads, no implicit sync occurs.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agentStateDir,
  installSkill,
  listInstalledSkills,
  loadAgentState,
  removeSkill,
  setSkillEnabled,
  skillsDir,
} from "@prismshadow/penguin-core";
import type {
  SkillSyncResponse,
  ProjectCreateResponse,
  AgentSkillsResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("manual Project skill sync", () => {
  let t: TestApp, p: string, other: string;
  let owner: ReturnType<typeof apiClient>,
    member: ReturnType<typeof apiClient>,
    outsider: ReturnType<typeof apiClient>;
  const base = () => `/api/projects/${p}/skill-sync`;
  const install = (agentId: string, body: string) =>
    installSkill(t.root, p, agentId, {
      name: "shared",
      content: `---\nname: shared\n---\n${body}\n`,
      files: { "reference/info.txt": "Reference" },
    });
  const file = (agentId: string) => path.join(skillsDir(t.root, p, agentId), "shared/SKILL.md");
  const preview = async () => (await (await member.get(base())).json()) as SkillSyncResponse;
  beforeAll(async () => {
    t = await createTestApp();
    owner = apiClient(t.app, (await provisionUser(t.app, "sync_owner")).cookie);
    member = apiClient(t.app, (await provisionUser(t.app, "sync_member")).cookie);
    outsider = apiClient(t.app, (await provisionUser(t.app, "sync_outsider")).cookie);
    const create = async (id: string) =>
      (
        (await (
          await owner.post("/api/projects", { projectId: id, name: "Sync" })
        ).json()) as ProjectCreateResponse
      ).project.projectId;
    p = await create("sync_owner-sync");
    other = await create("sync_owner-other");
    expect((await owner.post(`/api/projects/${p}/members`, { userId: "sync_member" })).status).toBe(
      201,
    );
    for (const skill of await listInstalledSkills(t.root, p, "default_agent"))
      await removeSkill(t.root, p, "default_agent", skill.name);
    for (const agentId of ["first_agent", "local_agent"])
      expect((await owner.post(`/api/projects/${p}/agents`, { agentId })).status).toBe(201);
    expect(
      (await owner.post(`/api/projects/${other}/agents`, { agentId: "other_agent" })).status,
    ).toBe(201);
    await install("default_agent", "Source one");
    await install("local_agent", "Local choice");
  });
  afterAll(async () => {
    await t.cleanup();
  });
  it("previews without writes and allows only the owner to perform a sync", async () => {
    expect((await preview()).entries).toContainEqual({
      agentId: "first_agent",
      name: "shared",
      status: "pending",
    });
    await expect(fs.access(file("first_agent"))).rejects.toThrow();
    expect((await member.post(base())).status).toBe(403);
    expect((await outsider.get(base())).status).toBe(404);
    const response = await owner.post(base());
    expect(response.status).toBe(200);
    const body = (await response.json()) as SkillSyncResponse;
    expect(body.entries).toContainEqual({
      agentId: "first_agent",
      name: "shared",
      status: "synced",
    });
    expect(body.entries).toContainEqual({
      agentId: "local_agent",
      name: "shared",
      status: "conflict",
      reason: "local_skill",
    });
    expect(await fs.readFile(file("first_agent"), "utf8")).toContain("Source one");
    expect(await listInstalledSkills(t.root, other, "other_agent")).toEqual([]);
  });
  it("source edits, previews and newly created Agents wait for the next manual action", async () => {
    await setSkillEnabled(t.root, p, "first_agent", "shared", false);
    await install("default_agent", "Source two");
    expect((await preview()).entries).toContainEqual({
      agentId: "first_agent",
      name: "shared",
      status: "pending",
    });
    expect(await fs.readFile(file("first_agent"), "utf8")).toContain("Source one");
    expect((await owner.post(`/api/projects/${p}/agents`, { agentId: "new_agent" })).status).toBe(
      201,
    );
    const before = (await (
      await owner.get(`/api/projects/${p}/agents/new_agent/skills`)
    ).json()) as AgentSkillsResponse;
    expect(before.skills).toEqual([]);
    await loadAgentState({ root: t.root, projectId: p, agentId: "cli_agent", init: {} });
    expect(await listInstalledSkills(t.root, p, "cli_agent")).toEqual([]);
    await owner.post(base());
    for (const id of ["first_agent", "new_agent", "cli_agent"])
      expect(await fs.readFile(file(id), "utf8")).toContain("Source two");
    expect(await fs.readFile(file("local_agent"), "utf8")).toContain("Local choice");
    const after = (await (
      await owner.get(`/api/projects/${p}/agents/first_agent/skills`)
    ).json()) as AgentSkillsResponse;
    expect(after.skills[0]!.enabled).toBe(false);
  });
  it("preserves local edits and leaves copies installed when their source is removed", async () => {
    await fs.writeFile(
      path.join(agentStateDir(t.root, p, "new_agent"), "skills/shared/reference/local.txt"),
      "Local edit",
    );
    await install("default_agent", "Source three");
    const response = (await (await owner.post(base())).json()) as SkillSyncResponse;
    expect(response.entries).toContainEqual({
      agentId: "new_agent",
      name: "shared",
      status: "conflict",
      reason: "local_edits",
    });
    expect(await fs.readFile(file("new_agent"), "utf8")).toContain("Source two");
    await removeSkill(t.root, p, "default_agent", "shared");
    await owner.post(base());
    expect(await fs.readFile(file("first_agent"), "utf8")).toContain("Source three");
  });
});
