/** One temporary answer, over the Session's own server; no main-message endpoint is used. */
import type { BtwQuestionRequest, TracePosition } from "@prismshadow/penguin-server/api";
import type { AssistantTextItem } from "../../lib/amsp/stream-model";
import { createStreamModel, pushMessage, finalizeHistory } from "../../lib/amsp/stream-model";
import { apiFetchStream } from "../../api/client";
import { getMessages } from "../../api/endpoints";
import { S } from "../../lib/strings";

export async function btwReplyPosition(
  sessionId: string,
  reply: AssistantTextItem,
): Promise<TracePosition> {
  if (reply.tracePosition) return reply.tracePosition;
  const history = await getMessages(sessionId);
  const model = createStreamModel();
  for (const record of history.messages) pushMessage(model, record);
  finalizeHistory(model);
  const found = model.items.findLast(
    (item) =>
      item.kind === "assistant_text" &&
      item.text === reply.text &&
      item.atMs === reply.atMs &&
      item.tracePosition !== undefined,
  );
  if (found?.kind !== "assistant_text" || !found.tracePosition)
    throw new Error(S.chat.btw.sourceUnavailable);
  return found.tracePosition;
}

export async function askBtw(
  sessionId: string,
  request: BtwQuestionRequest,
  signal: AbortSignal,
  onText: (text: string) => void,
): Promise<string> {
  const response = await apiFetchStream(
    `/api/sessions/${encodeURIComponent(sessionId)}/btw-questions`,
    { method: "POST", body: request, signal },
  );
  const reader = response.body?.getReader();
  if (!reader) throw new Error(S.chat.btw.failed);
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const step = await reader.read();
      buffer += decoder.decode(step.value, { stream: !step.done });
      for (;;) {
        const boundary = /\r?\n\r?\n/.exec(buffer);
        if (!boundary) break;
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const type = /^event:\s*(.+)$/m.exec(event)?.[1]?.trim();
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        const value = JSON.parse(data) as { text?: string; answer?: string; message?: string };
        if (type === "text" && typeof value.text === "string") onText(value.text);
        if (type === "error") throw new Error(value.message ?? S.chat.btw.failed);
        if (type === "done" && typeof value.answer === "string") return value.answer;
      }
      if (step.done) throw new Error(S.chat.btw.failed);
    }
  } finally {
    await reader.cancel();
  }
}
