// @vitest-environment jsdom
/**
 * - Given a save in flight, a repeated pick cannot write twice.
 * - Given an older config read, its late response cannot replace a saved thinking level.
 * - Given a pending save on another machine, its success or failure cannot alter the current Agent.
 * - Given a pending save after leaving and reopening the same Agent, the save stays locked
 *   through completion and its final configuration is reread.
 * - Given an unresolved Agent, a pick writes nothing.
 */
import { createElement as h } from "react";
import { afterEach, expect, it } from "vitest";
import { useAgentConfig } from "../src/features/chat/session/use-agent-config";
import { button, click, mount, run, settle, unmountAll } from "./helpers/dom";
import { apiError, json, stubFetch } from "./helpers/fetch";

const MACHINE = "QS7J4YVgSovi-Z2c";
afterEach(async () => {
  await unmountAll();
});

function Probe({ machine, agent }: { machine: string | null; agent: string | null }) {
  const config = useAgentConfig("proj", agent, machine);
  return h(
    "div",
    null,
    h("output", null, `${config.agentThinkingLevel}|${config.thinkingSaving}`),
    h("button", { onClick: () => void config.onChangeThinkingLevel("max") }, "Pick max"),
  );
}

function world() {
  let hold: "GET" | "PUT" | null = null;
  let answer: (() => void) | undefined;
  let refused = false;
  const levels = new Map<string | null, string>([
    [null, "medium"],
    [MACHINE, "high"],
  ]);
  const fetch = stubFetch(async (r) => {
    if (!r.path.endsWith("/config")) return apiError(404, "not_found");
    const level = levels.get(r.machine);
    if (r.method === hold) {
      hold = null;
      await new Promise<void>((resolve) => (answer = resolve));
    }
    if (r.method === "PUT") {
      if (refused) return apiError(403, "forbidden");
      levels.set(r.machine, "max");
      return json({ config: { model: { thinkingLevel: "max" } } });
    }
    return json({ config: { model: { thinkingLevel: level } } });
  });
  return {
    requests: fetch.requests,
    delay: (method: "GET" | "PUT") => (hold = method),
    refuse: () => (refused = true),
    answer: async () => {
      answer?.();
      await settle();
    },
  };
}

async function visit(machine: string | null = null, agent: string | null = "helper") {
  const page = await mount(h(Probe, { machine, agent }));
  return {
    text: () => page.container.querySelector("output")?.textContent,
    move: (next: string | null) => page.rerender(h(Probe, { machine: next, agent })),
  };
}

it("posts one thinking save when a repeated pick races its answer", async () => {
  const backend = world();
  const page = await visit();
  backend.delay("PUT");
  await click(button("Pick max"));
  await click(button("Pick max"));
  expect(page.text()).toBe("medium|true");
  expect(backend.requests.filter((r) => r.method === "PUT")).toHaveLength(1);
  await backend.answer();
  expect(page.text()).toBe("max|false");
});

it("does not replace a saved thinking default with an older config read", async () => {
  const backend = world();
  const page = await visit();
  backend.delay("GET");
  await run(() => window.dispatchEvent(new Event("focus")));
  await click(button("Pick max"));
  expect(page.text()).toBe("max|false");
  await backend.answer();
  expect(page.text()).toBe("max|false");
});

it.each([false, true])(
  "does not alter the new machine's Agent when a late save finishes (refused %s)",
  async (refused) => {
    const backend = world();
    const page = await visit();
    backend.delay("PUT");
    await click(button("Pick max"));
    await page.move(MACHINE);
    expect(page.text()).toBe("high|false");
    if (refused) backend.refuse();
    await backend.answer();
    expect(page.text()).toBe("high|false");
  },
);

it("does not write a thinking default before an Agent is resolved", async () => {
  const backend = world();
  const page = await visit(null, null);
  await click(button("Pick max"));
  expect(backend.requests).toHaveLength(0);
  expect(page.text()).toBe("|false");
});

it("keeps a reopened Agent locked until its pending save finishes and rereads the final level", async () => {
  const backend = world();
  const page = await visit();
  backend.delay("PUT");
  await click(button("Pick max"));
  await page.move(MACHINE);
  await page.move(null);
  expect(page.text()).toBe("medium|true");
  await click(button("Pick max"));
  expect(backend.requests.filter((r) => r.method === "PUT")).toHaveLength(1);
  await backend.answer();
  expect(page.text()).toBe("max|false");
});
