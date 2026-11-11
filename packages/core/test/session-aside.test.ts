/**
 * - Given an active main conversation, two side questions use fresh model contexts and never
 *   write their answers to the main Trace or send them with the next main task.
 * - Given resumed history before the main engine starts, a side question reads visible main
 *   text and tool results in order, without reasoning, fidelity or child-origin messages.
 * - Given a cancelled question, no model client is created and the result is aborted.
 * - Given a Session without a bare model factory, the question fails without a main run.
 */
import { describe, expect, it } from "vitest";
import { Session, assistantText, userText } from "../src/index.js";
import type { AmspRecord, EnvironmentInterface, LLMInterface } from "../src/index.js";
import { thinkingMessage, toolCall, toolCallOutput } from "@prismshadow/amsp/records";
const environment: EnvironmentInterface = {
  listTools: async () => [],
  executeTool: async function* () {
    throw new Error("Side questions must not execute tools");
  },
  toolPermission: () => undefined,
};
const meta = {
  session_id: "aside-session",
  provider: "custom",
  model_id: "m",
  model_context_window: 200000,
  system_prompt: "main-only system prompt",
  agent_state: "/tmp/state",
  workspace: "/tmp/code",
  source: "user" as const,
};
const base = {
  meta,
  environment,
  bootstrap: async () => {
    throw new Error("The main model must not run");
  },
  imagesDir: "/tmp/aside-test",
  modelHasVision: true,
};
async function drain(stream: AsyncGenerator<AmspRecord, unknown>) {
  const records = [];
  for (;;) {
    const step = await stream.next();
    if (step.done) return { records, outcome: step.value };
    records.push(step.value);
  }
}

describe("side questions", () => {
  it("keeps side model contexts, answers and Trace writes separate from the main task", async () => {
    const mainInputs: AmspRecord[][] = [],
      sideInputs: AmspRecord[][] = [],
      trace: AmspRecord[] = [];
    const main: LLMInterface = {
      contextSnapshot: () => JSON.stringify(mainInputs),
      async *streamGenerate({ newMessages }) {
        mainInputs.push(newMessages);
        yield assistantText("main answer");
        return { status: "completed" };
      },
    };
    let clients = 0;
    const session = new Session({
      ...base,
      bootstrap: async () => ({ llm: main }),
      trace: {
        write: async (record) => {
          trace.push(record);
        },
      },
      createBareLLM: () => {
        clients++;
        return {
          async *streamGenerate({ newMessages }) {
            sideInputs.push(newMessages);
            yield assistantText("private answer");
            return { status: "completed" };
          },
        };
      },
    });
    await drain(session.run([userText("main task")]));
    const snapshot = JSON.stringify(trace);
    const first = await drain(session.streamAside("question one"));
    const second = await drain(session.streamAside("question two"));
    expect(first.records).toContainEqual(
      expect.objectContaining({ payload: expect.objectContaining({ text: "private answer" }) }),
    );
    expect(second.outcome).toEqual({ status: "completed" });
    expect(JSON.stringify(trace)).toBe(snapshot);
    expect(clients).toBe(2);
    expect(JSON.stringify(sideInputs[0])).toContain("main task");
    expect(JSON.stringify(sideInputs[0])).toContain("question one");
    expect(JSON.stringify(sideInputs[1])).toContain("question two");
    expect(JSON.stringify(sideInputs[1])).not.toContain("private answer");
    await drain(session.run([userText("next main task")]));
    expect(JSON.stringify(mainInputs)).not.toContain("question one");
    expect(JSON.stringify(mainInputs)).not.toContain("private answer");
    await drain(session.streamAside("third question"));
    expect(JSON.stringify(sideInputs[2])).toContain("next main task");
    expect(JSON.stringify(sideInputs[2])).not.toContain("private answer");
  });
  it("reads resumed visible main context without starting or writing the main engine", async () => {
    const inputs: AmspRecord[][] = [];
    const session = new Session({
      ...base,
      resumedHistory: [
        userText("repeated main instruction"),
        userText("repeated main instruction"),
        thinkingMessage("private reasoning", { signature: "private-signature" }),
        assistantText("visible main answer", { signature: "private-signature" }),
        toolCall({ name: "read_file", arguments: '{"path":"main.cpp"}', toolCallId: "tc1" }),
        toolCallOutput({ output: "visible tool result", toolCallId: "tc1", status: "completed" }),
        { ...assistantText("child-only message"), origin: ["child"] },
      ],
      trace: {
        write: async () => {
          throw new Error("A side question must not write the Trace");
        },
      },
      createBareLLM: () => ({
        async *streamGenerate({ newMessages }) {
          inputs.push(newMessages);
          yield assistantText("side answer");
          return { status: "completed" };
        },
      }),
    });
    expect((await drain(session.streamAside("side question"))).outcome).toEqual({
      status: "completed",
    });
    const sent = JSON.stringify(inputs[0]);
    expect(sent).toContain("main-only system prompt");
    expect(sent.match(/repeated main instruction/g)).toHaveLength(2);
    expect(sent).toContain("visible main answer");
    expect(sent).toContain("read_file");
    expect(sent).toContain("main.cpp");
    expect(sent).toContain("visible tool result");
    expect(sent.indexOf("visible main answer")).toBeLessThan(sent.indexOf("visible tool result"));
    expect(sent).not.toContain("private reasoning");
    expect(sent).not.toContain("private-signature");
    expect(sent).not.toContain("child-only message");
  });
  it("does not construct a client after a side question is cancelled", async () => {
    const session = new Session({
      ...base,
      createBareLLM: () => {
        throw new Error("Must not construct after cancellation");
      },
    });
    const controller = new AbortController();
    controller.abort();
    expect(await drain(session.streamAside("question", controller.signal))).toEqual({
      records: [],
      outcome: { status: "aborted" },
    });
  });
  it("reports an unavailable side model without running the main model", async () => {
    const session = new Session(base);
    expect(await drain(session.streamAside("question"))).toEqual({
      records: [],
      outcome: {
        status: "fatal",
        errorMessage: "Side questions are unavailable for this Session.",
      },
    });
  });
});
