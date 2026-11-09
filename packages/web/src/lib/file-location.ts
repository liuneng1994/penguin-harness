/** Locations printed by code tools and Markdown citations, normalized inside one Workspace. */
import { toWorkspaceRelative, hasKnownFileExtension } from "./file-path";
import { editorPosition } from "@prismshadow/penguin-server/editor";

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
    try {
      line = editorPosition(match[2] ?? match[4], "line");
      column = editorPosition(match[3] ?? match[5], "column");
    } catch {
      return null;
    }
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
  // A position makes uncommon extensions useful too. Bare inline names still need a file
  // shape, so data such as status:200, 12:30 and v1.2:3 keeps rendering as text.
  const positioned =
    line !== undefined &&
    (encoded ||
      path.includes("/") ||
      /\.[a-z][a-z0-9_-]*$|^(?:Dockerfile|Makefile|README|LICENSE|Jenkinsfile)$/i.test(path));
  if (!positioned && !hasKnownFileExtension(path)) return null;
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
