/** Bound an old reply around the selected text, preserving its original Markdown. */
export function btwReplyContext(reply: string, excerpt: string | undefined, limit = 60000) {
  if (reply.length <= limit) return { text: reply, truncated: false };
  let at = 0;
  if (excerpt) {
    // Formatting and line wraps can differ between Markdown source and browser selection.
    const keep = (character: string) => !/[\s*_`#~>]/.test(character);
    const positions: number[] = [];
    let plain = "";
    for (let i = 0; i < reply.length; i++) {
      if (keep(reply[i]!)) {
        plain += reply[i];
        positions.push(i);
      }
    }
    const selected = [...excerpt].filter(keep).join("");
    for (const width of [256, 64, 16, 8]) {
      const index = plain.indexOf(selected.slice(0, width));
      if (index >= 0) {
        at = positions[index]!;
        break;
      }
    }
  }
  const start = Math.max(0, Math.min(reply.length - limit, at - Math.floor(limit / 2)));
  return { text: reply.slice(start, start + limit), truncated: true };
}
