/** Locations printed by code tools and Markdown citations, normalized inside one Workspace. */
import { toWorkspaceRelative, hasKnownFileExtension } from "./file-path";

export interface FileLocation {
  path: string;
  line?: number;
  column?: number;
}

export function fileLocation(
  text: string,
  workspace: string | null,
  encoded = false,
): FileLocation | null {
  if (!workspace) return null;
  if (/\r|\n/.test(text) || text.startsWith("//")) return null;
  let file = encoded ? text.trim().replace(/\?[^#]*/, "") : text.trim();
  let line: number | undefined, column: number | undefined;
  const match = /^(.*?)(?::(\d+)(?::(\d+))?|#L(\d+)(?:C(\d+)|-L\d+)?)$/.exec(file);
  if (match) {
    file = match[1]!;
    line = Number(match[2] ?? match[4]);
    column = Number(match[3] ?? match[5] ?? 1);
    if (
      !Number.isSafeInteger(line) ||
      line < 1 ||
      line > 2147483647 ||
      !Number.isSafeInteger(column) ||
      column < 1 ||
      column > 2147483647
    )
      return null;
  }
  if (encoded) {
    try {
      file = decodeURIComponent(file);
    } catch {
      return null;
    }
  }
  // A Windows drive is a path only under a Windows Workspace, never a URI scheme.
  if (/^[A-Za-z]:[\\/]/.test(file) && !/^[A-Za-z]:[\\/]/.test(workspace)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(file) && !/^[A-Za-z]:[\\/]/.test(file)) return null;
  const path = toWorkspaceRelative(file, workspace);
  if (path === null) return null;
  // Explicit Markdown links may contain spaced names; inline references use the same extension list.
  if (!hasKnownFileExtension(path)) return null;
  return { path, ...(line !== undefined ? { line, column } : {}) };
}

/** A safe relative href avoids browser URL-scheme handling for drive names and file:line syntax. */
export function fileLocationHref(location: FileLocation): string {
  return (
    "./" +
    location.path.split("/").map(encodeURIComponent).join("/") +
    (location.line === undefined ? "" : `#L${location.line}C${location.column ?? 1}`)
  );
}
