/** Stream a tool-free side answer; only the SessionManager records its usage. */
import { streamSSE } from "hono/streaming";
import type { Context } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import type { SessionManager } from "../runtime/session-manager.js";
import { badRequest, requireString } from "./validate.js";

export function readAsideQuestion(body: Record<string, unknown>) {
  const question = requireString(body, "question").trim();
  if (!question || question.length > 5000)
    throw badRequest("question must contain 1–5000 characters.");
  const history = body.history ?? [];
  if (!Array.isArray(history) || history.length > 64)
    throw badRequest("history must contain at most 64 turns.");
  let length = 0;
  const turns = history.map((turn: unknown) => {
    if (!turn || typeof turn !== "object") throw badRequest("Invalid history turn.");
    const pair = turn as Record<string, unknown>;
    const question = requireString(pair, "question"),
      answer = requireString(pair, "answer");
    length += question.length + answer.length;
    return { question, answer };
  });
  if (length > 100000) throw badRequest("Side conversation is too long. Start a new question.");
  return { question, turns };
}

export function streamAsideAnswer(
  c: Context<AppEnv>,
  manager: Pick<SessionManager, "streamAside">,
  sessionId: string,
  prompt: string,
  question: string,
  options?: { maxContextChars?: number },
) {
  return streamSSE(c, async (sink) => {
    const controller = new AbortController();
    sink.onAbort(() => controller.abort());
    const model = manager.streamAside(sessionId, prompt, controller.signal, options);
    let answer = "",
      partial = "";
    try {
      for (;;) {
        const step = await model.next();
        if (step.done) {
          if (step.value.status !== "completed")
            throw new Error(step.value.errorMessage ?? "The model could not complete this answer.");
          if (!answer.trim()) throw new Error("The model returned no answer.");
          await sink.writeSSE({ event: "done", data: JSON.stringify({ answer, question }) });
          break;
        }
        const p = step.value.payload as { type?: string; text?: string };
        if (p.type === "partial_text" && p.text) {
          partial += p.text;
          await sink.writeSSE({ event: "text", data: JSON.stringify({ text: p.text }) });
        } else if (p.type === "text" && p.text) {
          answer += p.text;
          if (!partial)
            await sink.writeSSE({ event: "text", data: JSON.stringify({ text: p.text }) });
          partial = "";
        }
      }
    } catch (error) {
      if (!controller.signal.aborted)
        await sink.writeSSE({
          event: "error",
          data: JSON.stringify({
            message: error instanceof Error ? error.message : "Unable to answer this question.",
          }),
        });
    } finally {
      controller.abort();
      await model.return({ status: "aborted" });
    }
  });
}
