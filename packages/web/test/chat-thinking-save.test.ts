// @vitest-environment jsdom
/**
 * - Given a local or remote conversation opened outside the paged list, saving a thinking
 *   level survives a list refresh and never writes the Agent's defaults.
 * - Given a delayed direct switch, the dialog waits for the save and cannot post twice.
 * - Given a refused direct switch, the original level and dialog remain for a retry.
 * - Given a completed compaction, success is reported only after the thinking save succeeds.
 * - Given a refused save after compaction, no switch success is reported.
 * - Given a save finishing after navigation, the new conversation keeps its own level.
 * - Given a settled compaction from the previous conversation during navigation, its
 *   pending thinking switch never writes to the new conversation.
 * - Given a compacted switch saving during navigation, its delayed success does not
 *   appear in the next conversation.
 */
import { createElement as h, useCallback, useState } from "react";
import { afterEach, expect, it } from "vitest";
import { toastStore } from "@prismshadow/penguin-ui";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { useMainChatComposer } from "../src/features/chat/session/main-chat-composer";
import { useMainChatControls } from "../src/features/chat/session/main-chat-controls";
import { renderMainChatDialogs } from "../src/features/chat/session/main-chat-dialogs";
import type { MainChatView } from "../src/features/chat/body/main-chat-view";
import { resolveRoutedSession } from "../src/features/chat/session-project";
import { ThinkingLevelSelect, type StagedThinkingSwitch } from "../src/features/model-picker";
import { createStreamModel } from "../src/lib/amsp/stream-model";
import { forgetSessionMachines, rememberSessionMachine } from "../src/lib/session-machines";
import { LocaleProvider } from "../src/state/locale";
import { S } from "../src/lib/strings";
import { button, click, dialogs, mount, run, settle, unmountAll } from "./helpers/dom";
import { apiError, json, stubFetch } from "./helpers/fetch";

const MACHINE = "QS7J4YVgSovi-Z2c";
const noop = () => {};
type Scope = Parameters<typeof useMainChatComposer>[0];
const row = (id: string): SessionInfo =>
  ({ sessionId: id, projectId: "proj", agentId: "helper", thinkingLevel: "medium" }) as SessionInfo;

afterEach(async () => {
  await unmountAll();
  forgetSessionMachines();
  toastStore.setState({ items: [] });
  localStorage.clear();
});

function server() {
  let held: (() => void) | null = null;
  let hold = false;
  let refused = false;
  const fetch = stubFetch(async (request) => {
    const id = request.path.split("/").at(-1)!;
    if (request.method !== "PATCH") return apiError(404, "not_found");
    if (hold) await new Promise<void>((resolve) => (held = resolve));
    if (refused) return apiError(403, "forbidden");
    return json({ session: { ...row(id), ...(request.body as object) } });
  });
  return {
    requests: fetch.requests,
    delay: () => (hold = true),
    refuse: (value = true) => (refused = value),
    answer: async () => {
      hold = false;
      held?.();
      await settle();
    },
  };
}

function Probe({
  id,
  history,
  compacted,
  waiting = false,
  streamId = id,
}: {
  id: string;
  history: boolean;
  compacted: boolean;
  waiting?: boolean;
  streamId?: string;
}) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [fetched, setFetchedSession] = useState<SessionInfo | null>(row(id));
  const [thinkingSwitch, setThinkingSwitch] = useState<StagedThinkingSwitch | null>(
    compacted
      ? { phase: "compacting", level: "max", baseline: { settled: 0, completed: 0 } }
      : null,
  );
  const selected = resolveRoutedSession(id, sessions, fetched, "proj") ?? row(id);
  const replace = useCallback((session: SessionInfo) => {
    setSessions((cur) => [...cur.filter((r) => r.sessionId !== session.sessionId), session]);
  }, []);
  const [model] = useState(() => {
    const model = createStreamModel();
    if (history)
      model.items.push({ kind: "assistant_text", id: 1, text: "A reply", streaming: false });
    if (compacted)
      model.items.push({
        kind: "compaction",
        id: 2,
        reason: "manual",
        mode: "summarize",
        status: "completed",
        running: false,
      });
    return model;
  });
  const compaction = model.items.find((item) => item.kind === "compaction");
  if (compaction?.kind === "compaction") compaction.running = waiting;
  const scope = useMainChatControls(
    useMainChatComposer({
      selected,
      selectedSessionId: id,
      replace,
      setFetchedSession,
      thinkingSwitch,
      setThinkingSwitch,
      stream: {
        sessionId: streamId,
        model,
        taskState: "idle",
        version: waiting ? 1 : 2,
        loading: false,
      },
      turnThinkingLevel: selected.thinkingLevel,
      agentThinkingLevel: "medium",
      models: null,
      modeSaving: false,
      setModeSaving: noop,
      modelSwitchAsk: null,
      setModelSwitchAsk: noop,
      modelSwitchPosting: false,
      setModelSwitchPosting: noop,
      syncHealedSessionId: async () => {},
    } as unknown as Scope),
  );
  return h(
    "div",
    null,
    h("output", null, selected.thinkingLevel),
    h(ThinkingLevelSelect, {
      value: selected.thinkingLevel ?? "medium",
      onChange: scope.onPickTurnThinkingLevel,
      disabled: scope.thinkingSaving,
    }),
    h("button", { onClick: () => setSessions([]) }, "Refresh list"),
    renderMainChatDialogs({
      ...scope,
      credentialGuide: false,
      procToKill: null,
      setCredentialGuide: noop,
      setProcToKill: noop,
    } as unknown as MainChatView),
  );
}

