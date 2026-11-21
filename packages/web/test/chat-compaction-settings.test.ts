// @vitest-environment jsdom
/**
 * - Given a main conversation on either server, reading and saving its threshold uses its
 *   Agent there; an identically named Agent on the other server is never changed.
 * - Given two machines with the same Agent id, switching conversations reads the new
 *   machine's threshold and thinking default.
 * - Given a pending machine config read, leaving that conversation discards the late answer.
 * - Given a refused threshold write, the saved value remains in force and the error returns.
 * - Given an Agent edited in another tab, refocusing rereads the selected machine's config.
 * - Given a save completed after a machine switch, the new conversation keeps its own settings.
 * - Given a config read started before a save, its late answer cannot replace the saved settings.
 * - Given a conversation left and reopened while a save is pending, its fresh read wins over
 *   the earlier save response.
 */
import { createElement as h, useState } from "react";
import { afterEach, expect, it } from "vitest";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { useMainChatLifecycle } from "../src/features/chat/session/main-chat-lifecycle";
import { createCostStatHold } from "../src/features/chat/header-stats";
import { createStreamModel } from "../src/lib/amsp/stream-model";
import { forgetSessionMachines, rememberSessionMachine } from "../src/lib/session-machines";
import { button, click, mount, run, settle, unmountAll } from "./helpers/dom";
import { apiError, json, stubFetch } from "./helpers/fetch";

const PROJECT = "proj";
const AGENT = "helper";
const MACHINE = "QS7J4YVgSovi-Z2c";
const OTHER = "A83THqd9rtUoVG2C";
const CONFIG = `/api/projects/${PROJECT}/agents/${AGENT}/config`;
type Scope = Parameters<typeof useMainChatLifecycle>[0];
const noop = () => {};

afterEach(async () => {
  await unmountAll();
  forgetSessionMachines();
  localStorage.clear();
});

/** A loaded, idle transcript, the public input to the main chat lifecycle. */
function conversation(machine: string | null): Scope {
  const session = {
    sessionId: machine === null ? "s-here" : `s-${machine}`,
    projectId: PROJECT,
    agentId: AGENT,
    status: "idle",
  } as SessionInfo;
  if (machine !== null) rememberSessionMachine(session.sessionId, machine);
  return {
    projectId: PROJECT,
    selected: session,
    listed: session,
    routed: session,
    routeSessionId: session.sessionId,
    sessions: [session],
    agents: [{ agentId: AGENT }],
    draft: false,
    sessionsLoading: false,
    machineLabels: new Map(),
    machinesUnreachable: false,
    offlineMachineIds: [],
    processes: [],
    infoOpen: false,
    probeKey: session.sessionId,
    probeFailedKey: null,
    probeMissingKey: null,
    stream: { sessionId: session.sessionId, taskState: "idle", model: createStreamModel() },
    costHoldRef: { current: createCostStatHold() },
    usageAppliedRef: { current: null },
    navigate: noop,
    setCurrentAgentId: noop,
    reloadAgents: noop,
    reloadSessions: noop,
    addSession: noop,
    isSessionDeleted: () => false,
    setStatus: noop,
    bumpUsageStamp: noop,
    setCredentialGuide: noop,
    setModels: noop,
    setProcesses: noop,
    setProcBusy: noop,
    setUsageBuckets: noop,
    setUsageCostParts: noop,
    setThinkingSwitch: noop,
    setModelSwitchAsk: noop,
    setFetchedSession: noop,
    setProbeFailedKey: noop,
    setProbeMissingKey: noop,
  } as unknown as Scope;
}

function configServer() {
  const limits = new Map<string | null, number>([
    [null, 425_000],
    [MACHINE, 250_000],
    [OTHER, 325_000],
  ]);
  let refused = false;
  let readsFail = false;
  let held: (() => void) | null = null;
  let holdNext: "GET" | "PUT" | null = null;
  stubFetch(async (request) => {
    if (request.path !== CONFIG) return apiError(404, "not_found");
    if (request.method === "GET" && readsFail) return apiError(503, "unavailable");
    if (request.method === "PUT") {
      if (refused) return apiError(403, "forbidden");
      const body = request.body as { config: { compaction: { maxContextLength: number } } };
      limits.set(request.machine, body.config.compaction.maxContextLength);
    }
    const config = {
      compaction: { maxContextLength: limits.get(request.machine) },
      model: { thinkingLevel: request.machine === OTHER ? "high" : "medium" },
    };
    if (request.method === holdNext) {
      holdNext = null;
      await new Promise<void>((resolve) => {
        held = resolve;
      });
    }
    return json({ config });
  });
  return {
    limits,
    refuse: () => {
      refused = true;
    },
    failReads: () => {
      readsFail = true;
    },
    hold: (method: "GET" | "PUT" = "GET") => {
      holdNext = method;
    },
    answer: async () => {
      held?.();
      held = null;
      await settle();
    },
  };
}

