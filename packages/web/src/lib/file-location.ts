/** Locations printed by code tools and Markdown citations, normalized inside one Workspace. */
import { toWorkspaceRelative, hasKnownFileExtension } from "./file-path";
import { editorPosition } from "@prismshadow/penguin-server/editor";

export interface FileLocation {
  path: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export function fileLocation(
  text: string,
  workspace: string | null,
  encoded = false,
): FileLocation | null {
  if (!workspace) return null;
  if (/\r|\n/.test(text) || text.startsWith("//")) return null;
  let file = encoded ? text.trim().replace(/\?[^#]*/, "") : text.trim();
  // Markdown encodes Unicode range separators; keep encoded colons and hashes literal.
  if (encoded) file = file.replace(/%2d|%e2%80%9[34]/gi, (part) => decodeURIComponent(part));
  let line: number | undefined,
    column: number | undefined,
    endLine: number | undefined,
    endColumn: number | undefined;
  const match =
    /^(?<file>.*?)(?::(?<line>\d+)(?::(?<column>\d+))?(?:[-–—](?<endLine>\d+)(?::(?<endColumn>\d+))?)?|#L(?<hashLine>\d+)(?:C(?<hashColumn>\d+))?(?:[-–—]L(?<hashEndLine>\d+)(?:C(?<hashEndColumn>\d+))?)?)$/.exec(
      file,
    );
  if (match) {
    const fields = match.groups!;
    file = fields.file!;
    // Literal numeric colons in filenames must be encoded, rather than absorbing an extra position.
    if (/:\d+(?:[-–—]\d+)?$/.test(file)) return null;
    try {
      line = editorPosition(fields.line ?? fields.hashLine, "line");
      column = editorPosition(fields.column ?? fields.hashColumn, "column");
      const end = fields.endLine ?? fields.hashEndLine;
      const lastColumn = fields.endColumn ?? fields.hashEndColumn;
      if (end !== undefined) {
        endLine = editorPosition(end, "endLine");
        endColumn = lastColumn === undefined ? undefined : editorPosition(lastColumn, "endColumn");
        if (endLine < line || (endLine === line && endColumn !== undefined && endColumn < column))
          return null;
      }
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
  return {
    path,
    ...(line !== undefined
      ? { line, column, ...(endLine !== undefined ? { endLine, endColumn } : {}) }
      : {}),
  };
}

/** A safe relative href avoids browser URL-scheme handling for drive names and file:line syntax. */
export function fileLocationHref(location: FileLocation): string {
  return (
    "./" +
    location.path.split("/").map(encodeURIComponent).join("/") +
    (location.line === undefined
      ? ""
      : `#L${location.line}C${location.column ?? 1}${location.endLine === undefined ? "" : `-L${location.endLine}${location.endColumn === undefined ? "" : `C${location.endColumn}`}`}`)
  );
}
