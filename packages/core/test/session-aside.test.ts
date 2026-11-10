/**
 * - Given an active main conversation, two side questions use fresh model contexts and never
 *   write their answers to the main Trace or send them with the next main task.
 * - Given a cancelled question, no model client is created and the result is aborted.
 * - Given a Session without a bare model factory, the question fails without a main run.
 */
import { describe, expect, it } from "vitest";
import { Session, assistantText, userText } from "../src/index.js";
import type { AmspRecord, EnvironmentInterface, LLMInterface } from "../src/index.js";
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
    expect(
      sideInputs.map((records) =>
        records.map((record) => (record.payload as { text?: string }).text),
      ),
    ).toEqual([["question one"], ["question two"]]);
    await drain(session.run([userText("next main task")]));
    expect(JSON.stringify(mainInputs)).not.toContain("question one");
    expect(JSON.stringify(mainInputs)).not.toContain("private answer");
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
