/** One temporary answer, over the Session's own server; no main-message endpoint is used. */
import { readSse } from "@prismshadow/amsp";
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
  if (!response.body) throw new Error(S.chat.btw.failed);
  for await (const event of readSse(response.body, signal)) {
    const value = JSON.parse(event.data) as {
      text?: string;
      answer?: string;
      message?: string;
    } | null;
    if (event.event === "text" && typeof value?.text === "string") onText(value.text);
    if (event.event === "error") throw new Error(value?.message ?? S.chat.btw.failed);
    if (event.event === "done" && typeof value?.answer === "string") return value.answer;
  }
  throw new Error(S.chat.btw.failed);
}
