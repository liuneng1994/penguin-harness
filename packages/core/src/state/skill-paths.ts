/** Project-local skill sources: the Agent's files, then the General Agent's shared files. */
import fs from "node:fs/promises";
import path from "node:path";
import { assertValidId, isValidId } from "./ids.js";
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

/** Lexical matching remains available for missing entries and Traces recorded on another host. */
export function installedSkillRead(
  stateDir: string,
  workspace: string,
  filePath: string,
): string | null {
  const paths = /^[A-Za-z]:[\\/]/.test(stateDir) ? path.win32 : path;
  for (const source of skillStateDirectories(stateDir)) {
    const relative = paths.relative(
      paths.join(source, "skills"),
      paths.resolve(workspace, filePath),
    );
    const parts = relative.split(paths.sep);
    if (parts.length === 2 && parts[1] === "SKILL.md" && isValidId(parts[0]!)) return parts[0]!;
  }
  return null;
}

/** Use the directory's stored name for switches, even through case aliases or symlinks.
 * Resolve afresh for live tool calls: a symlink or an installed entry can change between calls.
 * The lexical fallback is permanent for retained Traces whose files are no longer on this host.
 */
export async function resolveInstalledSkillRead(
  stateDir: string,
  workspace: string,
  filePath: string,
): Promise<string | null> {
  const fallback = installedSkillRead(stateDir, workspace, filePath);
  if (/^[A-Za-z]:[\\/]/.test(stateDir) && process.platform !== "win32") return fallback;
  let target: string;
  try {
    target = await fs.realpath(path.resolve(workspace, filePath));
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? ""))
      return fallback;
    throw error;
  }
  for (const source of skillStateDirectories(stateDir)) {
    const base = path.join(source, "skills");
    let entries;
    try {
      entries = await fs.readdir(base, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    // Prefer the addressed entry if several entries link to the same file.
    entries.sort((a, b) => Number(b.name === fallback) - Number(a.name === fallback));
    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidId(entry.name)) continue;
      try {
        const canonical = await fs.realpath(path.join(base, entry.name, "SKILL.md"));
        if (path.relative(canonical, target) === "") return entry.name;
      } catch (error) {
        if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
        throw error;
      }
    }
  }
  return fallback;
}
