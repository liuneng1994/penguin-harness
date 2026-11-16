/** Insert onto the browser's undo stack; callers sync the fallback into controlled state. */
export function insertTextareaText(
  element: HTMLTextAreaElement | null,
  value: string,
  text: string,
  onFallback: (next: string) => void,
  selection?: { start: number; end: number },
): void {
  const start = Math.min(selection?.start ?? element?.selectionStart ?? value.length, value.length);
  const end = Math.max(
    start,
    Math.min(selection?.end ?? element?.selectionEnd ?? value.length, value.length),
  );
  if (element) {
    element.focus();
    element.setSelectionRange(start, end);
    // execCommand is the available textarea edit API that preserves native undo and fires input.
    if (element.ownerDocument.execCommand?.("insertText", false, text)) return;
  }
  onFallback(value.slice(0, start) + text + value.slice(end));
  if (!element) return;
  requestAnimationFrame(() => {
    element.focus();
    element.setSelectionRange(start + text.length, start + text.length);
  });
}
