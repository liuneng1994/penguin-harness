/**
 * - Given a preview, local skills stay unchanged and no shared copies are written.
 * - Given a manual sync, source files reach each target in this Project, concurrent target requests
 *   are not lost, and a later source update replaces an unedited managed copy exactly.
 * - Given a target switch is off, updates preserve that switch and all source content.
 * - Given a new shared copy, its default-off state persists after copying; an explicit enabled state remains enabled.
 * - Given same-name local content, edited managed copies or unsafe source files, sync preserves
 *   local files and reports a conflict instead of overwriting them.
 * - Given a source is removed or edited, installed copies stay as they were until an explicit sync.
 * - Given invalid identifiers or missing targets, no partial target is created.
 * - Given provenance imported from another Project, keep the imported content as local.
 * - Given a destination changes while a replacement is staged, a refused commit keeps that edit.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  agentStateDir,
  DEFAULT_AGENT_ID,
  installSkill,
  inspectAgentSkillSync,
  listInstalledSkills,
  loadAgentState,
  removeSkill,
  replaceSkillDirectory,
  setSkillEnabled,
  skillEnabled,
  skillsDir,
  synchronizeAgentSkills,
} from "../src/state/index.js";
let root: string;
const P = "project",
  A = "first",
  B = "second";
const content = (body: string) => `---\nname: shared\ndescription: ${body}\n---\n${body}\n`;
const install = (
  agentId = DEFAULT_AGENT_ID,
  body = "Version one",
  files: Record<string, string> = { "reference/info.txt": "Original reference" },
) => installSkill(root, P, agentId, { name: "shared", content: content(body), files });
const file = (id: string, relative = "SKILL.md") =>
  path.join(skillsDir(root, P, id), "shared", relative);
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-sync-"));
  for (const agentId of [DEFAULT_AGENT_ID, A, B])
    await loadAgentState({ root, projectId: P, agentId, init: {} });
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("General Agent skill sync", () => {
  it("keeps new shared copies disabled unless a consumer explicitly enabled them", async () => {
    await install();
    await setSkillEnabled(root, P, B, "shared", true);
    await synchronizeAgentSkills(root, P, [A, B]);
    expect(await skillEnabled(agentStateDir(root, P, A), "shared")).toBe(false);
    expect(await skillEnabled(agentStateDir(root, P, B), "shared")).toBe(true);
    await removeSkill(root, P, DEFAULT_AGENT_ID, "shared");
    expect(await skillEnabled(agentStateDir(root, P, A), "shared")).toBe(false);
    expect(await skillEnabled(agentStateDir(root, P, B), "shared")).toBe(true);
  });
  it("previews pending copies without changing local content or creating files", async () => {
    await install();
    await install(A, "Local choice");
    const preview = await inspectAgentSkillSync(root, P, [A, B]);
    expect(preview).toContainEqual({ agentId: B, name: "shared", status: "pending" });
    expect(await fs.readFile(file(A), "utf8")).toBe(content("Local choice"));
    expect(await listInstalledSkills(root, P, B)).toEqual([]);
    await expect(fs.access(path.join(agentStateDir(root, P, B), "skill-sync"))).rejects.toThrow();
  });
  it("copies all files to requested targets, preserves concurrent requests and updates managed copies", async () => {
    await install();
    await Promise.all([synchronizeAgentSkills(root, P, [A]), synchronizeAgentSkills(root, P, [B])]);
    for (const id of [A, B])
      expect(await fs.readFile(file(id, "reference/info.txt"), "utf8")).toBe("Original reference");
    await install(DEFAULT_AGENT_ID, "Version two", { "reference/new.txt": "New reference" });
    expect(
      (await synchronizeAgentSkills(root, P, [A, B, DEFAULT_AGENT_ID])).filter(
        (entry) => entry.status === "synced",
      ),
    ).toHaveLength(2);
    expect(await fs.readFile(file(A), "utf8")).toBe(content("Version two"));
    await expect(fs.access(file(A, "reference/info.txt"))).rejects.toThrow();
    expect(await fs.readFile(file(A, "reference/new.txt"), "utf8")).toBe("New reference");
    expect((await synchronizeAgentSkills(root, P, [A]))[0]!.status).toBe("current");
  });
  it("updates files without changing a target's independent disabled state", async () => {
    await install();
    await synchronizeAgentSkills(root, P, [A]);
    await setSkillEnabled(root, P, A, "shared", false);
    await install(DEFAULT_AGENT_ID, "Updated body");
    await synchronizeAgentSkills(root, P, [A]);
    expect(await skillEnabled(agentStateDir(root, P, A), "shared")).toBe(false);
    expect(await fs.readFile(file(A), "utf8")).toBe(content("Updated body"));
  });
  it("preserves same-name local skills, edited copies and targets when a source has a link", async () => {
    await install();
    await install(A, "Local instructions");
    expect(
      (await synchronizeAgentSkills(root, P, [A, B])).find((entry) => entry.agentId === A),
    ).toMatchObject({ status: "conflict", reason: "local_skill" });
    await fs.writeFile(file(B, "reference/local.txt"), "My edit");
    await install(DEFAULT_AGENT_ID, "New source");
    expect((await synchronizeAgentSkills(root, P, [B]))[0]).toMatchObject({
      reason: "local_edits",
    });
    expect(await fs.readFile(file(A), "utf8")).toBe(content("Local instructions"));
    expect(await fs.readFile(file(B), "utf8")).toBe(content("Version one"));
    await fs.symlink(file(A), file(DEFAULT_AGENT_ID, "link.txt"));
    expect((await synchronizeAgentSkills(root, P, [B]))[0]).toMatchObject({ reason: "unreadable" });
    expect(await fs.readFile(file(B, "reference/local.txt"), "utf8")).toBe("My edit");
  });
  it("retains copies after source removal and waits for an explicit sync after edits", async () => {
    await install();
    await synchronizeAgentSkills(root, P, [A]);
    await removeSkill(root, P, DEFAULT_AGENT_ID, "shared");
    expect((await synchronizeAgentSkills(root, P, [A]))[0]).toMatchObject({
      reason: "source_removed",
    });
    expect(await fs.readFile(file(A), "utf8")).toBe(content("Version one"));
    await install(DEFAULT_AGENT_ID, "Later source");
    expect((await inspectAgentSkillSync(root, P, [A]))[0]!.status).toBe("pending");
    expect(await fs.readFile(file(A), "utf8")).toBe(content("Version one"));
    await synchronizeAgentSkills(root, P, [A]);
    expect(await fs.readFile(file(A), "utf8")).toBe(content("Later source"));
  });
  it("refuses invalid identifiers and never creates an absent target", async () => {
    await install();
    expect(await synchronizeAgentSkills(root, P, ["missing"])).toEqual([]);
    await expect(fs.access(agentStateDir(root, P, "missing"))).rejects.toThrow();
    expect(() => synchronizeAgentSkills(root, P, ["../outside"])).toThrow(/agent_id/);
    expect(await listInstalledSkills(root, P, A)).toEqual([]);
  });
  it("does not claim ownership of content imported from another Project", async () => {
    await install();
    await synchronizeAgentSkills(root, P, [A]);
    const markPath = path.join(agentStateDir(root, P, A), "skill-sync/shared.json");
    const mark = JSON.parse(await fs.readFile(markPath, "utf8")) as {
      hash: string;
      projectId: string;
    };
    await fs.writeFile(markPath, JSON.stringify({ ...mark, projectId: "other-project" }));
    await install(DEFAULT_AGENT_ID, "Source changed");
    expect((await synchronizeAgentSkills(root, P, [A]))[0]).toMatchObject({
      status: "conflict",
      reason: "local_edits",
    });
    expect(await fs.readFile(file(A), "utf8")).toBe(content("Version one"));
  });

  it("keeps a concurrent destination edit when a staged replacement is refused", async () => {
    await install(A);
    await expect(
      replaceSkillDirectory(path.dirname(file(A)), [["SKILL.md", "New source"]], {
        beforeReplace: async () => {
          await fs.writeFile(file(A), "Concurrent local edit");
          throw new Error("Destination changed");
        },
      }),
    ).rejects.toThrow("Destination changed");
    expect(await fs.readFile(file(A), "utf8")).toBe("Concurrent local edit");
    expect(await fs.readdir(skillsDir(root, P, A))).toEqual(["shared"]);
  });
});
