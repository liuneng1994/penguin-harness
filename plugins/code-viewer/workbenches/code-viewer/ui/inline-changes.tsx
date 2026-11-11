import { DiffViewer, parsePatch } from "@prismshadow/penguin-ui";
import type { GitChange } from "./editor/editor.js";
import { en, zh } from "./strings.js";
const S = new URLSearchParams(location.search).get("locale") === "zh" ? zh : en;

/** Convert shared patch rows to decorations on source positions, never to document text. */
export function codeChanges(patch: string, text: string): GitChange[] {
  const source = text.replace(/\r\n?/g, "\n").split("\n");
  const changes: GitChange[] = [];
  for (const hunk of parsePatch(patch).hunks) {
    const header = /\+(\d+)(?:,(\d+))? @@/.exec(hunk.header)!;
    let next = Number(header[1]) + (header[2] === "0" ? 1 : 0);
    let current: GitChange | null = null;
    for (const line of hunk.lines) {
      if (line.newNo !== null && source[line.newNo - 1] !== line.text)
        throw new Error(S.fileChanged);
      if (line.kind === "context") {
        current = null;
        next = line.newNo! + 1;
        continue;
      }
      if (!current) {
        current = { line: next, added: [], removed: [] };
        changes.push(current);
      }
      if (line.kind === "del") current.removed.push({ line: line.oldNo!, text: line.text });
      else {
        current.added.push({ line: line.newNo!, words: line.words });
        next = line.newNo! + 1;
      }
    }
  }
  return changes;
}

export function RemovedCode({ change }: { change: GitChange }) {
  const first = change.removed[0]!.line;
  const patch = `@@ -${first},${change.removed.length} +${Math.max(0, change.line - 1)},0 @@\n${change.removed.map((line) => `-${line.text}`).join("\n")}\n`;
  return (
    <div className="code-removed-block">
      <DiffViewer patch={patch} wrap label={S.oldCode} />
    </div>
  );
}
