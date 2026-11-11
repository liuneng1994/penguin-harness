/**
 * - Working and staged previews read only the requested file and leave Git's index unchanged.
 * - New, empty, deleted, binary and metadata-only files have useful bounded previews, including unborn repositories.
 * - Nested workspaces and literal filenames stay confined; symlink/path escapes are refused.
 * - Repository-configured diff and clean filters never execute during a preview.
 * - Session routes authorize before reading Git and reject invalid scopes and missing paths.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readWorkspaceGit } from "../src/services/workspace-git.js";
import { WorkspaceFilesService } from "../src/services/workspace-files-service.js";
import {
  apiClient,
  canCreateSymlink,
  createTestApp,
  loginAdmin,
  makeTempRoot,
  provisionUser,
} from "./helpers.js";
import type { TestApp } from "./helpers.js";
const run = promisify(execFile);
const files = new WorkspaceFilesService();
let root: string;
const git = async (...args: string[]) => (await run("git", args, { cwd: root })).stdout;
const commit = async () => {
  await git("add", ".");
  await git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "commit",
    "-qm",
    "initial",
  );
};
describe("current-file Git previews", () => {
  beforeEach(async () => {
    root = await makeTempRoot();
    await git("init", "-q");
    await fs.writeFile(path.join(root, "file.cpp"), "int value = 1;\n");
    await fs.writeFile(path.join(root, "other.cpp"), "int other = 1;\n");
    await commit();
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  it("separates staged and working changes without other files or index writes", async () => {
    await fs.writeFile(path.join(root, "file.cpp"), "int value = 2;\n");
    await git("add", "file.cpp");
    await fs.writeFile(path.join(root, "file.cpp"), "int value = 3;\n");
    await fs.writeFile(path.join(root, "other.cpp"), "unrelated-secret\n");
    const index = await fs.readFile(path.join(root, ".git/index"));
    const working = await readWorkspaceGit(files, root, "file.cpp", "working");
    expect(working.patch).toContain("-int value = 2;");
    expect(working.patch).toContain("+int value = 3;");
    expect(working.patch).not.toContain("unrelated-secret");
    const staged = await readWorkspaceGit(files, root, "file.cpp", "staged");
    expect(staged.patch).toContain("-int value = 1;");
    expect(staged.patch).toContain("+int value = 2;");
    expect(await fs.readFile(path.join(root, ".git/index"))).toEqual(index);
  });
  it("previews new and empty files and reports no staged changes until added", async () => {
    await fs.writeFile(path.join(root, "new.cpp"), "new source");
    const added = await readWorkspaceGit(files, root, "new.cpp", "working");
    expect(added.untracked).toBe(true);
    expect(added.patch).toContain("+new source\n\\ No newline");
    expect((await readWorkspaceGit(files, root, "new.cpp", "staged")).patch).toBe("");
    await fs.writeFile(path.join(root, "empty.cpp"), "");
    expect(await readWorkspaceGit(files, root, "empty.cpp", "working")).toMatchObject({
      untracked: true,
      patch: "",
    });
  });
  it("reads deleted lines from Git and staged additions before the first commit", async () => {
    await fs.rm(path.join(root, "file.cpp"));
    expect((await readWorkspaceGit(files, root, "file.cpp", "working")).patch).toContain(
      "-int value = 1;",
    );
    const nested = path.join(root, "new-repo");
    await fs.mkdir(nested);
    await run("git", ["init", "-q"], { cwd: nested });
    await fs.writeFile(path.join(nested, "new.cpp"), "initial source\n");
    await run("git", ["add", "."], { cwd: nested });
    expect((await readWorkspaceGit(files, nested, "new.cpp", "staged")).patch).toContain(
      "+initial source",
    );
  });
  it("uses literal pathspecs inside nested workspaces without matching neighboring files", async () => {
    await fs.mkdir(path.join(root, "sub "));
    await fs.writeFile(path.join(root, "sub ", "[x].cpp"), "old\n");
    await fs.writeFile(path.join(root, "sub ", "x.cpp"), "other\n");
    await commit();
    await fs.writeFile(path.join(root, "sub ", "[x].cpp"), "new\n");
    await fs.writeFile(path.join(root, "sub ", "x.cpp"), "neighbor-secret\n");
    const result = await readWorkspaceGit(files, path.join(root, "sub "), "[x].cpp", "working");
    expect(result.patch).toContain("+new");
    expect(result.patch).not.toContain("neighbor-secret");
  });
  it("reports non-Git directories and binary files instead of drawing text hunks", async () => {
    const other = await makeTempRoot();
    try {
      expect((await readWorkspaceGit(files, other, "file.cpp", "working")).available).toBe(false);
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
    await fs.writeFile(path.join(root, "binary.cpp"), Buffer.from([0, 1, 2]));
    expect((await readWorkspaceGit(files, root, "binary.cpp", "working")).binary).toBe(true);
    await commit();
    await fs.writeFile(path.join(root, "binary.cpp"), Buffer.from([0, 2, 3]));
    expect((await readWorkspaceGit(files, root, "binary.cpp", "working")).binary).toBe(true);
  });
  it("refuses oversized text and paths escaping the Workspace", async () => {
    await expect(readWorkspaceGit(files, root, ".", "working")).rejects.toMatchObject({
      status: 400,
    });
    await fs.writeFile(path.join(root, "large.cpp"), "x".repeat(2 * 1024 * 1024 + 1));
    await expect(readWorkspaceGit(files, root, "large.cpp", "working")).rejects.toMatchObject({
      status: 413,
    });
    await fs.writeFile(path.join(root, "file.cpp"), "x".repeat(2 * 1024 * 1024 + 1));
    await expect(readWorkspaceGit(files, root, "file.cpp", "working")).rejects.toMatchObject({
      status: 413,
    });
    await fs.writeFile(path.join(root, "large.cpp"), "x".repeat(2 * 1024 * 1024));
    await expect(readWorkspaceGit(files, root, "large.cpp", "working")).rejects.toMatchObject({
      status: 413,
    });
    await expect(readWorkspaceGit(files, root, "../outside.cpp", "staged")).rejects.toMatchObject({
      status: 400,
    });
  });
  it("exposes file-mode changes without inventing textual hunks", async () => {
    await git("update-index", "--chmod=+x", "file.cpp");
    const result = await readWorkspaceGit(files, root, "file.cpp", "staged");
    expect(result.patch).toContain("new mode 100755");
    expect(result.patch).not.toContain("@@");
    expect(result.binary).toBe(false);
  });
  it.skipIf(!canCreateSymlink())("refuses a symlink escaping the Workspace", async () => {
    const other = await makeTempRoot();
    try {
      await fs.writeFile(path.join(other, "secret.cpp"), "secret\n");
      await fs.symlink(path.join(other, "secret.cpp"), path.join(root, "link.cpp"));
      await expect(readWorkspaceGit(files, root, "link.cpp", "working")).rejects.toMatchObject({
        status: 400,
      });
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
  });
  it("does not execute configured diff or clean filters", async () => {
    await fs.writeFile(
      path.join(root, "driver.cjs"),
      "require('fs').writeFileSync('filter-ran', 'yes');",
    );
    await fs.writeFile(path.join(root, ".gitattributes"), "file.cpp diff=preview filter=preview\n");
    await git("config", "diff.preview.command", "node driver.cjs");
    await git("config", "diff.preview.textconv", "node driver.cjs");
    await git("config", "filter.preview.clean", "node driver.cjs");
    await git("config", "filter.preview.process", "node driver.cjs");
    await git("config", "filter.preview.required", "true");
    await fs.writeFile(path.join(root, "file.cpp"), "new source\n");
    expect((await readWorkspaceGit(files, root, "file.cpp", "working")).patch).toContain(
      "+new source",
    );
    await expect(fs.stat(path.join(root, "filter-ran"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("Git preview routes", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.cleanup();
  });
  it("authorizes the Session and validates scope/path before reading Git", async () => {
    const client = apiClient(app.app, (await loginAdmin(app.app)).cookie);
    const workspace = await fs.mkdtemp(path.join(app.root, "git-workspace-"));
    await client.put("/api/projects/default_project/models", {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
    });
    const created = await client.post(
      "/api/projects/default_project/agents/default_agent/sessions",
      { workspace },
    );
    expect(created.ok).toBe(true);
    const sessionId = ((await created.json()) as { session: { sessionId: string } }).session
      .sessionId;
    const url = `/api/sessions/${sessionId}/files/git-diff`;
    expect((await client.get(`${url}?path=file.cpp`)).status).toBe(200);
    expect((await client.get(`${url}?path=file.cpp&scope=wrong`)).status).toBe(400);
    expect((await client.get(url)).status).toBe(400);
    const other = apiClient(
      app.app,
      (await provisionUser(app.app, "git_other", "password123")).cookie,
    );
    expect((await other.get(`${url}?path=file.cpp`)).status).toBe(404);
  });
});
