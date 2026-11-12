/**
 * - A question and follow-up read the original assistant reply and current main context;
 *   neither writes main messages or tools, and the next main request excludes side text.
 * - Invalid source coordinates, non-assistant records, empty or oversized input, and
 *   another user's Session fail before a model request.
 * - A long old reply retains the selected passage in bounded context.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { apiClient, createTestApp, loginAdmin, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { startMockLLM, requestText } from "./live-session.js";
import type { MockLLM } from "./live-session.js";
import type { MessagesResponse, SessionResponse, TracePosition } from "../src/api/types.js";
import { btwReplyContext } from "../src/services/btw-context.js";
let app: TestApp,
  mock: MockLLM,
  client: ReturnType<typeof apiClient>,
  sessionId: string,
  position: TracePosition;
const original =
  "Bloom Filter **may** report a value as present when it is absent. This is a source-only reply.";
const messagePath = () => `/api/sessions/${sessionId}/messages`;
const ask = (over: Record<string, unknown> = {}) =>
  client.post(`/api/sessions/${sessionId}/btw-questions`, {
    position,
    excerpt: "a value as present when it is absent",
    question: "btw-private-question",
    ...over,
  });

describe("temporary reading questions", () => {
  beforeAll(async () => {
    mock = await startMockLLM((n) => (n === 1 ? original : `temporary-answer-${n}`));
    app = await createTestApp({ titles: { maybeGenerate: () => {} } });
    client = apiClient(app.app, (await loginAdmin(app.app)).cookie);
    const workspace = path.join(app.root, "reading-workspace");
    await fs.mkdir(workspace);
    await client.put("/api/projects/default_project/models", {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          clientType: "ant-messages",
          baseUrl: mock.url,
          apiKey: "mock",
          contextWindow: 200000,
        },
      ],
    });
    sessionId = (
      (await (
        await client.post("/api/projects/default_project/agents/default_agent/sessions", {
          workspace,
        })
      ).json()) as SessionResponse
    ).session.sessionId;
    await client.post(`/api/sessions/${sessionId}/tasks`, {
      input: [{ type: "text", text: "main-context-only" }],
    });
    await waitFor(() => app.deps.manager.statusOf(sessionId) === "idle");
    const history = (await (await client.get(messagePath())).json()) as MessagesResponse;
    position = history.messages.find(
      (record) => (record.payload as { text?: string }).text === original,
    )!.tracePosition!;
  });
  afterAll(async () => {
    await app?.deps.manager.shutdown();
    await app?.cleanup();
    await mock?.close();
  });
  it("keeps metered side answers separate while reading the original reply and fresh main context", async () => {
    const before = (await (await client.get(messagePath())).json()) as MessagesResponse;
    const usageBefore = app.deps.db.prepare("SELECT COUNT(*) AS n FROM usage_records").get() as {
      n: number;
    };
    const first = await ask();
    expect(first.status).toBe(200);
    expect(await first.text()).toContain("event: done");
    expect(requestText(mock.requests.at(-1)!)).toContain(original);
    expect(requestText(mock.requests.at(-1)!)).toContain("main-context-only");
    expect((mock.requests.at(-1)! as { tools?: unknown[] }).tools ?? []).toEqual([]);
    const second = await ask({
      question: "btw-follow-up",
      history: [{ question: "btw-private-question", answer: "temporary-answer-2" }],
    });
    expect(await second.text()).toContain("event: done");
    expect(requestText(mock.requests.at(-1)!)).toContain("temporary-answer-2");
    expect(((await (await client.get(messagePath())).json()) as MessagesResponse).messages).toEqual(
      before.messages,
    );
    expect(app.deps.manager.statusOf(sessionId)).toBe("idle");
    const usageAfter = app.deps.db.prepare("SELECT COUNT(*) AS n FROM usage_records").get() as {
      n: number;
    };
    expect(usageAfter.n).toBeGreaterThan(usageBefore.n);
    await client.post(`/api/sessions/${sessionId}/tasks`, {
      input: [{ type: "text", text: "new-main-context" }],
    });
    await waitFor(() => app.deps.manager.statusOf(sessionId) === "idle");
    expect(requestText(mock.requests.at(-1)!)).not.toContain("btw-private-question");
    expect(requestText(mock.requests.at(-1)!)).not.toContain("btw-follow-up");
    expect(requestText(mock.requests.at(-1)!)).not.toContain("temporary-answer-2");
    const fresh = await ask({ question: "explain-old-reply" });
    expect(await fresh.text()).toContain("event: done");
    expect(requestText(mock.requests.at(-1)!)).toContain("new-main-context");
    expect(requestText(mock.requests.at(-1)!)).toContain(original);
  });
  it.each([
    { position: undefined },
    { position: { fileIndex: -1, ordinal: 0 } },
    { position: { fileIndex: 0, ordinal: 1.5 } },
    { question: " " },
    { question: "q".repeat(5001) },
    { excerpt: " " },
    { excerpt: "x".repeat(24001) },
    { history: Array(65).fill({ question: "q", answer: "a" }) },
    { history: [{ question: "q", answer: "a".repeat(100001) }] },
  ])("refuses malformed reading input without model work (case %#)", async (over) => {
    const count = mock.requests.length;
    expect((await ask(over)).status).toBe(400);
    expect(mock.requests.length).toBe(count);
  });
  it("refuses a source that is a Session metadata record", async () => {
    const count = mock.requests.length;
    expect((await ask({ position: { ...position, ordinal: 0 } })).status).toBe(400);
    expect(mock.requests.length).toBe(count);
  });
  it("refuses access to another user's source before reading or calling the model", async () => {
    const { cookie } = await provisionUser(app.app, "btw_other_user", "password123");
    const other = apiClient(app.app, cookie),
      count = mock.requests.length;
    expect(
      (
        await other.post(`/api/sessions/${sessionId}/btw-questions`, {
          position,
          question: "private",
        })
      ).status,
    ).toBe(404);
    expect(mock.requests.length).toBe(count);
  });
});

describe("reading context", () => {
  it("preserves a short original reply intact", () => {
    expect(btwReplyContext(original, undefined).text).toBe(original);
    expect(btwReplyContext(original, "may").truncated).toBe(false);
  });
  it("keeps a distant selected passage with its surrounding Markdown", () => {
    const selected = "selected phrase near the end";
    const reply =
      "earlier unrelated content\n".repeat(5000) +
      `**${selected}** and its explanation\n` +
      "following context\n".repeat(2000);
    const context = btwReplyContext(reply, selected);
    expect(context.truncated).toBe(true);
    expect(context.text.length).toBeLessThanOrEqual(60000);
    expect(context.text).toContain(`**${selected}** and its explanation`);
    expect(context.text).toContain("following context");
  });
  it("bounds a whole long reply when no excerpt is selected", () => {
    const context = btwReplyContext("reply paragraph\n".repeat(10000), undefined);
    expect(context.truncated).toBe(true);
    expect(context.text.length).toBeLessThanOrEqual(60000);
  });
});
