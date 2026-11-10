/** Resolve abbreviated code citations against the Workspace's visible source files. */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { WorkspaceFiles } from "../mechanisms/workspace.js";
import { HttpError } from "../http/errors.js";
import { SEARCH_MAX_QUERY_LEN } from "./workspace-files-service.js";

const run = promisify(execFile);

export async function resolveEditorFile(
  files: WorkspaceFiles,
  workspace: string,
  rel: string,
): Promise<string> {
  let missing: HttpError;
  try {
    return await files.resolvePath(workspace, rel);
  } catch (error) {
    if (!(error instanceof HttpError) || error.code !== "path_not_found" || /[/\\]/.test(rel))
      throw error;
    missing = error;
  }

  const base = await files.resolvePath(workspace, "");
  let candidates: string[];
  const literal = Array.from(rel, (char) => ("*?[]\\".includes(char) ? `\\${char}` : char)).join(
    "",
  );
  try {
    // Git's index omits ignored build trees without walking their generated files.
    const { stdout } = await run(
      "git",
      [
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        `:(glob)**/${literal}`,
      ],
      { cwd: base, encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 },
    );
    candidates = stdout.split("\0").filter(Boolean);
  } catch {
    if (rel.length > SEARCH_MAX_QUERY_LEN) throw missing;
    const result = await files.search(workspace, rel);
    if (result.truncated)
      throw new HttpError(
        409,
        "editor_search_incomplete",
        "File search did not finish. Use the complete path inside this Workspace.",
      );
    candidates = result.hits
      .filter((hit) => hit.kind === "file" && path.basename(hit.path) === rel)
      .map((hit) => hit.path);
  }

  const found = new Set<string>();
  for (const candidate of new Set(candidates)) {
    try {
      const file = await files.resolvePath(workspace, candidate);
      if ((await fs.stat(file)).isFile()) found.add(file);
    } catch {
      // Stale index entries and links outside the Workspace cannot become editor targets.
    }
  }
  if (found.size === 0) throw missing;
  if (found.size > 1)
    throw new HttpError(
      409,
      "editor_file_ambiguous",
      "Several files have this name. Use the complete path inside this Workspace.",
    );
  return found.values().next().value!;
}
