/** Native TRAE raw-chat transport. The host owns authentication; core consumes MMSP events. */
import { randomBytes, randomUUID } from "node:crypto";
import { UnsupportedParameterError } from "@prismshadow/mmsp";
import type {
  ContentItem,
  FinishReason,
  UniConfig,
  UniEvent,
  UniMessage,
  UsageMetadata,
} from "@prismshadow/mmsp";
import type { AutoLLMClientOptions, ModelClient } from "@prismshadow/penguin-core";
import { readTraeAuth, TraeAuthError } from "./auth.js";
import { listTraeModels } from "./catalog.js";
import { readSse } from "./sse.js";

const CHAT_URL = "https://copilot-cn.bytedance.net/api/ide/v2/llm_raw_chat";
type Block = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: Block[];
  tool_calls?: {
    index: number;
    id: string;
    type: "function";
    function_call: { name: string; arguments: string };
  }[];
  name?: string;
  tool_call_id?: string;
}

function messagesToWire(messages: UniMessage[], systemPrompt?: string): WireMessage[] {
  const out: WireMessage[] = [];
  const names = new Map<string, string>();
  if (systemPrompt !== undefined)
    out.push({ role: "system", content: [{ type: "text", text: systemPrompt }] });
  for (const message of messages) {
    let current: WireMessage = { role: message.role, content: [] };
    const flush = () => {
      if (current.content.length || current.tool_calls?.length) out.push(current);
      current = { role: message.role, content: [] };
    };
    for (const item of message.content_items) {
      switch (item.type) {
        case "text.done":
          current.content.push({ type: "text", text: item.text });
          break;
        case "image_url.done":
          current.content.push({ type: "image_url", image_url: { url: item.image_url } });
          break;
        case "inline_data.done":
          if (!item.mime_type.startsWith("image/"))
            throw new Error("TRAE accepts image data only.");
          current.content.push({
            type: "image_url",
            image_url: { url: `data:${item.mime_type};base64,${item.data.toString("base64")}` },
          });
          break;
        case "tool_call.done":
          names.set(item.tool_call_id, item.name);
          (current.tool_calls ??= []).push({
            index: current.tool_calls?.length ?? 0,
            id: item.tool_call_id,
            type: "function",
            function_call: { name: item.name, arguments: JSON.stringify(item.arguments) },
          });
          break;
        case "tool_result.done":
          flush();
          out.push({
            role: "tool",
            name: names.get(item.tool_call_id) ?? "tool",
            tool_call_id: item.tool_call_id,
            content: [
              { type: "text", text: item.text },
              ...(item.images ?? []).map((url): Block => ({
                type: "image_url",
                image_url: { url },
              })),
            ],
          });
          break;
        case "thinking.done":
          break; // raw-chat replays assistant text and calls, not private reasoning.
        default:
          throw new Error(`TRAE does not support ${item.type} input.`);
      }
    }
    flush();
  }
  return out;
}

function event(
  items: UniEvent["content_items"],
  usage: UsageMetadata | null = null,
  finish: FinishReason | null = null,
): UniEvent {
  return {
    role: "assistant",
    event_type: finish === null ? "delta" : "stop",
    content_items: items,
    usage_metadata: usage,
    finish_reason: finish,
    created_at: Date.now(),
  };
}

interface ToolBuffer {
  id: string;
  name: string;
  arguments: string;
}

function copyHistory(messages: UniMessage[]): UniMessage[] {
  return messages.map((message) => ({
    ...structuredClone(message),
    content_items: message.content_items.map((item) =>
      item.type === "inline_data.done" || item.type === "inline_thinking.done"
        ? { ...structuredClone(item), data: Buffer.from(item.data) }
        : structuredClone(item),
    ),
  }));
}
interface OutputFrame {
  response?: string;
  reasoning_content?: string;
  tool_calls?: {
    index?: number;
    id?: string;
    function_call?: { name?: string; arguments?: string; partial_arguments?: string };
    function?: { name?: string; arguments?: string };
  }[];
}

