// @vitest-environment jsdom
/**
 * - Given two Sessions read at different heights, switching between them restores each one;
 *   new content below a restored historical view must not pull it down.
 * - Given a Session left following the bottom, reopening it follows its newer content.
 * - Given the reader paused just above the bottom, restoration keeps that paused intent.
 * - Given a saved prompt outside the initial window, older windows are loaded until it arrives;
 *   changing window-local item ids and prepending must not displace the restored prompt.
 * - Given an older-window failure or a removed prompt, restoration releases the view for scrolling.
 * - Given a Session left before restoration finishes, reopening still seeks the original prompt.
 * - Given wheel input during restoration, the reader takes control and backfill stops.
 * - Given a scrollbar, outline or keyboard scroll during restoration, that new position wins.
 * - Given Jump to latest pressed before history arrives, the view follows the bottom instead.
 * - Given a stream without a Session or prompt anchors, remounting remains usable.
 */
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageStream } from "../src/features/chat/message-stream";
import type { OlderHistoryControls } from "../src/features/chat/message-stream";
import type { ChatItem } from "../src/lib/amsp/stream-model";
import { button, click, mount, unmountAll } from "./helpers/dom";
import { LocaleProvider } from "../src/state/locale";
import { S } from "../src/lib/strings";

let extraHeight = 0;
let serial = 0;
let imagePrompts = false;
const tops = new WeakMap<Element, number>();
const scrollDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!;
const scroller = () => document.querySelector<HTMLDivElement>('[data-find-region="conversation"]')!;
const rect = (top: number) => ({
  top,
  bottom: top + 100,
  left: 0,
  right: 100,
  width: 100,
  height: 100,
  x: 0,
  y: top,
  toJSON: () => ({}),
});

beforeEach(() => {
  extraHeight = 0;
  imagePrompts = false;
  serial += 1;
  // jsdom has no layout: give the browser boundary 600px turns and a clamped viewport.
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
    return this.querySelectorAll("[data-outline-anchor]").length * 600 + extraHeight;
  });
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(400);
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get(this: Element) {
      return tops.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      tops.set(this, Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)));
    },
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this.closest('[data-find-region="conversation"]');
    if (el && this.hasAttribute("data-outline-anchor")) {
      return rect(
        [...el.querySelectorAll("[data-outline-anchor]")].indexOf(this) * 600 - el.scrollTop,
      );
    }
    return rect(0);
  });
});
afterEach(async () => {
  await unmountAll();
  vi.restoreAllMocks();
  Object.defineProperty(Element.prototype, "scrollTop", scrollDescriptor);
});

