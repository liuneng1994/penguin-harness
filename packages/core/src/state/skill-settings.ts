/** Per-Agent skill switches, separate from installed content so updates preserve them. */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseSkillsMessage } from "@prismshadow/amsp/markers";
import { isCompleteModelMessage } from "@prismshadow/amsp/records";
import type { AmspRecord } from "@prismshadow/amsp/records";
import { atomicWriteFile } from "../internal/atomic-write.js";
import { agentStateDir } from "./paths.js";
import { assertValidId } from "./ids.js";
import { resolveSkillDirectory } from "./skill-paths.js";
export { installedSkillRead } from "./skill-paths.js";

function settingPath(stateDir: string, name: string): string {
  assertValidId("skill_name", name);
  return path.join(stateDir, "skill-settings", `${name}.json`);
}

export async function skillEnabled(stateDir: string, name: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(settingPath(stateDir, name), "utf8");
  } catch (error) {
    // Missing settings permanently enable owned files and disable borrowed General files.
    // Explicit choices take precedence; discovery never creates a setting or copies files.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        const dir = await resolveSkillDirectory(stateDir, name);
        return path.resolve(dir) === path.resolve(stateDir, "skills", name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
        throw error;
      }
    }
    throw error;
  }
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== "object" ||
    !("enabled" in value) ||
    typeof value.enabled !== "boolean"
  ) {
    throw new Error(`Invalid skill setting for ${name}: expected a boolean enabled field.`);
  }
  return value.enabled;
}

/** Materializing shared content keeps its default-off switch. Publish only if no explicit
 * setting exists, so a concurrent user toggle wins and readers never see a partial JSON file.
 */
export async function preserveSharedSkillSwitch(stateDir: string, name: string): Promise<void> {
  const file = settingPath(stateDir, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${name}.default-${randomUUID()}`);
  try {
    await atomicWriteFile(temporary, `${JSON.stringify({ enabled: false })}\n`);
    try {
      await fs.link(temporary, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

/** Atomic per-skill files keep simultaneous writes to different skills independent. */
export async function setSkillEnabled(
  root: string,
  projectId: string,
  agentId: string,
  name: string,
  enabled: boolean,
): Promise<void> {
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);
  const stateDir = agentStateDir(root, projectId, agentId);
  const file = settingPath(stateDir, name);
  // Refuse unknown skills before creating a settings directory.
  await resolveSkillDirectory(stateDir, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWriteFile(file, `${JSON.stringify({ enabled })}\n`);
}

/** A stale composer or SDK caller must not explicitly invoke a disabled skill. */
export async function assertSkillInvocationsEnabled(
  stateDir: string,
  messages: readonly AmspRecord[],
): Promise<void> {
  for (const msg of messages) {
    if (!isCompleteModelMessage(msg) || (msg.origin?.length ?? 0) > 0) continue;
    const p = msg.payload;
    if (p.type !== "text" || p.role !== "user") continue;
    const invocation = parseSkillsMessage(p.text);
    if (!invocation) continue;
    for (const name of new Set(invocation.skills)) {
      if (!(await skillEnabled(stateDir, name))) {
        throw new Error(
          `Skill ${name} is disabled. Enable it in the Agent's Skills settings before invoking it.`,
        );
      }
    }
  }
}
