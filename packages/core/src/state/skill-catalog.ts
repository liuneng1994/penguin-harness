/** Installed content and the effective Project-local catalog, without copying shared files. */
import fs from "node:fs/promises";
import path from "node:path";
import { parseSkillFrontmatter } from "../plugin/skill-frontmatter.js";
import type { SkillMetadata } from "../plugin/skill-frontmatter.js";
import { assertValidId, isValidId } from "./ids.js";
import { agentStateDir, DEFAULT_AGENT_ID, skillsDir } from "./paths.js";
import { skillEnabled } from "./skill-settings.js";

export interface InstalledSkill extends SkillMetadata {
  /** Absent means enabled; settings belong to the consuming Agent. */
  enabled?: boolean;
  icon?: string;
  /** Present only when borrowing the General Agent's content. */
  sourceAgentId?: string;
  pathToSkillMd?: string;
  /** A private skill takes precedence over a shared skill with this name. */
  overridesShared?: boolean;
}

async function skillFiles(dir: string): Promise<InstalledSkill[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const result: InstalledSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidId(entry.name)) continue;
    let raw: string;
    try {
      raw = await fs.readFile(path.join(dir, entry.name, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    let icon: string | undefined;
    try {
      icon = await fs.readFile(path.join(dir, entry.name, "icon.svg"), "utf8");
    } catch {
      // Icons are optional. Directory names supply identity even with malformed frontmatter.
    }
    result.push({
      ...(parseSkillFrontmatter(raw) ?? { description: "", version: "" }),
      name: entry.name,
      ...(icon !== undefined ? { icon } : {}),
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

async function withSettings(stateDir: string, skills: InstalledSkill[]): Promise<InstalledSkill[]> {
  return Promise.all(
    skills.map(async (skill) => ({
      ...skill,
      ...(!(await skillEnabled(stateDir, skill.name)) ? { enabled: false } : {}),
    })),
  );
}

/** Local inventory stays separate from availability for installs, exports and plugin management. */
export async function listInstalledSkills(
  root: string,
  projectId: string,
  agentId: string,
): Promise<InstalledSkill[]> {
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);
  return withSettings(
    agentStateDir(root, projectId, agentId),
    await skillFiles(skillsDir(root, projectId, agentId)),
  );
}

/** General's existing directory is the shared source permanently; no data migration is needed. */
export async function listAvailableSkills(
  root: string,
  projectId: string,
  agentId: string,
): Promise<InstalledSkill[]> {
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);
  const stateDir = agentStateDir(root, projectId, agentId);
  const local = await skillFiles(skillsDir(root, projectId, agentId));
  if (agentId === DEFAULT_AGENT_ID) return withSettings(stateDir, local);
  const sharedDir = skillsDir(root, projectId, DEFAULT_AGENT_ID);
  const shared = await skillFiles(sharedDir);
  const names = new Set(local.map((skill) => skill.name));
  const sharedNames = new Set(shared.map((skill) => skill.name));
  const available = [
    ...local.map((skill) => ({
      ...skill,
      ...(sharedNames.has(skill.name) ? { overridesShared: true } : {}),
    })),
    ...shared
      .filter((skill) => !names.has(skill.name))
      .map((skill) => ({
        ...skill,
        sourceAgentId: DEFAULT_AGENT_ID,
        pathToSkillMd: path.join(sharedDir, skill.name, "SKILL.md"),
      })),
  ];
  return withSettings(
    stateDir,
    available.sort((a, b) => a.name.localeCompare(b.name)),
  );
}
