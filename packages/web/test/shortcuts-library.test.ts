/** @vitest-environment jsdom */
/**
 * - Given an unreadable list, a consumer cannot write an empty replacement while loading or
 *   after failure.
 * - Given a save in flight, another save sends no second replacement and the first result holds.
 */
import { createElement as h } from "react";
import { afterEach, expect, it } from "vitest";
import { useShortcutsLibrary } from "../src/features/chat/shortcuts-library";
import { apiError, json, stubFetch } from "./helpers/fetch";
import { button, click, mount, run, unmountAll } from "./helpers/dom";

const added = { id: "new", title: "New template", prompt: "New prompt" };
function Consumer() {
  const library = useShortcutsLibrary();
  return h(
    "div",
    null,
    h(
      "button",
      { onClick: () => void library.save([...library.shortcuts, added]) },
      "Save template",
    ),
    h("output", null, library.shortcuts.map((s) => s.title).join(", ")),
  );
}
afterEach(unmountAll);

it("does not write before the list is known or after the read fails", async () => {
  let answer!: (response: Response) => void;
  const fetch = stubFetch(
    () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
  );
  await mount(h(Consumer));
  await click(button("Save template"));
  await run(() => answer(apiError(503, "unavailable")));
  await click(button("Save template"));
  expect(fetch.requests.map((r) => r.method)).toEqual(["GET"]);
});

it("sends only one replacement while a save is pending", async () => {
  const original = { id: "saved", title: "Saved template", prompt: "Saved prompt" };
  const fetch = stubFetch(() => json({ prefs: { draftShortcuts: [original] } }));
  await mount(h(Consumer));
  let answer!: (response: Response) => void;
  fetch.answer(
    () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
  );
  await click(button("Save template"));
  await click(button("Save template"));
  expect(fetch.requests.filter((r) => r.method === "PUT").map((r) => r.body)).toEqual([
    { draftShortcuts: [original, added] },
  ]);
  await run(() => answer(json({ prefs: { draftShortcuts: [original, added] } })));
  expect(document.querySelector("output")?.textContent).toBe("Saved template, New template");
});
