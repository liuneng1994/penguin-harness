/** Nearby unified hunks for a question about source line numbers; bounded independently of file size. */
export function gitPatchContext(patch: string, from: number, to: number): string {
  const chunks = patch.split(/(?=^@@ )/m);
  return chunks
    .filter((chunk) => {
      const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/m.exec(chunk);
      if (!header) return false;
      const count = Number(header[2] ?? 1);
      const first = Number(header[1]) + (count === 0 ? 1 : 0);
      return first <= to + 3 && first + Math.max(1, count) - 1 >= from - 3;
    })
    .join("")
    .slice(0, 24000);
}
