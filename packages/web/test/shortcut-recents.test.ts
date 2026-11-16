/**
 * - Given many templates, searches match names and bodies without discarding later entries.
 * - Given successive choices, recently used templates come first and deleted IDs are forgotten.
 * - Given another account or unreadable storage, its choices do not change the visible order.
 */
import { expect, it } from "vitest";
import {
  findShortcuts,
  readShortcutRecents,
  rememberShortcut,
} from "../src/features/chat/shortcut-recents";
import { blockedStorage, memoryStorage, stubLocalStorage } from "./helpers/storage";

const templates = [
  { id: "review", title: "Review", prompt: "Inspect the code" },
  { id: "summary", title: "Summary", prompt: "Summarize the current progress" },
];

it("finds templates by name and body while retaining a long list", () => {
  const many = [
    ...templates,
    ...Array.from({ length: 100 }, (_, i) => ({
      id: `t-${i}`,
      title: `Template ${i}`,
      prompt: `Body ${i}`,
    })),
  ];
  expect(findShortcuts(many, "", [])).toEqual(many);
  expect(findShortcuts(many, " REVIEW code ", [])).toEqual([templates[0]]);
  expect(findShortcuts(many, "body 99", [])).toEqual([many.at(-1)]);
  expect(findShortcuts(many, "missing", [])).toEqual([]);
});

it("prioritizes the last choice, prunes removed templates and isolates accounts", () => {
  stubLocalStorage();
  rememberShortcut("alice", "review", templates);
  rememberShortcut("alice", "summary", templates);
  const recent = readShortcutRecents("alice");
  expect(findShortcuts(templates, "", recent)).toEqual([templates[1], templates[0]]);
  expect(readShortcutRecents("bob")).toEqual([]);
  rememberShortcut("alice", "summary", [templates[1]!]);
  expect(readShortcutRecents("alice")).toEqual(["summary"]);
});

it("keeps template selection usable when storage is blocked", () => {
  stubLocalStorage(blockedStorage());
  expect(() => rememberShortcut("alice", "summary", templates)).not.toThrow();
  expect(readShortcutRecents("alice")).toEqual([]);
});

it.each(["not json", "{}", '["summary",null,"summary",12]'])(
  "tolerates unreadable recent choices: %s",
  (raw) => {
    const storage = memoryStorage({ "penguin.shortcutRecents.alice": raw });
    const recent = readShortcutRecents("alice", storage);
    expect(findShortcuts(templates, "", recent)).toEqual(
      raw.startsWith("[") ? [templates[1], templates[0]] : templates,
    );
  },
);
