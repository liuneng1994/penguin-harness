/** @vitest-environment jsdom */
/**
 * A workbench selection belongs to the actual Agent and the current chat route.
 * - Changing Agent hides previous tabs immediately and ignores their late response.
 * - A full-app return restores its tab after loading; a fresh chat route starts on Chat.
 * - Removing the selected tab forgets it even if a later refresh brings it back.
 * - Citation-only code previews remain available to the chat without offering a standalone tab;
 *   returning from that page falls back to Chat while ordinary workbench tabs still work.
 */
import { createElement as h } from "react";
import { afterEach, expect, it } from "vitest";
import { useWorkbenchTabs } from "../src/features/workbenches/workbench-tabs";
import { WORKBENCH_UPDATED_EVENT } from "../src/lib/workbench-tabs";
import { json, stubFetch } from "./helpers/fetch";
import { button, click, mount, run, unmountAll } from "./helpers/dom";

const result = {
  workbenches: [
    {
      id: "demo",
      name: "Demo",
      revision: "r",
      uiRev: "u",
      error: null,
      hints: [],
      tabs: [
        { id: "demo.main", key: "main", title: "Board", renderer: { iframe: { src: "/board" } } },
      ],
    },
  ],
};
function Page({
  agent,
  route = "one",
  initial = null,
}: {
  agent: string | null;
  route?: string;
  initial?: string | null;
}) {
  const wb = useWorkbenchTabs("p", agent, null, route, initial);
  return h(
    "div",
    null,
    h("output", { "aria-label": "active" }, wb.active ?? "chat"),
    h("output", { "aria-label": "code-preview" }, wb.codePreviewTab?.src ?? ""),
    ...wb.tabs.map((tab) =>
      h("button", { key: tab.tabId, onClick: () => wb.setActive(tab.tabId) }, tab.title),
    ),
  );
}
const selected = () => document.querySelector("output")!.textContent;
afterEach(unmountAll);
it("keeps the code-preview renderer available while excluding it from standalone selection", async () => {
  stubFetch(() =>
    json({
      workbenches: [
        {
          ...result.workbenches[0],
          tabs: [
            ...result.workbenches[0]!.tabs,
            {
              id: "demo.code",
              key: "code-preview",
              title: "Code",
              renderer: { iframe: { src: "/code" } },
            },
          ],
        },
      ],
    }),
  );
  await mount(h(Page, { agent: "general", initial: "demo/code-preview" }));
  expect(document.querySelector('[aria-label="code-preview"]')!.textContent).toBe("/code");
  expect([...document.querySelectorAll("button")].map((node) => node.textContent)).toEqual([
    "Board",
  ]);
  expect(selected()).toBe("chat");
  await click(button("Board"));
  expect(selected()).toBe("demo/main");
});
it("hides the old Agent's tabs immediately and ignores its late response", async () => {
  let finish!: (response: Response) => void;
  stubFetch((request) =>
    request.path.includes("/agents/old/")
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : json({ workbenches: [] }),
  );
  const page = await mount(h(Page, { agent: "old" }));
  await page.rerender(h(Page, { agent: "general" }));
  await run(() => finish(json(result)));
  expect(document.querySelector("button")).toBeNull();
  expect(selected()).toBe("chat");
});
it("restores a returning workbench after loading but starts a new chat on Chat", async () => {
  let finish!: (response: Response) => void;
  stubFetch(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const page = await mount(h(Page, { agent: "support", initial: "demo/main" }));
  await run(() => finish(json(result)));
  expect(selected()).toBe("demo/main");
  await page.rerender(h(Page, { agent: "support", route: "new-chat" }));
  expect(selected()).toBe("chat");
  await click(button("Board"));
  expect(selected()).toBe("demo/main");
  await page.rerender(h(Page, { agent: null, route: "resolving" }));
  expect(document.querySelector("button")).toBeNull();
});
it("does not reopen a removed tab when it later reappears", async () => {
  const fetch = stubFetch(() => json(result));
  await mount(h(Page, { agent: "support", initial: "demo/main" }));
  const refresh = () =>
    window.dispatchEvent(
      new CustomEvent(WORKBENCH_UPDATED_EVENT, { detail: { projectId: "p", agentId: "support" } }),
    );
  fetch.answer(() => json({ workbenches: [] }));
  await run(refresh);
  expect(selected()).toBe("chat");
  fetch.answer(() => json(result));
  await run(refresh);
  expect(button("Board")).toBeTruthy();
  expect(selected()).toBe("chat");
});
