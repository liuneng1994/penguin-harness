/**
 * - Given authorized Session and directory scopes, resolve the same existing file and position without changing it.
 * - Given absent, directory, escaped or unauthorized targets, refuse without exposing an openable path.
 * - Given the desktop window, open only a structured VS Code target; browser sessions and malformed input never launch anything.
 * - Given platform paths and SSH aliases, encode filenames and preserve the requested line and column.
 * - Given abbreviated filenames, locate a unique source file and refuse ambiguous references.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Dirent } from "node:fs";
import { SEARCH_MAX_ENTRIES } from "../src/services/workspace-files-service.js";
import type { AppEnv } from "../src/auth/middleware.js";
import { handleError } from "../src/http/errors.js";
import { desktopEditorRoutes } from "../src/http/routes/editor.js";
import { vscodeUri } from "../src/editor.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import type { SessionCreateResponse } from "../src/api/types.js";

describe("Workspace editor targets", () => {
  let t: TestApp, workspace: string, id: string;
  let owner: ReturnType<typeof apiClient>, outsider: ReturnType<typeof apiClient>;
  beforeAll(async () => {
    t = await createTestApp();
    owner = apiClient(t.app, (await provisionUser(t.app, "editor_owner")).cookie);
    outsider = apiClient(t.app, (await provisionUser(t.app, "editor_outsider")).cookie);
    const project = await owner.post("/api/projects", {
      projectId: "editor_owner-p",
      name: "Editor",
    });
    expect(project.status, JSON.stringify(await project.json())).toBe(201);
    const models = await owner.put("/api/projects/editor_owner-p/models", {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
    });
    expect(models.status, JSON.stringify(await models.json())).toBe(200);
    const response = await owner.post(
      "/api/projects/editor_owner-p/agents/default_agent/sessions",
      {},
    );
    const { session } = (await response.json()) as SessionCreateResponse;
    expect(response.status, JSON.stringify(session)).toBe(201);
    workspace = session.workspace;
    id = session.sessionId;
    await fs.mkdir(path.join(workspace, "src"));
    await fs.writeFile(path.join(workspace, "src", "报告 #100%.ts"), "Original content");
  });
  afterAll(async () => {
    await t.cleanup();
  });
  const query = () =>
    new URLSearchParams({ path: "src/报告 #100%.ts", line: "42", column: "7" }).toString();
  it("opens a unique abbreviated filename in a Workspace without Git", async () => {
    const params = new URLSearchParams({ path: "报告 #100%.ts", line: "42", column: "7" });
    const response = await owner.get(`/api/sessions/${id}/files/editor-target?${params}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      path: await fs.realpath(path.join(workspace, "src", "报告 #100%.ts")),
      workspace: await fs.realpath(workspace),
      line: 42,
      column: 7,
    });
  });
  it("resolves exact source filenames through Git despite ignored build copies", async () => {
    const repo = path.join(workspace, "git-editor");
    await fs.mkdir(path.join(repo, "src"), { recursive: true });
    await fs.mkdir(path.join(repo, "build"), { recursive: true });
    await fs.writeFile(path.join(repo, ".gitignore"), "build/\n");
    const name = "Expr[1] #%.cpp";
    await fs.writeFile(path.join(repo, "src", name), "Source");
    await fs.writeFile(path.join(repo, "build", name), "Generated copy");
    execFileSync("git", ["init", "--quiet", repo]);
    execFileSync("git", ["-C", repo, "add", "src", ".gitignore"]);
    const params = new URLSearchParams({ workspace: repo, path: name, line: "1047" });
    const response = await owner.get(
      `/api/projects/editor_owner-p/workspace-files/editor-target?${params}`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      path: await fs.realpath(path.join(repo, "src", name)),
      line: 1047,
    });
  });
  it("refuses ambiguous filenames instead of choosing a different source file", async () => {
    const repo = path.join(workspace, "ambiguous-editor");
    await fs.mkdir(path.join(repo, "src"), { recursive: true });
    await fs.mkdir(path.join(repo, "tests"), { recursive: true });
    await fs.writeFile(path.join(repo, "src", "Expr.cpp"), "Source");
    await fs.writeFile(path.join(repo, "tests", "Expr.cpp"), "Test source");
    execFileSync("git", ["init", "--quiet", repo]);
    execFileSync("git", ["-C", repo, "add", "src"]);
    const params = new URLSearchParams({ workspace: repo, path: "Expr.cpp" });
    const response = await owner.get(
      `/api/projects/editor_owner-p/workspace-files/editor-target?${params}`,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "editor_file_ambiguous" } });
  });
  it("does not treat an incomplete Workspace search as a unique match", async () => {
    const readdir = fs.readdir;
    const listing = Array.from({ length: SEARCH_MAX_ENTRIES + 1 }, (_, index) => ({
      name: `other-${index}.txt`,
      isDirectory: () => false,
      isSymbolicLink: () => false,
    })) as Dirent[];
    const spy = vi.spyOn(fs, "readdir").mockImplementation(async (...args) => {
      if (String(args[0]) === (await fs.realpath(workspace))) return listing as never;
      return readdir(...args);
    });
    try {
      const response = await owner.get(`/api/sessions/${id}/files/editor-target?path=unseen.cpp`);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "editor_search_incomplete" } });
    } finally {
      spy.mockRestore();
    }
  });
  it("does not open deleted files kept in Git's index", async () => {
    const repo = path.join(workspace, "stale-editor");
    await fs.mkdir(path.join(repo, "src"), { recursive: true });
    const file = path.join(repo, "src", "Gone.cpp");
    await fs.writeFile(file, "Original source");
    execFileSync("git", ["init", "--quiet", repo]);
    execFileSync("git", ["-C", repo, "add", "src"]);
    await fs.unlink(file);
    const params = new URLSearchParams({ workspace: repo, path: "Gone.cpp" });
    const response = await owner.get(
      `/api/projects/editor_owner-p/workspace-files/editor-target?${params}`,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "path_not_found" } });
  });
  it.skipIf(process.platform === "win32")(
    "does not resolve an abbreviated name through an escaping symlink",
    async () => {
      const repo = path.join(workspace, "escaping-editor");
      await fs.mkdir(path.join(repo, "src"), { recursive: true });
      const foreign = path.join(t.root, "Outside.cpp");
      await fs.writeFile(foreign, "Outside source");
      await fs.symlink(foreign, path.join(repo, "src", "Outside.cpp"));
      execFileSync("git", ["init", "--quiet", repo]);
      const params = new URLSearchParams({ workspace: repo, path: "Outside.cpp" });
      const response = await owner.get(
        `/api/projects/editor_owner-p/workspace-files/editor-target?${params}`,
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "path_not_found" } });
    },
  );
  it("resolves one file identically from a Session or a directory scope", async () => {
    const a = await owner.get(`/api/sessions/${id}/files/editor-target?${query()}`);
    const b = await owner.get(
      `/api/projects/editor_owner-p/workspace-files/editor-target?workspace=${encodeURIComponent(workspace)}&${query()}`,
    );
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await a.json()).toEqual({
      path: await fs.realpath(path.join(workspace, "src", "报告 #100%.ts")),
      workspace: await fs.realpath(workspace),
      line: 42,
      column: 7,
    });
    expect(await b.json()).toEqual({
      path: await fs.realpath(path.join(workspace, "src", "报告 #100%.ts")),
      workspace: await fs.realpath(workspace),
      line: 42,
      column: 7,
    });
    expect(await fs.readFile(path.join(workspace, "src", "报告 #100%.ts"), "utf8")).toBe(
      "Original content",
    );
  });
  it("refuses foreign, missing, directory and malformed-position targets", async () => {
    expect((await outsider.get(`/api/sessions/${id}/files/editor-target?${query()}`)).status).toBe(
      404,
    );
    expect(
      (
        await outsider.get(
          `/api/projects/editor_owner-p/workspace-files/editor-target?workspace=${encodeURIComponent(workspace)}&${query()}`,
        )
      ).status,
    ).toBe(404);
    expect((await t.app.request(`/api/sessions/${id}/files/editor-target?${query()}`)).status).toBe(
      401,
    );
    expect(
      (await owner.get(`/api/sessions/${id}/files/editor-target?path=missing.ts`)).status,
    ).toBe(404);
    expect((await owner.get(`/api/sessions/${id}/files/editor-target?path=src`)).status).toBe(400);
    expect(
      (await owner.get(`/api/sessions/${id}/files/editor-target?path=../outside.ts`)).status,
    ).toBe(400);
    for (const line of ["0", "-1", "no", "2147483648"]) {
      const params = new URLSearchParams(query());
      params.set("line", line);
      expect((await owner.get(`/api/sessions/${id}/files/editor-target?${params}`)).status).toBe(
        400,
      );
    }
  });
});

describe("Desktop editor launcher", () => {
  function app(enabled: boolean, via: "desktop" | "password", calls: string[], fail = false) {
    const host = new Hono<AppEnv>();
    host.use("*", async (c, next) => {
      c.set("sessionVia", via);
      await next();
    });
    host.onError(handleError);
    host.route(
      "/",
      desktopEditorRoutes({
        enabled,
        openUri: async (uri) => {
          calls.push(uri);
          if (fail) throw new Error("Editor unavailable");
        },
      }),
    );
    return host;
  }
  const request = (host: Hono<AppEnv>, body: unknown) =>
    host.request("/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  it("launches the desktop user's editor at the requested remote file position", async () => {
    const calls: string[] = [];
    expect(
      (
        await request(app(true, "desktop", calls), {
          path: "/repo/a b#%.ts",
          line: 42,
          column: 7,
          sshAlias: "my-dev",
        })
      ).status,
    ).toBe(204);
    expect(calls).toEqual(["vscode://vscode-remote/ssh-remote+my-dev/repo/a%20b%23%25.ts:42:7"]);
  });
  it("does not launch programs for a browser, disabled desktop mode or malformed targets", async () => {
    const calls: string[] = [];
    expect((await request(app(false, "desktop", calls), { path: "/a.ts" })).status).toBe(404);
    expect((await request(app(true, "password", calls), { path: "/a.ts" })).status).toBe(403);
    for (const body of [
      { uri: "javascript:bad" },
      { path: "relative.ts" },
      { path: "/a.ts", line: 0 },
      { path: "/a.ts", sshAlias: "bad/alias" },
    ])
      expect((await request(app(true, "desktop", calls), body)).status).toBe(400);
    expect(calls).toEqual([]);
  });
  it("reports an unavailable editor instead of acknowledging a launch", async () => {
    expect((await request(app(true, "desktop", [], true), { path: "/a.ts" })).status).toBe(502);
  });
  it("preserves Windows drive paths, encoded filenames and default file positioning", () => {
    const uri = vscodeUri({ path: "C:\\repo\\报告 #100%.ts", line: 9, column: 2 });
    expect(decodeURIComponent(new URL(uri).pathname)).toBe("/C:/repo/报告 #100%.ts:9:2");
    expect(vscodeUri({ path: "/repo/a.ts", line: 1, column: 1 })).toBe(
      "vscode://file/repo/a.ts:1:1",
    );
  });
});
