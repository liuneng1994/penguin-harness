/** Resolve files on their owning node, then launch VS Code on the reader's computer. */
import { isEditorSshAlias, vscodeUri } from "@prismshadow/penguin-server/editor";
import type { FileLocation } from "../../lib/file-location";
import { filesApi } from "../../api/workspace-files";
import type { FilesScope } from "../../api/workspace-files";
import { machineForSession } from "../../lib/session-machines";
import { openDesktopEditor } from "../../api/endpoints";
import { ApiError } from "../../api/client";
import type { MachineInfo } from "@prismshadow/penguin-server/api";

type EditorHost = Pick<MachineInfo, "id" | "machineId" | "alias" | "local">;

function defaultEditorSshAlias(scope: FilesScope, machines?: readonly EditorHost[] | null): string {
  const machine = editorMachine(scope);
  if (machine === null) return "";
  const host = machines?.find(
    (entry) => !entry.local && (entry.machineId === machine || entry.id === machine),
  );
  return host?.alias ?? (machine.startsWith("ssh:") ? machine.slice(4) : "");
}

export function editorMachine(scope: FilesScope): string | null {
  return scope.kind === "session" ? machineForSession(scope.sessionId) : (scope.machineId ?? null);
}

function editorKey(userId: string, scope: FilesScope): string {
  return `penguin.vscodeSsh.${encodeURIComponent(userId)}.${encodeURIComponent(editorMachine(scope) ?? "local")}`;
}

export function editorSshAlias(
  userId: string,
  scope: FilesScope,
  machines?: readonly EditorHost[] | null,
): string {
  const fallback = defaultEditorSshAlias(scope, machines);
  try {
    return localStorage.getItem(editorKey(userId, scope)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveEditorSshAlias(userId: string, scope: FilesScope, alias: string): void {
  if (!isEditorSshAlias(alias)) throw new Error("Invalid SSH connection name.");
  try {
    localStorage.setItem(editorKey(userId, scope), alias);
  } catch {
    throw new ApiError(
      500,
      "editor_preferences_unavailable",
      "Could not save the editor connection in this browser.",
    );
  }
}

export function editorConnectionConfigured(
  userId: string,
  scope: FilesScope,
  machines?: readonly EditorHost[] | null,
): boolean {
  const fallback = defaultEditorSshAlias(scope, machines);
  if (editorMachine(scope) === null || (fallback !== "" && isEditorSshAlias(fallback))) return true;
  try {
    return localStorage.getItem(editorKey(userId, scope)) !== null;
  } catch {
    return false;
  }
}

function launchBrowserUri(uri: string): void {
  const link = document.createElement("a");
  link.href = uri;
  link.hidden = true;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
  }
}

export async function openFileInVSCode(
  scope: FilesScope,
  location: FileLocation,
  opts: {
    userId: string;
    desktop: boolean;
    machines?: readonly EditorHost[] | null;
    launchUri?: (uri: string) => void;
  },
): Promise<void> {
  if (!editorConnectionConfigured(opts.userId, scope, opts.machines))
    throw new ApiError(
      400,
      "editor_connection_required",
      "Configure this machine's VS Code SSH connection first.",
    );
  const alias = editorSshAlias(opts.userId, scope, opts.machines);
  // Capture the reader's connection before the request: refreshing Session ownership while
  // it is in flight must not open the old node's path on a newly selected machine.
  const target = await filesApi(scope).editorTarget(location.path, location.line, location.column);
  if (opts.desktop) await openDesktopEditor(target, alias);
  else (opts.launchUri ?? launchBrowserUri)(vscodeUri(target, alias));
}