/** Stateless credential reads plus stateful, committed-only history. No transport retries here. */
export class TraeModelClient implements ModelClient {
  private history: UniMessage[] = [];
  private inFlight: symbol | undefined;
  private readonly sessionId = randomUUID();
  constructor(private readonly options: AutoLLMClientOptions) {
    // A Project cannot redirect this machine's login token to an arbitrary endpoint.
    if (options.baseUrl)
      throw new Error("TRAE uses its native endpoint. Clear the model and group base URL.");
    if (options.apiKey)
      throw new Error(
        "TRAE uses the server machine's CLI login. Clear the model and group API key.",
      );
  }
  getHistory(): UniMessage[] {
    return copyHistory(this.history);
  }
  setHistory(history: UniMessage[]): void {
    this.history = copyHistory(history);
  }
  async listModels(): Promise<string[]> {
    return (await listTraeModels(true)).map((m) => m.modelId);
  }

  async *streamingResponseStateful({
    message,
    config,
    signal,
  }: {
    message: UniMessage;
    config: UniConfig;
    signal?: AbortSignal;
  }): AsyncGenerator<UniEvent> {
    if (this.inFlight) throw new Error("A TRAE request is already running in this client.");
    const flight = Symbol();
    this.inFlight = flight;
    try {
      signal?.throwIfAborted();
      if (config.fast_mode)
        throw new UnsupportedParameterError({
          client: "TRAE",
          parameter: "fast_mode",
          message: "TRAE does not expose a fast serving tier.",
        });
      const auth = readTraeAuth();
      const models = await listTraeModels();
      const model = models.find((m) => m.modelId === this.options.model);
      if (!model)
        throw Object.assign(
          new Error(
            `TRAE model ${this.options.model} is unavailable. Sync TRAE models and choose an available model.`,
          ),
          { status: 404 },
        );
      const input = [...this.history, message];
      const wire = messagesToWire(input, config.system_prompt);
      const lastUser = [...wire].reverse().find((m) => m.role === "user");
      const response = await fetch(CHAT_URL, {
        method: "POST",
        signal,
        redirect: "error",
        headers: {
          ...this.options.defaultHeaders,
          authorization: `Cloud-CLI-JWT ${auth.token}`,
          accept: "text/event-stream",
          "content-type": "application/json",
          "x-agent-flag": "1",
          "x-app-id": "6eefa01c-1036-4c7e-9ca5-d891f63bfcd8",
          "x-ide-function": "traecli_next",
          "x-ide-version-code": "20261022",
          "x-flow-traceparent": `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`,
          version: "0.210.1",
          originator: "penguin",
        },
        body: JSON.stringify({
          extra_info: JSON.stringify({ tool_wire_contract: "preserve_v1" }),
          config_name: model.configName,
          model_name: model.backendModel,
          user_input: (lastUser?.content ?? [])
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join(""),
          messages: wire,
          session_id: this.sessionId,
          conversation_id: this.sessionId,
          is_preset: true,
          tools: (config.tools ?? []).map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description ?? "",
              parameters:
                typeof tool.parameters === "string"
                  ? tool.parameters
                  : JSON.stringify(tool.parameters ?? { type: "object", properties: {} }),
            },
          })),
          max_tokens: config.max_tokens ?? 32000,
          reasoning_effort: config.thinking_level ?? "high",
          parallel_tool_calls: true,
          access_type: 4,
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403)
          throw new TraeAuthError("TRAE rejected the login. Run `traecli login` and retry.");
        throw Object.assign(new Error(`TRAE model service returned HTTP ${response.status}.`), {
          status: response.status,
        });
      }
      if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
        await response.body?.cancel();
        throw new Error("TRAE returned an invalid response stream.");
      }
      const output: ContentItem[] = [];
      let open: { kind: "text" | "thinking"; value: string } | undefined;
      const close = (): UniEvent[] => {
        if (!open) return [];
        const item: ContentItem =
          open.kind === "text"
            ? { type: "text.done", text: open.value }
            : { type: "thinking.done", thinking: open.value };
        output.push(item);
        open = undefined;
        return [event([item])];
      };
      const tools = new Map<number, ToolBuffer>();
      const completedTools: ToolBuffer[] = [];
      let usage: UsageMetadata | null = null;
      let done = false;
      let finish: FinishReason = "stop";
      for await (const frame of readSse(response.body)) {
        signal?.throwIfAborted();
        if (!["output", "token_usage", "done", "error"].includes(frame.event)) {
          // Heartbeats and queue progress reset core's idle timer without becoming reasoning.
          yield event([]);
          continue;
        }
        const payload = JSON.parse(frame.data);
        if (frame.event === "error") {
          const status = payload.code === 3004 ? 429 : payload.code === 4019 ? 403 : 502;
          if (status === 403)
            throw new TraeAuthError("TRAE rejected the login. Run `traecli login` and retry.");
          throw Object.assign(new Error("TRAE model service reported an error."), { status });
        }
        if (frame.event === "output") {
          const delta = payload as OutputFrame;
          for (const [kind, value] of [
            ["thinking", delta.reasoning_content],
            ["text", delta.response],
          ] as const) {
            if (!value) continue;
            if (open?.kind !== kind) {
              yield* close();
              open = { kind, value: "" };
            }
            open.value += value;
            yield event([
              kind === "text"
                ? { type: "text.delta", text: value }
                : { type: "thinking.delta", thinking: value },
            ]);
          }
          for (const [fallbackIndex, call] of (delta.tool_calls ?? []).entries()) {
            const index = call.index ?? fallbackIndex;
            const fn = call.function_call ?? call.function ?? {};
            let tool = tools.get(index);
            if (tool && call.id && tool.id && tool.id !== call.id) {
              completedTools.push(tool);
              tools.delete(index);
              tool = undefined;
            }
            if (!tool) {
              tool = { id: call.id ?? "", name: fn.name ?? "", arguments: "" };
              tools.set(index, tool);
            }
            if (call.id) tool.id = call.id;
            if (fn.name) tool.name = fn.name;
            tool.arguments +=
              fn.arguments ?? ("partial_arguments" in fn ? fn.partial_arguments : "") ?? "";
          }
        } else if (frame.event === "token_usage") {
          const prompt = payload.prompt_tokens ?? 0;
          const cached = payload.cache_read_input_tokens ?? 0;
          const thoughts = payload.reasoning_tokens ?? 0;
          usage = {
            cached_tokens: cached,
            prompt_tokens: Math.max(0, prompt - cached),
            thoughts_tokens: thoughts,
            response_tokens: Math.max(0, (payload.completion_tokens ?? 0) - thoughts),
          };
        } else {
          done = true;
          const reason = payload.finish_reason;
          finish =
            reason === "tool_calls" || reason === "function_call"
              ? "tool_call"
              : reason === "length"
                ? "length"
                : reason === undefined ||
                    reason === null ||
                    reason === "stop" ||
                    reason === "stop_sequence"
                  ? "stop"
                  : "unknown";
          break;
        }
      }
      if (!done || usage === null)
        throw new Error("TRAE response stream ended without completion and token usage.");
      yield* close();
      for (const tool of [...completedTools, ...tools.values()]) {
        if (!tool.id || !tool.name)
          throw new Error("TRAE returned a tool call without an id or name.");
        const args: unknown = JSON.parse(tool.arguments || "{}");
        if (args === null || typeof args !== "object" || Array.isArray(args))
          throw new Error("TRAE returned invalid tool arguments.");
        yield event([
          {
            type: "tool_call.delta",
            name: tool.name,
            arguments: tool.arguments,
            tool_call_id: tool.id,
          },
        ]);
        const item: ContentItem = {
          type: "tool_call.done",
          name: tool.name,
          arguments: args as Record<string, unknown>,
          tool_call_id: tool.id,
        };
        output.push(item);
        yield event([item]);
      }
      if (!output.some((item) => item.type !== "thinking.done"))
        throw new Error("TRAE returned no answer or tool call.");
      if (tools.size || completedTools.length) {
        if (finish === "stop") finish = "tool_call";
      }
      // Commit before yielding stop, matching MMSP when a caller closes at that event.
      this.history = copyHistory([
        ...input,
        { role: "assistant", content_items: output, usage_metadata: usage, finish_reason: finish },
      ]);
      // Core consumes the stop without advancing this iterator again. Release the request
      // before yielding it, or the tool-result request would see an indefinitely busy client.
      this.inFlight = undefined;
      yield event([], usage, finish);
    } finally {
      if (this.inFlight === flight) this.inFlight = undefined;
    }
  }
}
