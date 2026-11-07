/** Project-local skill sources: the Agent's files, then the General Agent's shared files. */
import fs from "node:fs/promises";
import path from "node:path";
import { assertValidId } from "./ids.js";
import { DEFAULT_AGENT_ID } from "./paths.js";

export function skillStateDirectories(stateDir: string): string[] {
  const paths = /^[A-Za-z]:[\\/]/.test(stateDir) ? path.win32 : path;
  // A recorded nonstandard state path has no Project sibling to infer.
  if (
    paths.basename(stateDir) !== "agent_state" ||
    paths.basename(paths.dirname(paths.dirname(stateDir))) !== "agents"
  )
    return [stateDir];
  const shared = paths.resolve(stateDir, "..", "..", DEFAULT_AGENT_ID, "agent_state");
  return paths.resolve(stateDir) === shared ? [stateDir] : [stateDir, shared];
}

/** Reads never create directories; only an existing entry can be selected or copied. */
export async function resolveSkillDirectory(stateDir: string, name: string): Promise<string> {
  assertValidId("skill_name", name);
  for (const source of skillStateDirectories(stateDir)) {
    const dir = path.join(source, "skills", name);
    try {
      await fs.access(path.join(dir, "SKILL.md"));
      return dir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const error = new Error(`Skill is not available: ${name}`) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  throw error;
}
