import { en, zh } from "./strings.js";
const S = new URLSearchParams(location.search).get("locale") === "zh" ? zh : en;

/** Read the side answer's SSE stream over this page's own sign-in. */
export async function askCodeQuestion(
  url: string,
  body: unknown,
  signal: AbortSignal,
  onText: (text: string) => void,
): Promise<{ answer: string; question: string }> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      (error?.error?.code === "file_changed" ? S.fileChanged : error?.error?.message) ??
        `${S.answerFailed} (${response.status})`,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(S.noStream);
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const step = await reader.read();
      buffer += decoder.decode(step.value, { stream: !step.done }).replaceAll("\r\n", "\n");
      for (;;) {
        const split = buffer.indexOf("\n\n");
        if (split < 0) break;
        const event = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const type = /^event:\s*(.+)$/m.exec(event)?.[1];
        const data = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        const value = JSON.parse(data);
        if (type === "text") onText(value.text);
        if (type === "error") throw new Error(value.message);
        if (type === "done") return value;
      }
      if (step.done) throw new Error(S.answerEnded);
    }
  } finally {
    await reader.cancel();
  }
}
