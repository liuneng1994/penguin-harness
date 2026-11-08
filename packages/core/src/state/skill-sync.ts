/** Explicit Project-local skill sharing from the General Agent; previews never write. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { atomicWriteFile } from "../internal/atomic-write.js";
import { assertValidId, isValidId } from "./ids.js";
import { agentStateDir, DEFAULT_AGENT_ID, skillsDir, systemConfigPath } from "./paths.js";
import { replaceSkillDirectory } from "./agent-state.js";
import { preserveSharedSkillSwitch } from "./skill-settings.js";

export interface SkillSyncEntry {
  agentId: string;
  name: string;
  status: "pending" | "synced" | "current" | "conflict";
  reason?: "local_skill" | "local_edits" | "source_removed" | "unreadable";
}

/** A directory snapshot with no links followed, bounded by the same role as a skill archive. */
async function filesIn(dir: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  let bytes = 0;
  const walk = async (current: string, relative: string): Promise<void> => {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(file, name);
      else if (entry.isFile()) {
        const stat = await fs.stat(file);
        bytes += stat.size;
        if (bytes > 64 * 1024 * 1024 || files.size >= 4096)
          throw new Error("Skill exceeds the sync snapshot limit.");
        files.set(name, await fs.readFile(file));
      } else throw new Error("Skill contains a link or a non-regular file.");
    }
  };
  await walk(dir, "");
  return files;
}

function digest(files: Map<string, Uint8Array>): string {
  const hash = createHash("sha256");
  for (const name of [...files.keys()].sort()) {
    const bytes = files.get(name)!;
    hash.update(JSON.stringify([name, bytes.byteLength]));
    hash.update(bytes);
  }
  return hash.digest("hex");
}

class SyncConflict extends Error {
  constructor(readonly reason: "local_skill" | "local_edits") {
    super(reason);
  }
}
const queues = new Map<string, Promise<SkillSyncEntry[]>>();

/** All callers in this process serialize per Project; different target requests are never dropped. */
export function synchronizeAgentSkills(
  root: string,
  projectId: string,
  agentIds: readonly string[],
): Promise<SkillSyncEntry[]> {
  assertValidId("project_id", projectId);
  for (const id of agentIds) assertValidId("agent_id", id);
  const key = JSON.stringify([root, projectId]);
  const previous = queues.get(key);
  const run = (previous ? previous.catch(() => []) : Promise.resolve([])).then(() =>
    synchronize(root, projectId, [...new Set(agentIds)], true),
  );
  queues.set(key, run);
  void run
    .finally(() => {
      if (queues.get(key) === run) queues.delete(key);
    })
    .catch(() => {});
  return run;
}

/** Read-only preview of what an explicit sync would install, update or preserve. */
export function inspectAgentSkillSync(
  root: string,
  projectId: string,
  agentIds: readonly string[],
): Promise<SkillSyncEntry[]> {
  assertValidId("project_id", projectId);
  for (const id of agentIds) assertValidId("agent_id", id);
  return synchronize(root, projectId, [...new Set(agentIds)], false);
}

async function synchronize(
  root: string,
  projectId: string,
  agentIds: string[],
  apply: boolean,
): Promise<SkillSyncEntry[]> {
  const sourceDir = skillsDir(root, projectId, DEFAULT_AGENT_ID);
  let names: string[];
  try {
    names = (await fs.readdir(sourceDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && isValidId(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") names = [];
    else throw error;
  }
  const source = new Map<string, { files: Map<string, Uint8Array>; hash: string } | null>();
  for (const name of names) {
    try {
      const files = await filesIn(path.join(sourceDir, name));
      if (!files.has("SKILL.md")) continue;
      source.set(name, { files, hash: digest(files) });
    } catch {
      source.set(name, null);
    }
  }
  const result: SkillSyncEntry[] = [];
  for (const agentId of agentIds) {
    if (agentId === DEFAULT_AGENT_ID) continue;
    try {
      await fs.access(systemConfigPath(root, projectId, agentId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const marksDir = path.join(agentStateDir(root, projectId, agentId), "skill-sync");
    const marks = new Map<string, string | null>();
    try {
      for (const entry of await fs.readdir(marksDir, { withFileTypes: true })) {
        const name = entry.name.slice(0, -5);
        if (!entry.isFile() || !entry.name.endsWith(".json") || !isValidId(name)) continue;
        try {
          const mark = JSON.parse(await fs.readFile(path.join(marksDir, entry.name), "utf8")) as {
            hash?: unknown;
            projectId?: unknown;
          };
          marks.set(
            name,
            typeof mark?.hash === "string" && mark.projectId === projectId ? mark.hash : null,
          );
        } catch {
          marks.set(name, null);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        for (const name of source.keys())
          result.push({ agentId, name, status: "conflict", reason: "unreadable" });
        continue;
      }
    }
    for (const [name, snapshot] of source) {
      const target = path.join(skillsDir(root, projectId, agentId), name);
      const entry: SkillSyncEntry = { agentId, name, status: "conflict" };
      try {
        if (snapshot === null) {
          result.push({ ...entry, reason: "unreadable" });
          continue;
        }
        let current: Map<string, Uint8Array> | null = null;
        let exists = false;
        try {
          const stat = await fs.lstat(target);
          exists = true;
          if (!stat.isDirectory()) throw new Error("Skill target is not a regular directory.");
          current = await filesIn(target);
        } catch (error) {
          if (exists || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (current !== null && !marks.has(name)) {
          result.push({ ...entry, reason: "local_skill" });
          continue;
        }
        const currentHash = current === null ? null : digest(current);
        if (currentHash !== null && currentHash !== marks.get(name)) {
          result.push({ ...entry, reason: "local_edits" });
          continue;
        }
        if (currentHash === snapshot.hash) {
          result.push({ ...entry, status: "current" });
          continue;
        }
        if (!apply) {
          result.push({ ...entry, status: "pending" });
          continue;
        }
        // Recheck directly before replacement: a local edit while the snapshot was read
        // must turn into a conflict rather than being overwritten by this sync.
        if (current !== null && digest(await filesIn(target)) !== currentHash) {
          result.push({ ...entry, reason: "local_edits" });
          continue;
        }
        await replaceSkillDirectory(target, snapshot.files, {
          beforeReplace: async () => {
            if (currentHash === null) {
              try {
                await fs.lstat(target);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                  await preserveSharedSkillSwitch(agentStateDir(root, projectId, agentId), name);
                  return;
                }
                throw error;
              }
              throw new SyncConflict("local_skill");
            }
            if (digest(await filesIn(target)) !== currentHash)
              throw new SyncConflict("local_edits");
          },
        });
        await fs.mkdir(marksDir, { recursive: true });
        await atomicWriteFile(
          path.join(marksDir, `${name}.json`),
          `${JSON.stringify({ hash: snapshot.hash, projectId })}\n`,
        );
        result.push({ ...entry, status: "synced" });
      } catch (error) {
        result.push({
          ...entry,
          reason: error instanceof SyncConflict ? error.reason : "unreadable",
        });
      }
    }
    // Removing a source never deletes installed content. This also keeps
    // local edits safe when the source is temporarily absent or its directory is unreadable.
    for (const name of marks.keys())
      if (!source.has(name))
        result.push({ agentId, name, status: "conflict", reason: "source_removed" });
  }
  return result;
}
