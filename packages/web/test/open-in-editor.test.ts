/**
 * - Given a local file location, resolve it before invoking the browser's editor handler.
 * - Given remote files, use their owning node and the user's SSH mapping; desktop launch stays on this window's server.
 * - Given a missing file or unknown remote connection, do not launch an editor.
 * - Given different users or nodes, keep editor connection preferences independent.
 * - Given ownership refreshes during target resolution, keep the clicked node's connection.
 * - Given a machine id, use its SSH config Host alias by default for Session and Workspace files.
 * - Given a personal override, including local files, keep it ahead of the discovered default.
 * - Given a changing or invalid stored preference, never launch using a second or invalid connection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  openFileInVSCode,
  saveEditorSshAlias,
  editorConnection,
  editorMachine,
} from "../src/features/chat/open-in-editor";
import { rememberSessionMachine, forgetSessionMachines } from "../src/lib/session-machines";
import type { FilesScope } from "../src/api/workspace-files";
import { apiError, json, stubFetch } from "./helpers/fetch";
import type { FakeFetch, FetchRequest } from "./helpers/fetch";
import { blockedStorage, stubLocalStorage } from "./helpers/storage";

describe("external editor file opening", () => {
  let http: FakeFetch, calls: readonly FetchRequest[], launch: string[], missing: boolean;
  const target = { path: "/repo/src/a b#%.ts", workspace: "/repo", line: 42, column: 7 };
  beforeEach(() => {
    launch = [];
    missing = false;
    stubLocalStorage();
    vi.stubGlobal("WebSocket", undefined);
    http = stubFetch(({ path }) => {
      if (path.includes("/desktop/editor/")) return new Response(null, { status: 204 });
      return missing ? apiError(404, "path_not_found", "File missing") : json(target);
    });
    calls = http.requests;
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
  const hosts = [
    { id: "ssh:server-2222", machineId: "remote-id", alias: "server-2222", local: false },
  ];
  it.each<FilesScope>([
    scope,
    { kind: "workspace", projectId: "p", workspace: "/repo", machineId: "remote-id" },
  ])("uses the SSH config Host alias for a $kind addressed by machine id", async (source) => {
    rememberSessionMachine("s", "remote-id");
    expect(editorConnection("u", editorMachine(source), hosts)).toBe("server-2222");
    await openFileInVSCode(
      source,
      { path: "src/a b#%.ts", line: 42, column: 7 },
      { ...opts(), machines: hosts },
    );
    expect(calls.find((call) => call.url.includes("editor-target"))!.url).toContain(
      "/server/remote-id/api/",
    );
    expect(launch).toEqual([
      "vscode://vscode-remote/ssh-remote+server-2222/repo/src/a%20b%23%25.ts:42:7",
    ]);
  });
  it("prefers a reader's saved connection to the host alias, including an explicit local choice", async () => {
    rememberSessionMachine("s", "remote-id");
    saveEditorSshAlias("u", "remote-id", "reader-dev");
    expect(editorConnection("other", "remote-id", hosts)).toBe("server-2222");
    await openFileInVSCode(scope, { path: "src/a b#%.ts" }, { ...opts(), machines: hosts });
    saveEditorSshAlias("u", "remote-id", "");
    await openFileInVSCode(scope, { path: "src/a b#%.ts" }, { ...opts(), machines: hosts });
    expect(launch).toEqual([
      "vscode://vscode-remote/ssh-remote+reader-dev/repo/src/a%20b%23%25.ts:42:7",
      "vscode://file/repo/src/a%20b%23%25.ts:42:7",
    ]);
  });
  it("does not mistake the server's own hostname or an invalid alias for a remote connection", async () => {
    rememberSessionMachine("s", "remote-id");
    for (const entries of [
      [{ ...hosts[0]!, local: true }],
      [{ ...hosts[0]!, alias: "invalid/alias" }],
    ]) {
      await expect(
        openFileInVSCode(scope, { path: "src/a.ts" }, { ...opts(), machines: entries }),
      ).rejects.toMatchObject({ code: "editor_connection_required" });
    }
    expect(calls).toEqual([]);
    expect(launch).toEqual([]);
  });
  it("resolves a local location and opens exactly its encoded file and position", async () => {
    await openFileInVSCode(scope, { path: "src/a b#%.ts", line: 42, column: 7 }, opts());
    const request = calls.find((call) => call.url.includes("editor-target"))!;
    expect(new URL(request.url, "http://localhost").searchParams.get("path")).toBe("src/a b#%.ts");
    expect(launch).toEqual(["vscode://file/repo/src/a%20b%23%25.ts:42:7"]);
  });
  it("resolves remote files on their node and launches from the local desktop server", async () => {
    rememberSessionMachine("s", "remote-id");
    saveEditorSshAlias("u", "remote-id", "client-dev");
    await openFileInVSCode(
      scope,
      { path: "src/a b#%.ts", line: 42, column: 7 },
      { ...opts(), desktop: true },
    );
    expect(calls.find((call) => call.url.includes("editor-target"))!.url).toContain(
      "/server/remote-id/api/sessions/s/",
    );
    expect(calls.find((call) => call.url.includes("desktop/editor"))).toMatchObject({
      url: "/api/desktop/editor/open",
      method: "POST",
      machine: null,
      body: { path: "/repo/src/a b#%.ts", line: 42, column: 7, sshAlias: "client-dev" },
    });
    expect(launch).toEqual([]);
  });
  it("keeps connections per user and node, including explicit local overrides", () => {
    rememberSessionMachine("s", "ssh:server-dev");
    expect(editorConnection("u", "ssh:server-dev")).toBe("server-dev");
    saveEditorSshAlias("u", "ssh:server-dev", "client-dev");
    expect(editorConnection("u", "ssh:server-dev")).toBe("client-dev");
    expect(editorConnection("other", "ssh:server-dev")).toBe("server-dev");
    expect(editorConnection("u", "ssh:another")).toBe("another");
    saveEditorSshAlias("u", "ssh:server-dev", "");
    expect(editorConnection("u", "ssh:server-dev")).toBe("");
  });
  it("keeps the clicked connection if Session ownership changes during the request", async () => {
    rememberSessionMachine("s", "original-id");
    http.answer(() => {
      rememberSessionMachine("s", "replacement-id");
      return json(target);
    });
    await openFileInVSCode(
      scope,
      { path: "src/a b#%.ts" },
      {
        ...opts(),
        machines: [
          { id: "ssh:original", machineId: "original-id", alias: "original", local: false },
          {
            id: "ssh:replacement",
            machineId: "replacement-id",
            alias: "replacement",
            local: false,
          },
        ],
      },
    );
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
    expect(editorConnection("u", "remote-id")).toBeNull();
    saveEditorSshAlias("u", "remote-id", "");
    expect(editorConnection("u", "remote-id")).toBe("");
    await openFileInVSCode(scope, { path: "src/a b#%.ts" }, opts());
    expect(calls.find((call) => call.url.includes("editor-target"))!.url).toContain(
      "/server/remote-id/api/sessions/s/",
    );
    expect(launch).toEqual(["vscode://file/repo/src/a%20b%23%25.ts:42:7"]);
  });
  it("reports denied preference storage and keeps an unknown node closed", async () => {
    rememberSessionMachine("s", "remote-id");
    stubLocalStorage(blockedStorage());
    expect(() => saveEditorSshAlias("u", "remote-id", "reader-dev")).toThrow("Could not save");
    expect(editorConnection("u", "remote-id")).toBeNull();
    await expect(openFileInVSCode(scope, { path: "src/a.ts" }, opts())).rejects.toMatchObject({
      code: "editor_connection_required",
    });
    expect(calls).toEqual([]);
    expect(launch).toEqual([]);
  });
  it("captures one connection even if the stored value changes between reads", async () => {
    rememberSessionMachine("s", "remote-id");
    const store = stubLocalStorage();
    let reads = 0;
    store.getItem = () => (reads++ === 0 ? "reader-dev" : "");
    await openFileInVSCode(scope, { path: "src/a.ts" }, opts());
    expect(launch).toEqual([
      "vscode://vscode-remote/ssh-remote+reader-dev/repo/src/a%20b%23%25.ts:42:7",
    ]);
  });
  it("refuses an invalid stored override before resolving or launching a file", async () => {
    rememberSessionMachine("s", "remote-id");
    localStorage.setItem("penguin.vscodeSsh.u.remote-id", "invalid/alias");
    await expect(
      openFileInVSCode(scope, { path: "src/a.ts" }, { ...opts(), machines: hosts }),
    ).rejects.toMatchObject({ code: "editor_connection_required" });
    expect(calls).toEqual([]);
    expect(launch).toEqual([]);
  });
});
