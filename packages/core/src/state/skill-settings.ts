/** Per-Agent skill switches, separate from installed content so updates preserve them. */
import fs from "node:fs/promises";
import path from "node:path";
import { parseSkillsMessage } from "@prismshadow/amsp/markers";
import { isCompleteModelMessage } from "@prismshadow/amsp/records";
import type { AmspRecord } from "@prismshadow/amsp/records";
import { atomicWriteFile } from "../internal/atomic-write.js";
import { agentStateDir } from "./paths.js";
import { assertValidId } from "./ids.js";

function settingPath(stateDir: string, name: string): string {
  assertValidId("skill_name", name);
  return path.join(stateDir, "skill-settings", `${name}.json`);
}

export async function skillEnabled(stateDir: string, name: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(settingPath(stateDir, name), "utf8");
  } catch (error) {
    // Absence means enabled for both existing and newly installed skills. This is the
    // permanent default, not a legacy reader; no migration or compatibility shim to remove.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
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
  await fs.access(path.join(stateDir, "skills", name, "SKILL.md"));
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

/** Match only a skill's own entry file; ordinary workspace SKILL.md files are not skills. */
export function installedSkillRead(
  stateDir: string,
  workspace: string,
  filePath: string,
): string | null {
  const paths = /^[A-Za-z]:[\\/]/.test(stateDir) ? path.win32 : path;
  const relative = paths.relative(
    paths.join(stateDir, "skills"),
    paths.resolve(workspace, filePath),
  );
  const parts = relative.split(paths.sep);
  if (parts.length !== 2 || parts[1] !== "SKILL.md" || !/^[A-Za-z0-9_-]+$/.test(parts[0]!))
    return null;
  return parts[0]!;
}
