/**
 * Native TRAE through the host's real client and model API.
 * - Given a CLI login and catalog, a stream uses the native endpoint and reports text,
 *   reasoning and uncached/cache/output usage without storing the credential.
 * - Given repeated tool boundaries and parallel calls, each call is delivered once and its
 *   result is paired with the same id/name in the next request.
 * - Given a new login, the next request uses it; missing/expired logins never make a request.
 * - Given a redirected endpoint, a rejected login, malformed arguments, or an incomplete
 *   stream, the client never commits a successful turn or sends the token elsewhere.
 * - Given cancellation during streaming, the response is closed and history stays unchanged.
 * - Given core consumes stop without draining the client iterator, the next tool-result
 *   request still runs; an old iterator's cleanup cannot release a newer request.
 * - Given native catalog sync, Standard/Max rows appear once, while edits and the default
 *   remain; a member cannot sync and no token reaches a response or Project file.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerativeModel, userText } from "@prismshadow/penguin-core";
import type { ContentItem, UniEvent, UniMessage } from "@prismshadow/mmsp";
import { TraeModelClient } from "../src/models/trae/client.js";
import { listTraeModels } from "../src/models/trae/index.js";
import { jsonResponse, stubFetch } from "./fixtures/fetch.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import type { ModelsResponse, ProjectCreateResponse } from "../src/api/types.js";

const user: UniMessage = { role: "user", content_items: [{ type: "text.done", text: "hello" }] };
const tokens = {
  prompt_tokens: 100,
  cache_read_input_tokens: 40,
  completion_tokens: 15,
  reasoning_tokens: 5,
};
const catalog = [
  {
    slug: "Test-Model",
    config_name: "test-config",
    context_window: 200_000,
    business_metadata: {
      variants: {
        standard_key: "standard-backend",
        max_key: "max-backend",
        max_context_window: 1_000_000,
      },
    },
  },
];

function sse(frames: [string, unknown][], fragmented = false): Response {
  const bytes = new TextEncoder().encode(
    frames
      .map(([event, data]) => `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`)
      .join(""),
  );
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        if (fragmented) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        else controller.enqueue(bytes);
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

const answer = () =>
  sse([
    ["output", { response: "ok" }],
    ["token_usage", tokens],
    ["done", { finish_reason: "stop" }],
  ]);
async function collect(client: TraeModelClient, message = user): Promise<UniEvent[]> {
  const events: UniEvent[] = [];
  for await (const event of client.streamingResponseStateful({
    message,
    config: { system_prompt: "system", max_tokens: 32 },
  }))
    events.push(event);
  return events;
}
function items(events: UniEvent[]): ContentItem[] {
  return events
    .flatMap((e) => e.content_items)
    .filter((i): i is ContentItem => i.type.endsWith(".done"));
}

let home: string;
async function login(token = "fixture-token", expiresAt = "2100-01-01T00:00:00Z"): Promise<void> {
  await fs.writeFile(
    path.join(home, "auth.json"),
    JSON.stringify({ trae: { access_token: token, expires_at: expiresAt, region: "CN" } }),
  );
}
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-trae-test-"));
  vi.stubEnv("TRAECLI_HOME", home);
  vi.stubEnv("TRAE_AUTH_FILE", path.join(home, "auth.json"));
  vi.stubEnv("TRAECLI_BIN", path.join(home, "no-cli"));
  await login();
  await fs.writeFile(path.join(home, "models_cache.json"), JSON.stringify({ models: catalog }));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await fs.rm(home, { recursive: true, force: true });
});

describe("native TRAE client", () => {
  const client = (model = "Test-Model") => new TraeModelClient({ model, clientType: "trae" });

  it("uses the native backend and streams split UTF-8/CRLF text, thinking and cache-aware usage", async () => {
    const fake = stubFetch(() =>
      sse(
        [
          ["progress_notice", { message: "queued" }],
          ["output", { reasoning_content: "think" }],
          ["output", { response: "你好" }],
          ["token_usage", tokens],
          ["done", { finish_reason: "stop" }],
        ],
        true,
      ),
    );
    const c = client("Test-Model-max");
    const events = await collect(c);
    expect(items(events)).toEqual([
      { type: "thinking.done", thinking: "think" },
      { type: "text.done", text: "你好" },
    ]);
    expect(events.at(-1)).toMatchObject({
      event_type: "stop",
      usage_metadata: {
        cached_tokens: 40,
        prompt_tokens: 60,
        thoughts_tokens: 5,
        response_tokens: 10,
      },
    });
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.url).toBe("https://copilot-cn.bytedance.net/api/ide/v2/llm_raw_chat");
    expect(call.headers.get("authorization")).toBe("Cloud-CLI-JWT fixture-token");
    expect(call.init?.redirect).toBe("error");
    expect(JSON.parse(call.body)).toMatchObject({
      config_name: "test-config",
      model_name: "max-backend",
      messages: [
        { role: "system", content: [{ type: "text", text: "system" }] },
        { role: "user", content: [{ type: "text", text: "hello" }] },
      ],
    });
    expect(c.getHistory()).toHaveLength(2);
    expect(JSON.stringify(c.getHistory())).not.toContain("fixture-token");
  });

  it("delivers repeated and parallel tool calls once, then sends paired results and schemas", async () => {
    const frames: [string, unknown][] = [
      [
        "output",
        {
          tool_calls: [
            {
              index: 0,
              id: "call-a",
              function_call: { name: "read", partial_arguments: '{"path":' },
            },
            {
              index: 1,
              id: "call-b",
              function_call: { name: "read", partial_arguments: '{"path":' },
            },
          ],
        },
      ],
      [
        "output",
        {
          tool_calls: [
            { index: 0, function_call: { partial_arguments: '"a"}' } },
            { index: 1, function_call: { partial_arguments: '"b"}' } },
          ],
        },
      ],
      [
        "output",
        {
          tool_calls: [
            { index: 0, id: "call-a", function_call: { name: "read" } },
            { index: 1, id: "call-b", function_call: { name: "read" } },
          ],
        },
      ],
      ["token_usage", tokens],
      ["done", { finish_reason: "tool_calls" }],
    ];
    const fake = stubFetch((_call, index) => (index === 0 ? sse(frames) : answer()));
    const c = client();
    const done = items(await collect(c));
    expect(done).toEqual([
      { type: "tool_call.done", name: "read", tool_call_id: "call-a", arguments: { path: "a" } },
      { type: "tool_call.done", name: "read", tool_call_id: "call-b", arguments: { path: "b" } },
    ]);
    for await (const _ of c.streamingResponseStateful({
      message: {
        role: "user",
        content_items: [
          { type: "tool_result.done", tool_call_id: "call-a", text: "A" },
          { type: "tool_result.done", tool_call_id: "call-b", text: "B" },
        ],
      },
      config: {
        tools: [
          {
            name: "read",
            description: "Read",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        ],
      },
    })) {
      /* drain */
    }
    const body = JSON.parse(fake.calls[1]!.body);
    expect(body.messages.slice(-2)).toEqual([
      {
        role: "tool",
        name: "read",
        tool_call_id: "call-a",
        content: [{ type: "text", text: "A" }],
      },
      {
        role: "tool",
        name: "read",
        tool_call_id: "call-b",
        content: [{ type: "text", text: "B" }],
      },
    ]);
    expect(JSON.parse(body.tools[0].function.parameters)).toEqual({
      type: "object",
      properties: { path: { type: "string" } },
    });
  });

  it("rereads the login for each request without losing history or leaking tokens", async () => {
    const fake = stubFetch(answer);
    const c = client();
    await collect(c);
    await login("rotated-token");
    await collect(c);
    expect(fake.calls.map((call) => call.headers.get("authorization"))).toEqual([
      "Cloud-CLI-JWT fixture-token",
      "Cloud-CLI-JWT rotated-token",
    ]);
    expect(JSON.parse(fake.calls[1]!.body).messages).toHaveLength(4);
    expect(JSON.stringify(c.getHistory())).not.toContain("rotated-token");
  });

  it.each(["missing", "expired", "malformed", "other-region"])(
    "a %s login fails before any network request",
    async (kind) => {
      if (kind === "missing") await fs.unlink(path.join(home, "auth.json"));
      else if (kind === "expired") await login("fixture-token", "2000-01-01T00:00:00Z");
      else if (kind === "malformed")
        await fs.writeFile(path.join(home, "auth.json"), "fixture-token");
      else
        await fs.writeFile(
          path.join(home, "auth.json"),
          JSON.stringify({ trae: { access_token: "fixture-token", region: "US" } }),
        );
      const fake = stubFetch(answer);
      const c = client();
      await expect(collect(c)).rejects.toMatchObject({ status: 401 });
      expect(fake.calls).toHaveLength(0);
      expect(c.getHistory()).toEqual([]);
    },
  );

  it("refuses an arbitrary endpoint and a stored key without sending the CLI token", () => {
    const fake = stubFetch(answer);
    expect(
      () => new TraeModelClient({ model: "Test-Model", baseUrl: "https://other.example" }),
    ).toThrow(/Clear/);
    expect(() => new TraeModelClient({ model: "Test-Model", apiKey: "some-key" })).toThrow(/Clear/);
    expect(fake.calls).toHaveLength(0);
  });

  it.each(["no-done", "no-usage", "bad-json", "bad-arguments", "unauthorized"])(
    "a %s response never commits history",
    async (kind) => {
      const frames: [string, unknown][] = [["output", { response: "partial" }]];
      if (kind !== "no-usage") frames.push(["token_usage", tokens]);
      if (kind !== "no-done") frames.push(["done", { finish_reason: "stop" }]);
      const fake = stubFetch(() =>
        kind === "unauthorized"
          ? jsonResponse({}, 401)
          : kind === "bad-json"
            ? new Response("event: output\ndata: bad-json\n\n", {
                headers: { "content-type": "text/event-stream" },
              })
            : kind === "bad-arguments"
              ? sse([
                  [
                    "output",
                    {
                      tool_calls: [{ id: "bad", function_call: { name: "read", arguments: "{" } }],
                    },
                  ],
                  ["token_usage", tokens],
                  ["done", {}],
                ])
              : sse(frames),
      );
      const c = client();
      await expect(collect(c)).rejects.toThrow();
      expect(fake.calls).toHaveLength(1);
      expect(c.getHistory()).toEqual([]);
    },
  );

  it("cancels the response and keeps history unchanged when the consumer closes mid-stream", async () => {
    let cancelled = false;
    stubFetch(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode('event: output\ndata: {"response":"partial"}\n\n'),
              );
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const c = client();
    const stream = c.streamingResponseStateful({ message: user, config: {} });
    expect((await stream.next()).value).toMatchObject({ event_type: "delta" });
    await stream.return(undefined);
    expect(cancelled).toBe(true);
    expect(c.getHistory()).toEqual([]);
  });

  it("replays binary image data as base64 after history is copied", async () => {
    const fake = stubFetch(answer);
    const c = client();
    c.setHistory([
      {
        role: "user",
        content_items: [
          { type: "inline_data.done", data: Buffer.from("image"), mime_type: "image/png" },
        ],
      },
    ]);
    await collect(c);
    expect(JSON.parse(fake.calls[0]!.body).messages[1].content[0].image_url.url).toBe(
      "data:image/png;base64,aW1hZ2U=",
    );
  });

  it("runs through core's host protocol and reports provider authentication as fatal", async () => {
    stubFetch(() => jsonResponse({}, 401));
    const llm = new GenerativeModel({ modelId: "Test-Model", clientType: "trae", tools: [] });
    const stream = llm.streamGenerate({ newMessages: [userText("hello")] });
    let result = await stream.next();
    while (!result.done) result = await stream.next();
    expect(result.value).toMatchObject({ status: "fatal", errorCode: "auth" });
  });

  it("starts the tool-result request after core consumes stop without draining the client", async () => {
    const fake = stubFetch((_call, index) =>
      index === 0
        ? sse([
            [
              "output",
              {
                tool_calls: [{ id: "call-next", function_call: { name: "read", arguments: "{}" } }],
              },
            ],
            ["token_usage", tokens],
            ["done", { finish_reason: "tool_calls" }],
          ])
        : answer(),
    );
    const llm = new GenerativeModel({ modelId: "Test-Model", clientType: "trae", tools: [] });
    const run = async (
      newMessages: Parameters<GenerativeModel["streamGenerate"]>[0]["newMessages"],
    ) => {
      const stream = llm.streamGenerate({ newMessages });
      let result = await stream.next();
      while (!result.done) result = await stream.next();
      return result.value;
    };
    expect(await run([userText("hello")])).toMatchObject({ status: "completed" });
    expect(
      await run([
        {
          type: "model_msg",
          timestamp: new Date().toISOString(),
          payload: {
            type: "tool_call_output",
            role: "user",
            tool_call_id: "call-next",
            output: "result",
            status: "completed",
          },
        },
      ]),
    ).toMatchObject({ status: "completed" });
    expect(fake.calls).toHaveLength(2);
  });
});

