/**
 * - Given a local file location, resolve it before invoking the browser's editor handler.
 * - Given remote files, use their owning node and the user's SSH mapping; desktop launch stays on this window's server.
 * - Given a missing file or unknown remote connection, do not launch an editor.
 * - Given different users or nodes, keep editor connection preferences independent.
 * - Given ownership refreshes during target resolution, keep the clicked node's connection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  openFileInVSCode,
  saveEditorSshAlias,
  editorSshAlias,
  editorConnectionConfigured,
} from "../src/features/chat/open-in-editor";
import { rememberSessionMachine, forgetSessionMachines } from "../src/lib/session-machines";
import type { FilesScope } from "../src/api/workspace-files";

describe("external editor file opening", () => {
  let calls: { url: string; body?: unknown }[], launch: string[], missing: boolean;
  beforeEach(() => {
    calls = [];
    launch = [];
    missing = false;
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    vi.stubGlobal("WebSocket", undefined);
    vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
      calls.push({ url, ...(init?.body ? { body: JSON.parse(init.body) } : {}) });
      if (url.includes("/desktop/editor/")) return new Response(null, { status: 204 });
      return new Response(
        JSON.stringify(
          missing
            ? { error: { code: "path_not_found", message: "File missing" } }
            : { path: "/repo/src/a b#%.ts", workspace: "/repo", line: 42, column: 7 },
        ),
        { status: missing ? 404 : 200, headers: { "content-type": "application/json" } },
      );
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    forgetSessionMachines();
  });
  const opts = () => ({
    userId: "u",
    desktop: false,
    launchUri: (uri: string) => launch.push(uri),
  });
  const scope: FilesScope = { kind: "session", sessionId: "s" };
  it("resolves a local location and opens exactly its encoded file and position", async () => {
    await openFileInVSCode(scope, { path: "src/a b#%.ts", line: 42, column: 7 }, opts());
    const request = calls.find((call) => call.url.includes("editor-target"))!;
    expect(new URL(request.url, "http://localhost").searchParams.get("path")).toBe("src/a b#%.ts");
    expect(launch).toEqual(["vscode://file/repo/src/a%20b%23%25.ts:42:7"]);
  });
  it("resolves remote files on their node and launches from the local desktop server", async () => {
    rememberSessionMachine("s", "remote-id");
    saveEditorSshAlias("u", scope, "client-dev");
    await openFileInVSCode(
      scope,
      { path: "src/a b#%.ts", line: 42, column: 7 },
      { ...opts(), desktop: true },
    );
    expect(calls.find((call) => call.url.includes("editor-target"))!.url).toContain(
      "/server/remote-id/api/sessions/s/",
    );
    expect(calls.find((call) => call.url.includes("desktop/editor"))).toEqual({
      url: "/api/desktop/editor/open",
      body: { path: "/repo/src/a b#%.ts", line: 42, column: 7, sshAlias: "client-dev" },
    });
    expect(launch).toEqual([]);
  });
  it("keeps connections per user and node, including explicit local overrides", () => {
    rememberSessionMachine("s", "ssh:server-dev");
    expect(editorSshAlias("u", scope)).toBe("server-dev");
    saveEditorSshAlias("u", scope, "client-dev");
    expect(editorSshAlias("u", scope)).toBe("client-dev");
    expect(editorSshAlias("other", scope)).toBe("server-dev");
    expect(
      editorSshAlias("u", {
        kind: "workspace",
        projectId: "p",
        workspace: "/repo",
        machineId: "ssh:another",
      }),
    ).toBe("another");
    saveEditorSshAlias("u", scope, "");
    expect(editorSshAlias("u", scope)).toBe("");
  });
  it("keeps the clicked connection if Session ownership changes during the request", async () => {
    rememberSessionMachine("s", "ssh:original");
    const fetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
      const result = await fetch(...args);
      rememberSessionMachine("s", "ssh:replacement");
      return result;
    });
    await openFileInVSCode(scope, { path: "src/a b#%.ts" }, opts());
    expect(launch).toEqual([
      "vscode://vscode-remote/ssh-remote+original/repo/src/a%20b%23%25.ts:42:7",
    ]);
  });
  it("does not launch for unresolved files or a remote node without a connection mapping", async () => {
    missing = true;
    await expect(openFileInVSCode(scope, { path: "missing.ts" }, opts())).rejects.toThrow();
    missing = false;
    rememberSessionMachine("s", "remote-id");
    await expect(openFileInVSCode(scope, { path: "src/a.ts" }, opts())).rejects.toThrow();
    expect(launch).toEqual([]);
    expect(calls.some((call) => call.url.includes("desktop/editor"))).toBe(false);
  });
  it("opens an unknown node locally only after an explicit empty connection is saved", async () => {
    rememberSessionMachine("s", "remote-id");
    expect(editorConnectionConfigured("u", scope)).toBe(false);
    saveEditorSshAlias("u", scope, "");
    expect(editorConnectionConfigured("u", scope)).toBe(true);
    await openFileInVSCode(scope, { path: "src/a b#%.ts" }, opts());
    expect(calls.find((call) => call.url.includes("editor-target"))!.url).toContain(
      "/server/remote-id/api/sessions/s/",
    );
    expect(launch).toEqual(["vscode://file/repo/src/a%20b%23%25.ts:42:7"]);
  });
  it("reports denied preference storage and keeps an unknown node closed", async () => {
    rememberSessionMachine("s", "remote-id");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("Storage denied");
      },
      setItem: () => {
        throw new Error("Storage denied");
      },
    });
    expect(() => saveEditorSshAlias("u", scope, "reader-dev")).toThrow("Could not save");
    expect(editorSshAlias("u", scope)).toBe("");
    await expect(openFileInVSCode(scope, { path: "src/a.ts" }, opts())).rejects.toMatchObject({
      code: "editor_connection_required",
    });
    expect(calls).toEqual([]);
    expect(launch).toEqual([]);
  });
});
