/** A citation and the user's requested edit, received from the preview Workbench. */
export interface CodeModification {
  path: string;
  comment: string;
  selection: { line: number; column: number; endLine: number; endColumn: number; text: string };
}
export function codeModification(value: unknown): CodeModification | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const range = data.selection as CodeModification["selection"] | undefined;
  if (
    typeof data.path !== "string" ||
    !data.path ||
    data.path.length > 4096 ||
    typeof data.comment !== "string" ||
    !data.comment.trim() ||
    data.comment.length > 5000 ||
    !range ||
    typeof range.text !== "string" ||
    !range.text ||
    range.text.length > 24000
  )
    return null;
  if (
    ![range.line, range.column, range.endLine, range.endColumn].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) ||
    range.endLine < range.line ||
    (range.endLine === range.line && range.endColumn <= range.column)
  )
    return null;
  return {
    path: data.path,
    comment: data.comment,
    selection: {
      line: range.line,
      column: range.column,
      endLine: range.endLine,
      endColumn: range.endColumn,
      text: range.text,
    },
  };
}
/** A code fence that cannot be closed by the selected source text. */
export function modificationCode(data: CodeModification): string {
  const runs = [...data.selection.text.matchAll(/`+/g)].map((match) => match[0].length);
  const fence = "`".repeat(Math.max(3, ...runs.map((n) => n + 1)));
  return `${fence}\n${data.selection.text}\n${fence}`;
}