async function visit(id = "s", history = false, compacted = false, waiting = false) {
  const element = (next: string, pending = waiting, streamId = next) =>
    h(LocaleProvider, null, h(Probe, { id: next, history, compacted, waiting: pending, streamId }));
  const page = await mount(element(id));
  return {
    text: () => page.container.querySelector("output")?.textContent,
    move: (next: string) => page.rerender(element(next)),
    settlePrevious: (next: string) => page.rerender(element(next, false, id)),
    pick: async () => {
      await click(button(S.chat.thinkingLevel));
      await click(button(S.chat.thinkingLevelMenuName(S.chat.thinkingLevelNames.max!, "max")));
    },
  };
}

it.each([null, MACHINE])("keeps a saved level through a list refresh (%s)", async (machine) => {
  const backend = server();
  if (machine) rememberSessionMachine("s", machine);
  const page = await visit();
  await page.pick();
  expect(page.text()).toBe("max");
  await click(button("Refresh list"));
  expect(page.text()).toBe("max");
  expect(backend.requests.map((r) => [r.method, r.machine, r.path, r.body])).toEqual([
    ["PATCH", machine, "/api/sessions/s", { thinkingLevel: "max" }],
  ]);
});

it("keeps a direct switch busy until the save answers and posts only once", async () => {
  const backend = server();
  backend.delay();
  const page = await visit("s", true);
  await page.pick();
  await click(button(S.chat.thinkingSwitchConfirm));
  expect(dialogs()).toHaveLength(1);
  expect(button(S.chat.thinkingSwitchConfirm).disabled).toBe(true);
  await click(button(S.chat.thinkingSwitchConfirm));
  expect(backend.requests).toHaveLength(1);
  expect(page.text()).toBe("medium");
  await backend.answer();
  expect(dialogs()).toHaveLength(0);
  expect(page.text()).toBe("max");
});

it("keeps the original level and the direct-switch dialog after a refused save", async () => {
  const backend = server();
  backend.refuse();
  const page = await visit("s", true);
  await page.pick();
  await click(button(S.chat.thinkingSwitchConfirm));
  expect(page.text()).toBe("medium");
  expect(dialogs()).toHaveLength(1);
  expect(toastStore.getState().items.some((t) => t.kind === "error")).toBe(true);
  backend.refuse(false);
  await click(button(S.chat.thinkingSwitchConfirm));
  expect(page.text()).toBe("max");
  expect(dialogs()).toHaveLength(0);
});

it.each([false, true])(
  "reports compacted switch success only after a successful save (refused %s)",
  async (refused) => {
    const backend = server();
    backend.delay();
    backend.refuse(refused);
    const page = await visit("s", true, true);
    expect(toastStore.getState().items.filter((t) => t.kind === "success")).toHaveLength(0);
    await backend.answer();
    expect(page.text()).toBe(refused ? "medium" : "max");
    expect(toastStore.getState().items.filter((t) => t.kind === "success")).toHaveLength(
      refused ? 0 : 1,
    );
  },
);

it("does not move another conversation's level when a late save answers", async () => {
  const backend = server();
  backend.delay();
  const page = await visit();
  await page.pick();
  await page.move("other");
  await run(() => toastStore.setState({ items: [] }));
  await backend.answer();
  expect(page.text()).toBe("medium");
});

it("never applies the previous conversation's compacted thinking switch to a new conversation", async () => {
  const backend = server();
  const page = await visit("s", true, true, true);
  expect(backend.requests).toHaveLength(0);
  await page.settlePrevious("other");
  expect(backend.requests).toHaveLength(0);
  expect(page.text()).toBe("medium");
});

it("does not report a previous conversation's delayed switch success in the next conversation", async () => {
  const backend = server();
  backend.delay();
  const page = await visit("s", true, true);
  await page.move("other");
  await backend.answer();
  expect(toastStore.getState().items.filter((t) => t.kind === "success")).toHaveLength(0);
});
