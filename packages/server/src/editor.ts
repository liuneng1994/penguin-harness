/** Browser-safe file targets shared by the file API and external-editor launchers. */
export interface EditorTarget {
  path: string;
  workspace: string;
  line: number;
  column: number;
}

export function editorPosition(value: unknown, name: string): number {
  const n = value === undefined ? 1 : typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1 || n > 2147483647)
    throw new Error(`${name} must be a positive line or column number.`);
  return n;
}

export function isEditorSshAlias(alias: string): boolean {
  return alias === "" || /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(alias);
}

export function vscodeUri(
  target: { path: string; line?: unknown; column?: unknown },
  sshAlias = "",
): string {
  let file = target.path;
  if (!file || /[\u0000\r\n]/.test(file)) throw new Error("Invalid editor file path.");
  if (/^[A-Za-z]:[\\/]/.test(file)) file = "/" + file.replaceAll("\\", "/");
  if (!file.startsWith("/") || file.startsWith("//"))
    throw new Error("Editor file path must be absolute.");
  if (!isEditorSshAlias(sshAlias))
    throw new Error("SSH connection name must be a configured host alias.");
  const encoded = file
    .split("/")
    .map((part, index) =>
      index === 1 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part),
    )
    .join("/");
  const base = sshAlias === "" ? "vscode://file" : `vscode://vscode-remote/ssh-remote+${sshAlias}`;
  return `${base}${encoded}:${editorPosition(target.line, "line")}:${editorPosition(target.column, "column")}`;
}
