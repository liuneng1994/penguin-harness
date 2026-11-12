// @vitest-environment jsdom
/**
 * - Code answers survive CRLF and UTF-8 characters split across response chunks.
 * - An incomplete answer is reported as a failure rather than saved as a completed turn.
 * - A server error reaches the caller even when stream cleanup also fails.
 */
import { afterEach, expect, it, vi } from "vitest";
import { askCodeQuestion } from "../../../plugins/code-viewer/workbenches/code-viewer/ui/questions";
import { stubFetch } from "./helpers/fetch";

afterEach(() => vi.unstubAllGlobals());

it("reads code answers with line endings and Unicode split into one-byte chunks", async () => {
  const answer = "A null check keeps 空值 rows out of evaluation.";
  const bytes = new TextEncoder().encode(
    `event: text\r\ndata: ${JSON.stringify({ text: answer })}\r\n\r\nevent: done\r\ndata: ${JSON.stringify({ answer, question: "original question" })}\r\n\r\n`,
  );
  stubFetch(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
            controller.close();
          },
        }),
      ),
  );
  const text: string[] = [];
  const result = await askCodeQuestion(
    "http://localhost/code-questions",
    {},
    new AbortController().signal,
    (fragment) => text.push(fragment),
  );
  expect(text.join("")).toBe(answer);
  expect(result.answer).toBe(answer);
});

it("does not turn a truncated code answer into a completed response", async () => {
  stubFetch(() => new Response('event: text\ndata: {"text":"partial answer"}\n\n'));
  await expect(
    askCodeQuestion("http://localhost/code-questions", {}, new AbortController().signal, () => {}),
  ).rejects.toThrow("ended before completion");
});

it("keeps the server error when cancelling the stream also fails", async () => {
  stubFetch(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'event: error\ndata: {"message":"The file snapshot is no longer valid."}\n\n',
              ),
            );
          },
          cancel() {
            throw new Error("cleanup failed");
          },
        }),
      ),
  );
  await expect(
    askCodeQuestion("http://localhost/code-questions", {}, new AbortController().signal, () => {}),
  ).rejects.toThrow("file snapshot is no longer valid");
});
