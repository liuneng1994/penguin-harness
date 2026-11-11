// @vitest-environment jsdom
/**
 * - A reply's btw action focuses its own input, sends only a side request and carries follow-ups;
 *   closing clears its history and switching Sessions clears it too.
 * - Closing or stopping an in-flight answer aborts that request without changing the main reply.
 * - A missing original reply is shown as a recoverable error, with the question kept for retry.
 * - A just-completed live reply resolves its recorded position before sending a side question.
 */
import { createElement as h, act } from "react";
import { assistantText } from "@prismshadow/amsp";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MessageStream } from "../src/features/chat/message-stream";
import type { StreamRenderContext } from "../src/features/chat/message-stream";
import type { ChatItem } from "../src/lib/amsp/stream-model";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { mount, click, button, unmountAll } from "./helpers/dom";
import { stubLocalStorage } from "./helpers/storage";
import { stubFetch, apiError, json } from "./helpers/fetch";
import type { FetchRequest } from "./helpers/fetch";

const items: ChatItem[] = [
  {
    kind: "assistant_text",
    id: 1,
    text: "Original visible reply about Bloom Filter.",
    streaming: false,
    tracePosition: { fileIndex: 0, ordinal: 2 },
  },
];
const ctx: StreamRenderContext = {
  pendingApprovals: new Map(),
  onApprove: async () => {},
  origin: [],
  taskRunning: false,
};
const page = (sessionId = "btw-session") =>
  h(MessageStream, { sessionId, items, version: 1, ctx, onAddExcerpt: () => {} });
function response() {
  return new Response(
    'event: text\ndata: {"text":"private side answer"}\n\nevent: done\ndata: {"answer":"private side answer"}\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
async function ask(question: string) {
  const field = document.querySelector<HTMLInputElement>(".btw-reading-composer input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      field,
      question,
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    field.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
beforeEach(() => {
  stubLocalStorage();
  setActiveStrings(en);
});
afterEach(async () => {
  await unmountAll();
  setActiveStrings(zh);
});

it("sends a temporary question and follow-up, then clears them on close and Session change", async () => {
  const fetch = stubFetch(() => response());
  const view = await mount(page());
  const original = document.querySelector("[data-btw-body]")!.textContent;
  await click(button(S.chat.btw.ask));
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  expect(document.activeElement).toBe(document.querySelector(".btw-reading-composer input"));
  await ask("btw private question");
  expect(document.querySelector(".btw-reading-log")!.textContent).toContain("private side answer");
  expect(document.querySelector("[data-btw-body]")!.textContent).toBe(original);
  expect(fetch.requests.map((request) => request.path)).toEqual([
    "/api/sessions/btw-session/btw-questions",
  ]);
  expect(fetch.requests[0]!.body).toMatchObject({
    position: { fileIndex: 0, ordinal: 2 },
    question: "btw private question",
    history: [],
  });
  await ask("btw follow-up");
  expect(fetch.requests[1]!.body).toMatchObject({
    history: [{ question: "btw private question", answer: "private side answer" }],
  });
  await click(button(S.chat.btw.close));
  expect(document.querySelector(".btw-reading-panel")).toBeNull();
  await click(button(S.chat.btw.ask));
  expect(document.querySelector(".btw-reading-log")!.textContent).not.toContain(
    "private side answer",
  );
  await ask("new private question");
  expect(fetch.requests[2]!.body).toMatchObject({ history: [] });
  await view.rerender(page("another-session"));
  expect(document.querySelector(".btw-reading-panel")).toBeNull();
});

it.each(["close", "stop"])(
  "%s aborts a pending side answer and preserves main content",
  async (action) => {
    let sent: FetchRequest | undefined;
    stubFetch((request) => {
      sent = request;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('event: text\ndata: {"text":"partial private answer"}\n\n'),
            );
            request.signal!.addEventListener(
              "abort",
              () => controller.error(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    });
    await mount(page());
    const before = document.querySelector("[data-btw-body]")!.textContent;
    await click(button(S.chat.btw.ask));
    await ask("pending private question");
    expect(document.querySelector(".btw-reading-log")!.textContent).toContain(
      "partial private answer",
    );
    await click(button(action === "close" ? S.chat.btw.close : S.chat.btw.stop));
    expect(sent!.signal!.aborted).toBe(true);
    expect(document.querySelector("[data-btw-body]")!.textContent).toBe(before);
    if (action === "close") expect(document.querySelector(".btw-reading-panel")).toBeNull();
    else
      expect(document.querySelector(".btw-reading-log")!.textContent).toContain(S.chat.btw.stopped);
  },
);

it("keeps a failed question available to retry without posting a main message", async () => {
  const fetch = stubFetch(() => apiError(400, "btw_reply_unavailable"));
  await mount(page());
  await click(button(S.chat.btw.ask));
  await ask("retry this question");
  expect(document.querySelector("[role=alert]")!.textContent).toContain(
    S.chat.btw.sourceUnavailable,
  );
  expect(document.querySelector<HTMLInputElement>(".btw-reading-composer input")!.value).toBe(
    "retry this question",
  );
  expect(fetch.requests.every((request) => request.path.endsWith("/btw-questions"))).toBe(true);
});

it("resolves a just-completed reply by its text and completion time before asking", async () => {
  const text = "The same reply appeared in two different rounds.";
  const timestamp = "2026-11-11T10:00:00.000Z";
  const fetch = stubFetch((request) =>
    request.path.endsWith("/messages")
      ? json({
          messages: [
            {
              ...assistantText(text),
              timestamp: "2026-11-11T09:00:00.000Z",
              tracePosition: { fileIndex: 0, ordinal: 2 },
            },
            { ...assistantText(text), timestamp, tracePosition: { fileIndex: 1, ordinal: 7 } },
          ],
        })
      : response(),
  );
  await mount(
    h(MessageStream, {
      sessionId: "live-session",
      version: 1,
      ctx,
      onAddExcerpt: () => {},
      items: [
        { kind: "assistant_text", id: 2, text, streaming: false, atMs: Date.parse(timestamp) },
      ],
    }),
  );
  await click(button(S.chat.btw.ask));
  await ask("Explain the live reply");
  expect(fetch.requests.map((request) => request.path)).toEqual([
    "/api/sessions/live-session/messages",
    "/api/sessions/live-session/btw-questions",
  ]);
  expect(fetch.requests[1]!.body).toMatchObject({
    position: { fileIndex: 1, ordinal: 7 },
    history: [],
  });
  expect(document.querySelector(".btw-reading-log")!.textContent).toContain("private side answer");
});