describe("native TRAE catalog API", () => {
  let app: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let count = 0;
  beforeAll(async () => {
    app = await createTestApp();
    owner = apiClient(app.app, (await provisionUser(app.app, "trae_owner")).cookie);
    outsider = apiClient(app.app, (await provisionUser(app.app, "trae_member")).cookie);
  });
  afterAll(async () => {
    await app.cleanup();
  });

  it("syncs account Standard/Max models once and preserves edits/defaults without storing a token", async () => {
    const created = await owner.post("/api/projects", {
      projectId: `trae_owner-test_${++count}`,
      name: "TRAE",
    });
    expect(created.status, created.status === 201 ? "" : await created.text()).toBe(201);
    const { project } = (await created.json()) as ProjectCreateResponse;
    const url = `/api/projects/${project.projectId}/models`;
    const before = (await (await owner.get(url)).json()) as ModelsResponse;
    const synced = await owner.post(`${url}/trae/sync`, {});
    expect(synced.status).toBe(200);
    const result = (await synced.json()) as ModelsResponse;
    expect(result.defaultModel).toEqual(before.defaultModel);
    expect(
      result.models
        .filter((m) => m.provider === "trae")
        .map((m) => [m.modelId, m.contextWindow, m.localAuthAvailable]),
    ).toEqual([
      ["Test-Model", 200_000, true],
      ["Test-Model-max", 1_000_000, true],
    ]);
    const table = await app.deps.projectConfigService.readRaw(project.projectId);
    const model = (table.models as Record<string, unknown>[]).find((m) => m.provider === "trae")!;
    model.display_name = "My name";
    model.context_window = 123456;
    await app.deps.projectConfigService.writeRaw(project.projectId, table);
    const again = (await (await owner.post(`${url}/trae/sync`, {})).json()) as ModelsResponse;
    expect(again.models.filter((m) => m.provider === "trae")).toHaveLength(2);
    expect(again.models.find((m) => m.modelId === "Test-Model")).toMatchObject({
      displayName: "My name",
      contextWindow: 123456,
    });
    expect(JSON.stringify(again)).not.toContain("fixture-token");
    expect(
      await fs.readFile(path.join(app.root, project.projectId, ".project_config.toml"), "utf8"),
    ).not.toContain("fixture-token");
    const membership = await owner.post(`/api/projects/${project.projectId}/members`, {
      userId: "trae_member",
    });
    expect(membership.status).toBe(201);
    const refused = await outsider.post(`${url}/trae/sync`, {});
    expect(refused.status).toBe(403);
  });

  it("lists models from the CLI cache with Max only where the account has a backend", async () => {
    await fs.writeFile(
      path.join(home, "models_cache.json"),
      JSON.stringify({
        models: [
          ...catalog,
          {
            slug: "Standard-Only",
            context_window: 32000,
            business_metadata: { variants: { max_key: null } },
          },
        ],
      }),
    );
    expect((await listTraeModels(true)).map((m) => m.modelId)).toEqual([
      "Test-Model",
      "Test-Model-max",
      "Standard-Only",
    ]);
  });
});