/** Displays the same config values and invokes the same save action the main composer uses. */
function Probe({ scope }: { scope: Scope }) {
  const { compactionLimit, agentThinkingLevel, onChangeCompactionLimit } =
    useMainChatLifecycle(scope);
  const [error, setError] = useState("");
  return h(
    "div",
    null,
    h("output", null, `${compactionLimit ?? "reading"}|${agentThinkingLevel}`),
    h(
      "button",
      {
        onClick: () =>
          void onChangeCompactionLimit(180_000).catch((e: Error) => setError(e.message)),
      },
      "Save threshold",
    ),
    error && h("p", { role: "alert" }, error),
  );
}

async function visit(machine: string | null) {
  const mounted = await mount(h(Probe, { scope: conversation(machine) }));
  await settle();
  return {
    text: () => mounted.container.querySelector("output")?.textContent,
    move: async (next: string | null) => {
      await mounted.rerender(h(Probe, { scope: conversation(next) }));
      await settle();
    },
    save: async () => {
      await click(button("Save threshold"));
      await settle();
    },
  };
}

it.each([null, MACHINE])(
  "reads and saves the main conversation's threshold on its own server (%s)",
  async (machine) => {
    const server = configServer();
    const page = await visit(machine);
    expect(page.text()).toBe(`${server.limits.get(machine)}|medium`);
    await page.save();
    expect(page.text()).toBe("180000|medium");
    expect(server.limits.get(machine)).toBe(180_000);
    expect(server.limits.get(machine === null ? MACHINE : null)).toBe(
      machine === null ? 250_000 : 425_000,
    );
  },
);

it("reads the new machine's threshold and thinking default when the Agent id stays the same", async () => {
  configServer();
  const page = await visit(MACHINE);
  await page.move(OTHER);
  expect(page.text()).toBe("325000|high");
  await page.save();
  expect(page.text()).toBe("180000|high");
});

it("drops a config answer from the remote conversation left behind", async () => {
  const server = configServer();
  server.hold();
  const page = await visit(MACHINE);
  await page.move(null);
  expect(page.text()).toBe("425000|medium");
  await server.answer();
  expect(page.text()).toBe("425000|medium");
});

it("retains the remote Agent's saved threshold when its write is refused", async () => {
  const server = configServer();
  const page = await visit(MACHINE);
  server.refuse();
  await page.save();
  expect(page.text()).toBe("250000|medium");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("forbidden");
  expect(server.limits.get(MACHINE)).toBe(250_000);
  expect(server.limits.get(null)).toBe(425_000);
});

it("refocuses onto the selected machine's updated threshold", async () => {
  const server = configServer();
  const page = await visit(MACHINE);
  server.limits.set(MACHINE, 210_000);
  await run(() => window.dispatchEvent(new Event("focus")));
  expect(page.text()).toBe("210000|medium");
});

it("keeps the new machine's settings when the previous conversation's save finishes", async () => {
  const server = configServer();
  const page = await visit(MACHINE);
  server.hold("PUT");
  await page.save();
  await page.move(null);
  expect(page.text()).toBe("425000|medium");
  server.failReads();
  await server.answer();
  expect(page.text()).toBe("425000|medium");
  expect(server.limits.get(MACHINE)).toBe(180_000);
  expect(server.limits.get(null)).toBe(425_000);
});

it("keeps a successful save when an older config read finishes later", async () => {
  const server = configServer();
  const page = await visit(MACHINE);
  server.hold();
  await run(() => window.dispatchEvent(new Event("focus")));
  await page.save();
  await server.answer();
  expect(page.text()).toBe("180000|medium");
});

it("keeps fresh settings after leaving and reopening the same Agent during a save", async () => {
  const server = configServer();
  const page = await visit(MACHINE);
  server.hold("PUT");
  await page.save();
  await page.move(OTHER);
  server.limits.set(MACHINE, 210_000);
  await page.move(MACHINE);
  expect(page.text()).toBe("210000|medium");
  server.failReads();
  await server.answer();
  expect(page.text()).toBe("210000|medium");
});
