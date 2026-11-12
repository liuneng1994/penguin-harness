// @vitest-environment jsdom
/**
 * - A reply's btw action focuses its own input, sends only a side request and carries follow-ups;
 *   closing clears its history and switching Sessions clears it too.
 * - Closing or stopping an in-flight answer aborts that request without changing the main reply.
 * - A missing original reply is shown as a recoverable error, with the question kept for retry.
 * - A just-completed live reply resolves its recorded position before sending a side question.
 * - Long replies expand reading space; size switches preserve draft and history.
 * - Stopping before any output restores the question without sending another request.
 * - A late cancelled reply cannot enter a newly opened temporary conversation.
 * - Reading earlier turns keeps the scroll position while another answer streams below.
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
function response(answer = "private side answer") {
  return new Response(
    `event: text\ndata: ${JSON.stringify({ text: answer })}\n\nevent: done\ndata: ${JSON.stringify({ answer })}\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
async function ask(question: string) {
  const field = document.querySelector<HTMLInputElement>(".temporary-conversation-composer input")!;
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

it("expands a long answer and preserves its draft and history across size switches", async () => {
  const answer = "This is a longer explanation of the selected passage. ".repeat(12);
  const fetch = stubFetch(() => response(answer));
  await mount(page());
  await click(button(S.chat.btw.ask));
  const before = Number.parseFloat(
    document.querySelector<HTMLElement>(".temporary-conversation-popup")!.style.width,
  );
  await ask("Explain in detail");
  const after = Number.parseFloat(
    document.querySelector<HTMLElement>(".temporary-conversation-popup")!.style.width,
  );
  expect(after).toBeGreaterThan(before);
  const field = document.querySelector<HTMLInputElement>(".temporary-conversation-composer input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      field,
      "Draft follow-up",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(button(S.chat.btw.restore));
  expect(field.value).toBe("Draft follow-up");
  expect(document.querySelector(".temporary-conversation-log")!.textContent).toContain(
    answer.trim(),
  );
  await click(button(S.chat.btw.expand));
  expect(field.value).toBe("Draft follow-up");
  await ask("Follow up after resizing");
  expect(fetch.requests[1]!.body).toMatchObject({
    history: [{ question: "Explain in detail", answer }],
  });
});

it("restores a stopped question before any output and does not resubmit it", async () => {
  let sent: FetchRequest | undefined;
  const fetch = stubFetch((request) => {
    sent = request;
    return new Response(
      new ReadableStream({
        start(controller) {
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
  await click(button(S.chat.btw.ask));
  await ask("Keep this question");
  await click(button(S.chat.btw.stop));
  expect(sent!.signal!.aborted).toBe(true);
  expect(
    document.querySelector<HTMLInputElement>(".temporary-conversation-composer input")!.value,
  ).toBe("Keep this question");
  expect(fetch.requests).toHaveLength(1);
  expect(document.querySelector(".temporary-conversation-log")!.textContent).not.toContain(
    S.chat.btw.stopped,
  );
});

it("ignores a late answer from a cancelled conversation after a new one opens", async () => {
  let pending: ReadableStreamDefaultController<Uint8Array> | undefined;
  const fetch = stubFetch(() =>
    pending
      ? response("New conversation answer")
      : new Response(
          new ReadableStream({
            start(controller) {
              pending = controller;
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
  );
  await mount(page());
  await click(button(S.chat.btw.ask));
  await ask("Old question");
  await click(button(S.chat.btw.close));
  await click(button(S.chat.btw.ask));
  await ask("New question");
  await act(async () => {
    pending!.enqueue(
      new TextEncoder().encode(
        'event: text\ndata: {"text":"Late old answer"}\n\nevent: done\ndata: {"answer":"Late old answer"}\n\n',
      ),
    );
    pending!.close();
  });
  expect(document.querySelector(".temporary-conversation-log")!.textContent).toContain(
    "New conversation answer",
  );
  expect(document.querySelector(".temporary-conversation-log")!.textContent).not.toContain(
    "Late old answer",
  );
  expect(fetch.requests[1]!.body).toMatchObject({ history: [] });
});

it("keeps earlier turns in view while new answer text streams below", async () => {
  let pending: ReadableStreamDefaultController<Uint8Array> | undefined;
  const fetch = stubFetch((request) => {
    if ((request.body as { question?: string })?.question === "First question")
      return response("An earlier answer. ".repeat(40));
    return new Response(
      new ReadableStream({
        start(controller) {
          pending = controller;
          controller.enqueue(
            new TextEncoder().encode('event: text\ndata: {"text":"New answer starts."}\n\n'),
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
  await click(button(S.chat.btw.ask));
  await ask("First question");
  await ask("Second question");
  const log = document.querySelector<HTMLElement>(".temporary-conversation-log")!;
  // jsdom supplies no layout; these are the scroll measurements of a long conversation.
  Object.defineProperties(log, {
    clientHeight: { value: 200, configurable: true },
    scrollHeight: { value: 1000, configurable: true },
  });
  await act(async () => {
    log.scrollTop = 100;
    log.dispatchEvent(new Event("scroll"));
    pending!.enqueue(
      new TextEncoder().encode('event: text\ndata: {"text":" More new answer text."}\n\n'),
    );
  });
  expect(log.scrollTop).toBe(100);
  expect(log.textContent).toContain("More new answer text.");
  expect(fetch.requests).toHaveLength(2);
  await click(button(S.chat.btw.stop));
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
  expect(document.activeElement).toBe(
    document.querySelector(".temporary-conversation-composer input"),
  );
  await ask("btw private question");
  expect(document.querySelector(".temporary-conversation-log")!.textContent).toContain(
    "private side answer",
  );
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
  expect(document.querySelector(".temporary-conversation-panel")).toBeNull();
  await click(button(S.chat.btw.ask));
  expect(document.querySelector(".temporary-conversation-log")!.textContent).not.toContain(
    "private side answer",
  );
  await ask("new private question");
  expect(fetch.requests[2]!.body).toMatchObject({ history: [] });
  await view.rerender(page("another-session"));
  expect(document.querySelector(".temporary-conversation-panel")).toBeNull();
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
    expect(document.querySelector(".temporary-conversation-log")!.textContent).toContain(
      "partial private answer",
    );
    await click(button(action === "close" ? S.chat.btw.close : S.chat.btw.stop));
    expect(sent!.signal!.aborted).toBe(true);
    expect(document.querySelector("[data-btw-body]")!.textContent).toBe(before);
    if (action === "close")
      expect(document.querySelector(".temporary-conversation-panel")).toBeNull();
    else
      expect(document.querySelector(".temporary-conversation-log")!.textContent).toContain(
        S.chat.btw.stopped,
      );
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
  expect(
    document.querySelector<HTMLInputElement>(".temporary-conversation-composer input")!.value,
  ).toBe("retry this question");
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
  expect(document.querySelector(".temporary-conversation-log")!.textContent).toContain(
    "private side answer",
  );
});
