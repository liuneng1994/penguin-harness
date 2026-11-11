/** Read-only Git changes within the same paths a Workspace file reader can reach. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import type { WorkspaceFiles } from "../mechanisms/workspace.js";
import { HttpError } from "../http/errors.js";

const run = promisify(execFile);
const LIMIT = 2 * 1024 * 1024;
export type GitDiffScope = "working" | "staged";
export interface WorkspaceGitDiff {
  available: boolean;
  path: string;
  scope: GitDiffScope;
  patch: string;
  binary: boolean;
  untracked: boolean;
}

async function git(cwd: string, args: string[], config: string[] = []): Promise<string> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_LITERAL_PATHSPECS: "1",
  };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[key];
  try {
    return (
      await run(
        "git",
        [
          "--no-pager",
          "-c",
          "core.fsmonitor=false",
          ...config.flatMap((entry) => ["-c", entry]),
          ...args,
        ],
        {
          cwd,
          env,
          encoding: "utf8",
          timeout: 5000,
          maxBuffer: LIMIT,
        },
      )
    ).stdout;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
      throw new HttpError(413, "diff_too_large", "Git changes exceed the 2 MB preview limit.");
    if (code === "ENOENT")
      throw new HttpError(503, "git_unavailable", "Git is not available on this server.");
    throw error;
  }
}

/** Missing files may still have deleted lines in Git; validate their existing ancestor. */
async function visible(files: WorkspaceFiles, base: string, rel: string): Promise<void> {
  const target = path.resolve(base, rel);
  const relative = path.relative(base, target);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    rel.includes("\0")
  )
    throw new HttpError(400, "invalid_path", "path must be inside the Workspace.");
  let candidate = relative;
  for (;;) {
    try {
      await files.resolvePath(base, candidate);
      return;
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== "path_not_found") throw error;
      candidate = path.dirname(candidate);
    }
  }
}

export async function readWorkspaceGit(
  files: WorkspaceFiles,
  workspace: string,
  rel: string,
  scope: GitDiffScope,
): Promise<WorkspaceGitDiff> {
  const base = await files.resolvePath(workspace, "");
  await visible(files, base, rel);
  try {
    const canonical = await files.resolvePath(base, rel);
    if (!(await fs.stat(canonical)).isFile())
      throw new HttpError(400, "invalid_path", "Select a file to preview Git changes.");
  } catch (error) {
    if (!(error instanceof HttpError) || error.code !== "path_not_found") throw error;
  }
  const result: WorkspaceGitDiff = {
    available: false,
    path: rel,
    scope,
    patch: "",
    binary: false,
    untracked: false,
  };
  try {
    if ((await git(base, ["rev-parse", "--is-inside-work-tree"])).trim() !== "true") return result;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    return result;
  }
  result.available = true;
  // A preview must not run repository-configured clean/process filters or diff drivers.
  let filters = "";
  try {
    filters = await git(base, [
      "config",
      "--name-only",
      "--get-regexp",
      "^filter\\..*\\.(clean|process|required)$",
    ]);
  } catch (error) {
    if ((error as { code?: unknown }).code !== 1) throw error;
  }
  const config = [
    ...new Set(
      filters
        .split("\n")
        .map((key) => /^filter\.(.+)\.(?:clean|process|required)$/.exec(key)?.[1])
        .filter((name): name is string => Boolean(name)),
    ),
  ].flatMap((name) => [
    `filter.${name}.clean=`,
    `filter.${name}.process=`,
    `filter.${name}.required=false`,
  ]);
  const status = await git(
    base,
    ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--", rel],
    config,
  );
  result.untracked = status.startsWith("??");
  if (scope === "working" && result.untracked) {
    const file = await files.read(base, rel, { maxBytes: LIMIT });
    if (file.truncated)
      throw new HttpError(413, "diff_too_large", "Git changes exceed the 2 MB preview limit.");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(file.data);
    } catch {
      result.binary = true;
      return result;
    }
    if (text.includes("\0")) {
      result.binary = true;
      return result;
    }
    if (!text) return result;
    const lines = text.split("\n");
    const newline = text.endsWith("\n");
    if (newline) lines.pop();
    result.patch = `--- /dev/null\n+++ ${JSON.stringify(`b/${rel}`)}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}\n${newline ? "" : "\\ No newline at end of file\n"}`;
    if (Buffer.byteLength(result.patch) > LIMIT)
      throw new HttpError(413, "diff_too_large", "Git changes exceed the 2 MB preview limit.");
    return result;
  }
  result.patch = await git(
    base,
    [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--no-renames",
      "--ignore-submodules=all",
      "--unified=3",
      ...(scope === "staged" ? ["--cached"] : []),
      "--",
      rel,
    ],
    config,
  );
  result.binary = /^Binary files .* differ$/m.test(result.patch);
  return result;
}
