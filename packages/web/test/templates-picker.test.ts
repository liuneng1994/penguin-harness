/** @vitest-environment jsdom */
/**
 * - Given account templates, the picker searches names/bodies, returns the chosen prompt and
 *   puts the last choice first on reopening, without writing account preferences.
 * - Given a non-empty search, Escape closes once and returns focus; IME Enter does not pick.
 * - Given a read failure, managing cannot create until Retry restores the saved list.
 * - Given a refused edit or delete, the draft/previous list remains available for recovery.
 * - Given an input becoming unavailable, its open picker closes and its trigger is disabled.
 * - Given an empty library, management can add templates and returns focus when closed.
 * - Given a deletion followed by an old refresh, the deleted template stays removed.
 */
import { createElement as h } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { TemplatesPicker } from "../src/features/chat/templates-picker";
import type { UserShortcut } from "../src/features/chat/user-shortcuts";
import { S } from "../src/lib/strings";
import { apiError, json, stubFetch } from "./helpers/fetch";
import {
  button,
  click,
  dialogs,
  field,
  hasButton,
  mount,
  pressEscape,
  run,
  type,
  unmountAll,
} from "./helpers/dom";

const templates: UserShortcut[] = [
  { id: "review", title: "Review", prompt: "Inspect the code" },
  { id: "summary", title: "Summary", prompt: "Summarize progress" },
];
const focusTarget = () => document.querySelector<HTMLTextAreaElement>("textarea");
const picker = (onPick = (_prompt: string) => {}, disabled = false) =>
  h(
    "div",
    null,
    h("textarea", { defaultValue: "Current draft" }),
    h(TemplatesPicker, {
      userId: "alice",
      disabled,
      onPick,
      onOpen: () => {},
      readComposerText: () => "Current draft",
      returnFocus: focusTarget,
    }),
  );
const rows = () => [
  ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button[aria-pressed]'),
];
const key = (value: string, composing = false) =>
  run(() =>
    field(S.chat.shortcuts.searchTemplates).dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
        isComposing: composing,
      }),
    ),
  );

afterEach(async () => {
  await unmountAll();
  localStorage.clear();
});

it("searches a prompt body and prioritizes the choice next time without saving preferences", async () => {
  const fetch = stubFetch(() => json({ prefs: { draftShortcuts: templates } }));
  const picked = vi.fn();
  await mount(picker(picked));
  expect(fetch.requests).toEqual([]);
  await click(button(S.chat.shortcuts.templates));
  expect(document.activeElement).toBe(field(S.chat.shortcuts.searchTemplates));
  await type(field(S.chat.shortcuts.searchTemplates), "no matching text");
  expect(rows()).toEqual([]);
  await type(field(S.chat.shortcuts.searchTemplates), "progress");
  await key("Enter");
  expect(picked).toHaveBeenCalledWith("Summarize progress");
  expect(hasButton(S.chat.shortcuts.manageTemplates)).toBe(false);
  await click(button(S.chat.shortcuts.templates));
  expect(rows().map((r) => r.textContent)).toEqual([
    expect.stringContaining("Summary"),
    expect.stringContaining("Review"),
  ]);
  expect(fetch.requests.every((r) => r.method === "GET")).toBe(true);
  await key("ArrowUp");
  await key("Enter");
  expect(picked).toHaveBeenLastCalledWith("Inspect the code");
  await click(button(S.chat.shortcuts.templates));
  await click(button(S.chat.shortcuts.templates));
  expect(hasButton(S.chat.shortcuts.manageTemplates)).toBe(false);
});

