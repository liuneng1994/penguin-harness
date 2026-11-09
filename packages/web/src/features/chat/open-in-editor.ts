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

export function editorMachine(scope: FilesScope): string | null {
  return scope.kind === "session" ? machineForSession(scope.sessionId) : (scope.machineId ?? null);
}

function editorKey(userId: string, machineId: string | null): string {
  return `penguin.vscodeSsh.${encodeURIComponent(userId)}.${encodeURIComponent(machineId ?? "local")}`;
}

/** Empty means local files; null means no usable connection has been configured. */
export function editorConnection(
  userId: string,
  machineId: string | null,
  machines?: readonly EditorHost[] | null,
): string | null {
  try {
    const saved = localStorage.getItem(editorKey(userId, machineId));
    if (saved !== null) return isEditorSshAlias(saved) ? saved : null;
  } catch {
    // A configured host is still usable when the browser refuses preference storage.
  }
  if (machineId === null) return "";
  const host = machines?.find(
    (entry) => !entry.local && (entry.machineId === machineId || entry.id === machineId),
  );
  const alias = host?.alias ?? (machineId.startsWith("ssh:") ? machineId.slice(4) : null);
  return alias && isEditorSshAlias(alias) ? alias : null;
}

export function saveEditorSshAlias(userId: string, machineId: string | null, alias: string): void {
  if (!isEditorSshAlias(alias)) throw new Error("Invalid SSH connection name.");
  try {
    localStorage.setItem(editorKey(userId, machineId), alias);
  } catch {
    throw new ApiError(
      500,
      "editor_preferences_unavailable",
      "Could not save the editor connection in this browser.",
    );
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
  const alias = editorConnection(opts.userId, editorMachine(scope), opts.machines);
  if (alias === null)
    throw new ApiError(
      400,
      "editor_connection_required",
      "Configure this machine's VS Code SSH connection first.",
    );
  // Capture the reader's connection before the request: refreshing Session ownership while
  // it is in flight must not open the old node's path on a newly selected machine.
  const target = await filesApi(scope).editorTarget(location.path, location.line, location.column);
  if (opts.desktop) await openDesktopEditor(target, alias);
  else (opts.launchUri ?? launchBrowserUri)(vscodeUri(target, alias));
}