function view(
  name: string | undefined,
  start = 1,
  end = 6,
  older?: OlderHistoryControls,
  idBase = 0,
) {
  const items: ChatItem[] = [];
  for (let n = start; n <= end; n++) {
    items.push(
      imagePrompts
        ? {
            kind: "user_image",
            id: idBase + n * 2,
            imageUrl: `https://example.com/image-${n}.png`,
            atMs: n * 1000,
          }
        : { kind: "user_text", id: idBase + n * 2, text: `Prompt ${n}`, atMs: n * 1000 },
    );
    items.push({
      kind: "assistant_text",
      id: idBase + n * 2 + 1,
      text: `Reply ${n}`,
      streaming: false,
    });
  }
  return createElement(
    LocaleProvider,
    null,
    createElement(MessageStream, {
      key: name,
      sessionId: name === undefined ? undefined : `${serial}:${name}`,
      items,
      version: extraHeight + idBase + start + end,
      ctx: {
        pendingApprovals: new Map(),
        onApprove: async () => {},
        origin: [],
        taskRunning: false,
      },
      onAddExcerpt: () => {},
      older,
    }),
  );
}
async function scroll(top: number) {
  await act(async () => {
    scroller().scrollTop = top;
    scroller().dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}
const older = (over: Partial<OlderHistoryControls> = {}): OlderHistoryControls => ({
  hasMore: true,
  loading: false,
  error: null,
  prependedCount: 0,
  onLoad: vi.fn(),
  ...over,
});

it.each(["text", "image"])(
  "switching Sessions restores independent %s prompt positions and keeps history still while replies grow",
  async (kind) => {
    imagePrompts = kind === "image";
    const page = await mount(view("A"));
    await scroll(650);
    await page.rerender(view("B"));
    await scroll(1250);
    await page.rerender(view("A", 1, 6, undefined, 100));
    expect(scroller().scrollTop).toBe(650);
    extraHeight = 500;
    await page.rerender(view("A", 1, 6, undefined, 100));
    expect(scroller().scrollTop).toBe(650);
    await page.rerender(view("B"));
    expect(scroller().scrollTop).toBe(1250);
  },
);

it("a reader paused just above the bottom stays paused after restoration", async () => {
  const page = await mount(view("A"));
  await scroll(3170);
  await page.rerender(view("B"));
  await page.rerender(view("A"));
  expect(scroller().scrollTop).toBe(3170);
  extraHeight = 700;
  await page.rerender(view("A"));
  expect(scroller().scrollTop).toBe(3170);
});

it("a Session left at the bottom follows content that arrived while it was away", async () => {
  const page = await mount(view("A"));
  expect(scroller().scrollTop).toBe(3200);
  await page.rerender(view("B"));
  extraHeight = 700;
  await page.rerender(view("A"));
  expect(scroller().scrollTop).toBe(3900);
  extraHeight = 900;
  await page.rerender(view("A"));
  expect(scroller().scrollTop).toBe(4100);
});

it("older windows restore the original prompt despite new item ids and prepend growth", async () => {
  const page = await mount(view("A"));
  await scroll(650);
  await page.rerender(view("B"));
  const onLoad = vi.fn();
  await page.rerender(view("A", 5, 6, older({ onLoad })));
  expect(onLoad).toHaveBeenCalledOnce();
  await page.rerender(view("A", 5, 6, older({ onLoad, loading: true })));
  expect(onLoad).toHaveBeenCalledOnce();
  await page.rerender(view("A", 3, 6, older({ onLoad, prependedCount: 4 }), -100));
  expect(onLoad).toHaveBeenCalledTimes(2);
  await page.rerender(view("A", 1, 6, older({ onLoad, hasMore: false, prependedCount: 8 }), -200));
  expect(scroller().scrollTop).toBe(650);
});

it.each(["failed", "removed"])(
  "a %s older prompt releases restoration and permits scrolling",
  async (state) => {
    const page = await mount(view("A"));
    await scroll(650);
    await page.rerender(view("B"));
    const controls = older(state === "failed" ? { error: "offline" } : { hasMore: false });
    await page.rerender(view("A", 4, 6, controls));
    await scroll(800);
    extraHeight = 500;
    await page.rerender(view("A", 4, 6, controls));
    expect(scroller().scrollTop).toBe(800);
    expect(controls.onLoad).not.toHaveBeenCalled();
  },
);

it("leaving during restoration preserves the original target for the next visit", async () => {
  const page = await mount(view("A"));
  await scroll(650);
  await page.rerender(view("B"));
  await page.rerender(view("A", 4, 6, older({ loading: true })));
  await page.rerender(view("B"));
  await page.rerender(view("A", 1, 6));
  expect(scroller().scrollTop).toBe(650);
});

it("wheel input takes control during restoration and stops seeking older windows", async () => {
  const page = await mount(view("A"));
  await scroll(650);
  await page.rerender(view("B"));
  await page.rerender(view("A", 4, 6, older({ loading: true })));
  await act(async () => {
    scroller().dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
  });
  await scroll(500);
  const onLoad = vi.fn();
  await page.rerender(view("A", 4, 6, older({ onLoad })));
  expect(onLoad).not.toHaveBeenCalled();
  expect(scroller().scrollTop).toBe(500);
});

it("a direct scroll during restoration takes control and stops seeking the old prompt", async () => {
  const page = await mount(view("A"));
  await scroll(650);
  await page.rerender(view("B"));
  await page.rerender(view("A", 4, 6, older({ loading: true })));
  await scroll(500);
  const onLoad = vi.fn();
  await page.rerender(view("A", 4, 6, older({ onLoad })));
  expect(onLoad).not.toHaveBeenCalled();
  expect(scroller().scrollTop).toBe(500);
  await page.rerender(view("B"));
  await page.rerender(view("A", 4, 6));
  expect(scroller().scrollTop).toBe(500);
});

it("Jump to latest cancels restoration before its scroll event and follows arriving history", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const page = await mount(view("A"));
  await scroll(650);
  await page.rerender(view("B"));
  await page.rerender(view("A", 4, 6, older({ loading: true })));
  await click(button(S.chat.jumpToLatest));
  await page.rerender(view("A", 1, 6, older({ hasMore: false, prependedCount: 6 }), -100));
  expect(scroller().scrollTop).toBe(3200);
});

it("streams without a Session or prompt anchors can still be remounted", async () => {
  const page = await mount(view(undefined));
  await scroll(650);
  await page.rerender(view("B"));
  await page.rerender(view(undefined));
  expect(scroller().scrollTop).toBe(3200);
  extraHeight = 3000;
  await page.rerender(view("no-prompts", 1, 0));
  await scroll(500);
  await page.rerender(view("B"));
  await page.rerender(view("no-prompts", 1, 0));
  expect(scroller().scrollTop).toBe(500);
});
