/** @vitest-environment jsdom */
/**
 * - Given a dialog opened from a picker's footer, Escape closes only that dialog and leaves
 *   the picker available. Its search still supports one-press dismissal afterwards.
 * - Given a picker using default keyboard selection, Tab chooses a match and Shift+Tab does not.
 */
import { createElement as h, useState } from "react";
import { Dropdown, Modal, PickerList } from "@prismshadow/penguin-ui";
import { afterEach, expect, it, vi } from "vitest";
import { button, click, field, mount, run, type, unmountAll } from "./helpers/dom";

function Host() {
  const [open, setOpen] = useState(true);
  const [nested, setNested] = useState(false);
  const [query, setQuery] = useState("");
  return h(Dropdown, {
    open,
    setOpen,
    button: h("button", null, "Picker"),
    portal: { direction: "up", align: "left" },
    children: h(PickerList<string>, {
      items: ["Template"],
      itemKey: (s) => s,
      query,
      onQueryChange: setQuery,
      searchPlaceholder: "Search templates",
      emptyText: "No templates",
      onPick: () => {},
      renderRow: (s) => s,
      onDismiss: () => setOpen(false),
      footer: h(
        "div",
        null,
        h("button", { onClick: () => setNested(true) }, "Open nested"),
        nested &&
          h(Modal, {
            open: true,
            title: "Nested dialog",
            onClose: () => setNested(false),
            children: h("button", null, "Nested action"),
          }),
      ),
    }),
  });
}
const key = (target: HTMLElement, value: string, shiftKey = false) =>
  run(() =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true }),
    ),
  );
afterEach(unmountAll);

it("does not dismiss the underlying picker when a nested dialog handles Escape", async () => {
  await mount(h(Host));
  await click(button("Open nested"));
  await key(button("Nested action"), "Escape");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const search = field("Search templates");
  expect(search).not.toBeNull();
  await type(search, "Template");
  await key(search, "Escape");
  expect(document.querySelector('input[aria-label="Search templates"]')).toBeNull();
});

it("keeps default Tab selection while Shift+Tab leaves the choice unchanged", async () => {
  const picked = vi.fn();
  await mount(
    h(PickerList<string>, {
      items: ["Template"],
      itemKey: (s) => s,
      query: "",
      onQueryChange: () => {},
      searchPlaceholder: "Search templates",
      emptyText: "No templates",
      onPick: picked,
      renderRow: (s) => s,
    }),
  );
  const search = field("Search templates");
  await key(search, "Tab", true);
  expect(picked).not.toHaveBeenCalled();
  await key(search, "Tab");
  expect(picked).toHaveBeenCalledWith("Template");
});
