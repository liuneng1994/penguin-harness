/** @vitest-environment jsdom */
/**
 * - Given an unreadable saved list, creating a shortcut stays unavailable; retrying reads the
 *   existing shortcuts before a new one can be appended, preserving the stored entries.
 * - Given repeated read failures, retry remains available and no list is written.
 * - Given a pending read when the folder unmounts, its late answer cannot replace the list in
 *   a newly mounted folder, whether it succeeds or fails.
 */
import { createElement } from "react";
import { afterEach, expect, it } from "vitest";
import { ShortcutsFolder } from "../src/features/chat/shortcuts-folder";
import { S } from "../src/lib/strings";
import { apiError, json, stubFetch } from "./helpers/fetch";
import { button, click, field, hasButton, mount, run, type, unmountAll } from "./helpers/dom";

afterEach(unmountAll);

const folder = () =>
  createElement(ShortcutsFolder, {
    open: true,
    onOpen: () => undefined,
    readComposerText: () => "New prompt",
    onFill: () => undefined,
  });

it("does not create from a failed read and preserves saved shortcuts after retry", async () => {
  const saved = [{ id: "saved", title: "Saved shortcut", prompt: "Saved prompt" }];
  const fetch = stubFetch(() => apiError(503, "unavailable"));
  await mount(folder());
  expect(hasButton(S.chat.shortcuts.new)).toBe(false);
  expect(fetch.requests.filter((r) => r.method === "PUT")).toEqual([]);
  let answer!: (response: Response) => void;
  fetch.answer(
    () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
  );
  await click(button(S.common.retry));
  expect(hasButton(S.chat.shortcuts.new)).toBe(false);
  expect(hasButton(S.common.retry)).toBe(false);
  await run(() => answer(json({ prefs: { draftShortcuts: saved } })));
  fetch.answer(() => json({ prefs: {} }));
  expect(hasButton("Saved shortcut")).toBe(true);
  await click(button(S.chat.shortcuts.new));
  await type(field(S.chat.shortcuts.titleLabel), "New shortcut");
  await click(button(S.common.save));
  expect(fetch.requests.filter((r) => r.method === "PUT").map((r) => r.body)).toEqual([
    {
      draftShortcuts: [
        ...saved,
        expect.objectContaining({ title: "New shortcut", prompt: "New prompt" }),
      ],
    },
  ]);
  expect(hasButton("Saved shortcut")).toBe(true);
  expect(hasButton("New shortcut")).toBe(true);
});

it("keeps retry available after another read failure without writing an empty list", async () => {
  const fetch = stubFetch(() => apiError(503, "unavailable"));
  await mount(folder());
  await click(button(S.common.retry));
  expect(hasButton(S.common.retry)).toBe(true);
  expect(hasButton(S.chat.shortcuts.new)).toBe(false);
  expect(fetch.requests.map((r) => r.method)).toEqual(["GET", "GET"]);
});

it.each(["success", "failure"])("ignores a late %s after the folder unmounts", async (result) => {
  let answer!: (response: Response) => void;
  const fetch = stubFetch(
    () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
  );
  const old = await mount(folder());
  expect(hasButton(S.chat.shortcuts.new)).toBe(false);
  await old.unmount();
  fetch.answer(() =>
    json({
      prefs: { draftShortcuts: [{ id: "fresh", title: "Fresh shortcut", prompt: "Fresh prompt" }] },
    }),
  );
  await mount(folder());
  await run(() =>
    answer(
      result === "success" ? json({ prefs: { draftShortcuts: [] } }) : apiError(503, "unavailable"),
    ),
  );
  expect(hasButton("Fresh shortcut")).toBe(true);
  expect(hasButton(S.common.retry)).toBe(false);
});