it("ignores an IME commit and closes a searched panel on one Escape with focus restored", async () => {
  stubFetch(() => json({ prefs: { draftShortcuts: templates } }));
  const picked = vi.fn();
  await mount(picker(picked));
  await click(button(S.chat.shortcuts.templates));
  await type(field(S.chat.shortcuts.searchTemplates), "Review");
  await key("Enter", true);
  expect(picked).not.toHaveBeenCalled();
  expect(hasButton(S.chat.shortcuts.manageTemplates)).toBe(true);
  await key("Escape", true);
  expect(hasButton(S.chat.shortcuts.manageTemplates)).toBe(true);
  await type(field(S.chat.shortcuts.searchTemplates), "Review");
  await key("Escape");
  await run(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(hasButton(S.chat.shortcuts.manageTemplates)).toBe(false);
  expect(document.activeElement).toBe(focusTarget());
});

it("requires a successful retry before creating and appends to the saved list", async () => {
  let saved = [...templates];
  const fetch = stubFetch(() => apiError(503, "unavailable"));
  await mount(picker());
  await click(button(S.chat.shortcuts.templates));
  await click(button(S.chat.shortcuts.manageTemplates));
  expect(hasButton(S.chat.shortcuts.new)).toBe(false);
  fetch.answer((r) => {
    if (r.method === "PUT") saved = (r.body as { draftShortcuts: UserShortcut[] }).draftShortcuts;
    return json({ prefs: { draftShortcuts: saved } });
  });
  await click(button(S.common.retry));
  await click(button(S.chat.shortcuts.new));
  await type(field(S.chat.shortcuts.titleLabel), "Another template");
  await click(button(S.common.save));
  expect(saved).toEqual([
    ...templates,
    expect.objectContaining({ title: "Another template", prompt: "Current draft" }),
  ]);
});

it("retains an edited draft and rolls back a refused optimistic delete", async () => {
  const fetch = stubFetch(() => json({ prefs: { draftShortcuts: templates } }));
  await mount(picker());
  await click(button(S.chat.shortcuts.templates));
  await click(button(S.chat.shortcuts.manageTemplates));
  await click(button(S.common.edit));
  await type(field(S.chat.shortcuts.promptLabel), "Changed prompt");
  fetch.answer(() => apiError(503, "unavailable"));
  await click(button(S.common.save));
  expect((field(S.chat.shortcuts.promptLabel) as HTMLTextAreaElement).value).toBe("Changed prompt");
  // Restore the original field so Cancel leaves a clean form without a discard prompt.
  await type(field(S.chat.shortcuts.promptLabel), "Inspect the code");
  await click(button(S.common.cancel));
  await click(button(S.common.delete));
  const confirm = dialogs().at(-1)!;
  await click(
    [...confirm.querySelectorAll("button")].find((b) => b.textContent === S.common.delete)!,
  );
  expect(document.querySelectorAll("li")).toHaveLength(2);
});

it("closes the picker when the input becomes unavailable", async () => {
  stubFetch(() => json({ prefs: { draftShortcuts: templates } }));
  const mounted = await mount(picker());
  await click(button(S.chat.shortcuts.templates));
  await mounted.rerender(picker(undefined, true));
  expect(button(S.chat.shortcuts.templates).disabled).toBe(true);
  expect(hasButton(S.chat.shortcuts.manageTemplates)).toBe(false);
});

it("offers management from an empty picker and restores focus when the manager closes", async () => {
  stubFetch(() => json({ prefs: { draftShortcuts: [] } }));
  await mount(picker());
  await click(button(S.chat.shortcuts.templates));
  expect(rows()).toEqual([]);
  await click(button(S.chat.shortcuts.manageTemplates));
  expect(hasButton(S.chat.shortcuts.new)).toBe(true);
  await pressEscape();
  await run(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(dialogs()).toEqual([]);
  expect(document.activeElement).toBe(focusTarget());
});

it.each(["success", "failure"])(
  "ignores a late refresh %s after a successful deletion",
  async (result) => {
    const fetch = stubFetch(() => json({ prefs: { draftShortcuts: templates } }));
    await mount(picker());
    await click(button(S.chat.shortcuts.templates));
    await click(button(S.chat.shortcuts.manageTemplates));
    let finishWrite!: (response: Response) => void;
    let finishRead!: (response: Response) => void;
    fetch.answer(
      (request) =>
        new Promise<Response>((resolve) => {
          if (request.method === "PUT") finishWrite = resolve;
          else finishRead = resolve;
        }),
    );
    await click(button(S.common.delete));
    const confirm = dialogs().at(-1)!;
    await click(
      [...confirm.querySelectorAll("button")].find((b) => b.textContent === S.common.delete)!,
    );
    await pressEscape();
    await click(button(S.chat.shortcuts.templates));
    await run(() => finishWrite(json({ prefs: { draftShortcuts: [templates[1]] } })));
    await run(() =>
      finishRead(
        result === "success"
          ? json({ prefs: { draftShortcuts: templates } })
          : apiError(503, "unavailable"),
      ),
    );
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining("Summary")]);
  },
);
