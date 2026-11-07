/**
 * - Given General's existing files, consumers discover them disabled without copying or writing settings; General keeps its default enabled state.
 * - Given shared content, switches belong to consumers; a disabled private override never falls back to the source.
 * - Given a private version, source updates preserve it and removing it restores sharing with the same switch.
 * - Given another Project or another Agent's entry path, sharing and read attribution stay within their scope.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  agentStateDir,
  DEFAULT_AGENT_ID,
  installSkill,
  installedSkillRead,
  listAvailableSkills,
  listInstalledSkills,
  removeSkill,
  resolveSkillDirectory,
  setSkillEnabled,
  skillMetadataSection,
  skillsDir,
  skillEnabled,
  preserveSharedSkillSwitch,
} from "../src/state/index.js";

let root: string;
const P = "shared",
  A = "writer",
  G = DEFAULT_AGENT_ID;
const install = (agentId: string, body = "Original", projectId = P) =>
  installSkill(root, projectId, agentId, {
    name: "demo",
    content: `---\nname: demo\ndescription: Shared instructions\n---\n${body}\n`,
    files: { "references/info.txt": "Preserve this" },
  });
const state = () => agentStateDir(root, P, A);
const source = () => path.join(skillsDir(root, P, G), "demo", "SKILL.md");
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "shared-skills-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("General's shared skills", () => {
  it("discovers existing skills for every consumer without writing a copy or changing the source", async () => {
    await install(G);
    const before = await fs.readFile(source(), "utf8");
    for (const agentId of [A, "new_agent"]) {
      const skills = await listAvailableSkills(root, P, agentId);
      expect(skills).toEqual([
        expect.objectContaining({ name: "demo", sourceAgentId: G, pathToSkillMd: source() }),
      ]);
      expect(skills[0]!.enabled).toBe(false);
      expect(skillMetadataSection(skills)).toBe("");
      expect(await listInstalledSkills(root, P, agentId)).toEqual([]);
      await expect(fs.access(agentStateDir(root, P, agentId))).rejects.toThrow();
    }
    expect(await fs.readFile(source(), "utf8")).toBe(before);
    expect((await listAvailableSkills(root, P, G))[0]!.sourceAgentId).toBeUndefined();
    expect(await skillEnabled(agentStateDir(root, P, G), "demo")).toBe(true);
  });

  it("keeps switches independent and does not fall back around a disabled private version", async () => {
    await install(G);
    await setSkillEnabled(root, P, G, "demo", false);
    expect(skillMetadataSection(await listAvailableSkills(root, P, A))).toBe("");
    await setSkillEnabled(root, P, A, "demo", true);
    expect(skillMetadataSection(await listAvailableSkills(root, P, A))).toContain("demo");
    await setSkillEnabled(root, P, A, "demo", false);
    expect(skillMetadataSection(await listAvailableSkills(root, P, A))).toBe("");
    expect(skillMetadataSection(await listAvailableSkills(root, P, "other"))).toBe("");
    await install(A, "Private");
    const skills = await listAvailableSkills(root, P, A);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ enabled: false, overridesShared: true });
    expect(skills[0]!.sourceAgentId).toBeUndefined();
    expect(await resolveSkillDirectory(state(), "demo")).toBe(
      path.join(skillsDir(root, P, A), "demo"),
    );
    expect(skillMetadataSection(skills)).toBe("");
  });

  it("preserves private content across source updates and restores shared files on removal", async () => {
    await install(G);
    await install(A, "Private");
    await setSkillEnabled(root, P, A, "demo", false);
    await install(G, "Updated source");
    const privateDir = await resolveSkillDirectory(state(), "demo");
    expect(await fs.readFile(path.join(privateDir, "SKILL.md"), "utf8")).toContain("Private");
    await removeSkill(root, P, A, "demo");
    expect(await resolveSkillDirectory(state(), "demo")).toBe(path.dirname(source()));
    expect((await listAvailableSkills(root, P, A))[0]).toMatchObject({
      sourceAgentId: G,
      enabled: false,
    });
    expect(await fs.readFile(source(), "utf8")).toContain("Updated source");
    await setSkillEnabled(root, P, A, "demo", true);
    expect(skillMetadataSection(await listAvailableSkills(root, P, A))).toContain("shared entry:");
  });

  it("keeps explicit enablement across source updates and new skills disabled for consumers", async () => {
    await install(G);
    await setSkillEnabled(root, P, A, "demo", true);
    await install(G, "Updated shared instructions");
    expect(skillMetadataSection(await listAvailableSkills(root, P, A))).toContain(
      JSON.stringify(source()),
    );
    expect(await skillEnabled(agentStateDir(root, P, "other"), "demo")).toBe(false);
    await install(A, "Private instructions");
    expect(await skillEnabled(state(), "demo")).toBe(true);
  });

  it("preserves an explicit switch while materializing shared defaults concurrently", async () => {
    await install(G);
    await Promise.all([
      preserveSharedSkillSwitch(state(), "demo"),
      setSkillEnabled(root, P, A, "demo", true),
    ]);
    expect(await skillEnabled(state(), "demo")).toBe(true);
    await preserveSharedSkillSwitch(state(), "demo");
    expect(await skillEnabled(state(), "demo")).toBe(true);
    expect(await fs.readdir(path.join(state(), "skill-settings"))).toEqual(["demo.json"]);
  });

  it("keeps sharing and entry-read attribution inside one Project and supports recorded Windows paths", async () => {
    await install(G);
    expect(await listAvailableSkills(root, "other_project", A)).toEqual([]);
    expect(installedSkillRead(state(), root, source())).toBe("demo");
    expect(
      installedSkillRead(state(), root, path.join(skillsDir(root, P, "other"), "demo", "SKILL.md")),
    ).toBeNull();
    expect(
      installedSkillRead(
        state(),
        root,
        path.join(skillsDir(root, "other_project", G), "demo", "SKILL.md"),
      ),
    ).toBeNull();
    const winState = "C:\\data\\projects\\p\\agents\\writer\\agent_state";
    expect(
      installedSkillRead(
        winState,
        "C:\\work",
        "C:\\data\\projects\\p\\agents\\default_agent\\agent_state\\skills\\demo\\SKILL.md",
      ),
    ).toBe("demo");
    expect(installedSkillRead(winState, "C:\\work", "C:\\work\\SKILL.md")).toBeNull();
  });
});
