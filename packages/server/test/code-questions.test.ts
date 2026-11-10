/**
 * - A code question and its follow-up use only selected Workspace code and supplied side turns;
 *   the main trace is unchanged, its next model request excludes side text, and usage is metered.
 * - Invalid selections, an escaped path, another user's Session and excessive side history
 *   are refused before a model request. A changed file is refused until the preview reloads.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiClient, createTestApp, loginAdmin, provisionUser, waitFor } from "./helpers.js";
import type { SessionResponse } from "../src/api/types.js";
import type { TestApp } from "./helpers.js";
import { startMockLLM, requestText } from "./live-session.js";
import type { MockLLM } from "./live-session.js";
let app: TestApp,
  mock: MockLLM,
  client: ReturnType<typeof apiClient>,
  sessionId: string,
  workspace: string;
const selection = { line: 2, column: 1, endLine: 2, endColumn: 20 };
async function messages() {
  return (await client.get(`/api/sessions/${sessionId}/messages`)).json();
}
async function side(over: Record<string, unknown> = {}) {
  return client.post(`/api/sessions/${sessionId}/code-questions`, {
    path: "sample.cpp",
    question: "private-question",
    selection,
    ...over,
  });
}

describe("code side questions", () => {
  beforeAll(async () => {
    mock = await startMockLLM();
    app = await createTestApp({ titles: { maybeGenerate: () => {} } });
    client = apiClient(app.app, (await loginAdmin(app.app)).cookie);
    workspace = path.join(app.root, "workspace");
    await fs.mkdir(workspace);
    await fs.writeFile(
      path.join(workspace, "sample.cpp"),
      "// outside context\nint value = 1 + 2;  \n// do not include\n",
    );
    expect(
      (
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
        })
      ).status,
    ).toBe(200);
    const response = await client.post(
      "/api/projects/default_project/agents/default_agent/sessions",
      { workspace },
    );
    sessionId = ((await response.json()) as SessionResponse).session.sessionId;
    expect(
      (
        await client.post(`/api/sessions/${sessionId}/tasks`, {
          input: [{ type: "text", text: "main-context-only" }],
        })
      ).status,
    ).toBe(202);
    await waitFor(() => app.deps.manager.statusOf(sessionId) === "idle");
  });
  afterAll(async () => {
    await app?.deps.manager.shutdown();
    await app?.cleanup();
    await mock?.close();
  });
  it("keeps selected code and multi-turn side answers out of main history while recording usage", async () => {
    const before = await messages();
    const usageBefore = app.deps.db.prepare("SELECT COUNT(*) AS n FROM usage_records").get() as {
      n: number;
    };
    const first = await side();
    expect(first.status).toBe(200);
    const stream = await first.text();
    expect(stream).toContain("event: done");
    const request = mock.requests.at(-1)!;
    expect(requestText(request)).toContain("int value = 1 + 2;");
    expect(requestText(request)).not.toContain("main-context-only");
    expect(requestText(request)).not.toContain("do not include");
    expect((request as { tools?: unknown[] }).tools ?? []).toEqual([]);
    const followup = await side({
      question: "follow-up-private",
      history: [{ question: "private-question", answer: "private-answer" }],
    });
    expect(await followup.text()).toContain("event: done");
    expect(requestText(mock.requests.at(-1)!)).toContain("private-answer");
    expect(await messages()).toEqual(before);
    const usageAfter = app.deps.db.prepare("SELECT COUNT(*) AS n FROM usage_records").get() as {
      n: number;
    };
    expect(usageAfter.n).toBeGreaterThan(usageBefore.n);
    expect(
      (
        await client.post(`/api/sessions/${sessionId}/tasks`, {
          input: [{ type: "text", text: "continue-main" }],
        })
      ).status,
    ).toBe(202);
    await waitFor(() => app.deps.manager.statusOf(sessionId) === "idle");
    expect(requestText(mock.requests.at(-1)!)).not.toContain("private-question");
    expect(requestText(mock.requests.at(-1)!)).not.toContain("private-answer");
  });
  it.each([
    { selection: { ...selection, line: 0 } },
    { selection: { ...selection, endLine: 1 } },
    { selection: { ...selection, endColumn: 10000 } },
    { history: Array(65).fill({ question: "q", answer: "a" }) },
  ])("refuses invalid selection or history before model work: %j", async (input) => {
    const count = mock.requests.length;
    expect((await side(input)).status).toBe(400);
    expect(mock.requests.length).toBe(count);
  });
  it("refuses paths outside the Workspace", async () => {
    const count = mock.requests.length;
    expect((await side({ path: "../outside.cpp" })).status).not.toBe(200);
    expect(mock.requests.length).toBe(count);
  });
  it("refuses another user's Session before reading code or using its model", async () => {
    const other = await provisionUser(app.app, "code_other", "password123");
    const otherClient = apiClient(app.app, other.cookie);
    const count = mock.requests.length;
    expect(
      (
        await otherClient.post(`/api/sessions/${sessionId}/code-questions`, {
          path: "sample.cpp",
          question: "q",
          selection,
        })
      ).status,
    ).toBe(404);
    expect(mock.requests.length).toBe(count);
  });
  it("rejects stale code instead of answering about bytes the user did not select", async () => {
    const content = await client.get(`/api/sessions/${sessionId}/files/content?path=sample.cpp`);
    const version = content.headers.get("ETag");
    await fs.writeFile(
      path.join(workspace, "sample.cpp"),
      "// outside context\nint value = 4 + 5;  \n",
    );
    const count = mock.requests.length;
    expect((await side({ version })).status).toBe(409);
    expect(mock.requests.length).toBe(count);
  });
});
