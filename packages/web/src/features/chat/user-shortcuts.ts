/**
 * Shortcuts are account data (`ui_prefs.draftShortcuts`), so saved prompts follow the user
 * across devices. They fill composer text and leave its Skills selection alone.
 * Field limits match server validation; the list has no item-count limit.
 */
import type { DraftShortcut } from "@prismshadow/penguin-server/api";
import { randomHex } from "../../lib/random-id";

/** A saved shortcut, as stored and as rendered. Re-exported from the API type so the two cannot drift. */
export type UserShortcut = DraftShortcut;

/** Longest title, in characters: what one folder row shows without truncating. */
export const SHORTCUT_TITLE_MAX = 40;
/** Longest prompt body, in characters: about three times the longest built-in example. */
export const SHORTCUT_PROMPT_MAX = 4000;

/**
 * A fresh shortcut id. Same generator as the parked-draft ids (draft-sessions.ts): random,
 * opaque, and never derived from the title — a rename must not change what an edit addresses.
 */
export function newShortcutId(): string {
  return `sc-${randomHex(12)}`;
}

/** One trimmed, length-capped string field read back out of free-form JSON; null when unusable. */
function readField(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.slice(0, maxLen);
}

/**
 * Reads the stored value back into a list the UI can render.
 *
 * The server validates what it accepts, so in practice this receives what it wrote — but the
 * column is free-form JSON shared with every other preference, and a value that has been through
 * a hand-edited database, a future cap change or an older client must still render rather than
 * throw. Unusable entries are dropped; over-long fields are truncated instead of dropped, because
 * a shortened prompt is recoverable and a vanished one is not.
 */
export function normalizeShortcuts(value: unknown): UserShortcut[] {
  if (!Array.isArray(value)) return [];
  const out: UserShortcut[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const raw = entry as Record<string, unknown>;
    const id = readField(raw.id, 64);
    const title = readField(raw.title, SHORTCUT_TITLE_MAX);
    const prompt = readField(raw.prompt, SHORTCUT_PROMPT_MAX);
    if (id === null || title === null || prompt === null || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title, prompt });
  }
  return out;
}

/** What the editor is holding: an `id` means it is editing that shortcut, null means a new one. */
export interface ShortcutDraft {
  id: string | null;
  title: string;
  prompt: string;
}

/** Which rule an editor draft breaks, as a dictionary key; null when it is saveable. */
export type ShortcutDraftError =
  "titleRequired" | "promptRequired" | "titleTooLong" | "promptTooLong";

/**
 * Validates an editor draft the way the server validates a write, so Save is refused here rather
 * than by a 400. The length rules look redundant against the fields' own `maxLength` — they are
 * not: `maxLength` bounds typing and pasting, not a value restored from a draft written under a
 * different cap, and the rule has to be stated where it can be tested.
 */
export function shortcutDraftError(draft: {
  title: string;
  prompt: string;
}): ShortcutDraftError | null {
  const title = draft.title.trim();
  const prompt = draft.prompt.trim();
  if (title === "") return "titleRequired";
  if (title.length > SHORTCUT_TITLE_MAX) return "titleTooLong";
  if (prompt === "") return "promptRequired";
  if (prompt.length > SHORTCUT_PROMPT_MAX) return "promptTooLong";
  return null;
}

/**
 * Saves an editor draft into the list and returns the new one.
 *
 * Order is insertion order and stays that way: a new shortcut is appended, and an edited one keeps
 * its position, so saving a title fix does not move the row out from under the cursor that is
 * about to click it. A draft whose id is no longer in the list (deleted in another tab while the
 * editor was open) is appended rather than dropped — the user typed it, so it lands somewhere.
 */
export function upsertShortcut(
  list: readonly UserShortcut[],
  draft: ShortcutDraft,
): UserShortcut[] {
  const saved: UserShortcut = {
    id: draft.id ?? newShortcutId(),
    title: draft.title.trim(),
    prompt: draft.prompt.trim(),
  };
  const at = list.findIndex((s) => s.id === saved.id);
  if (at !== -1) return list.map((s, i) => (i === at ? saved : s));
  return [...list, saved];
}

/** Removes one shortcut by id, closing the gap. An unknown id leaves the list as it was. */
export function removeShortcut(list: readonly UserShortcut[], id: string): UserShortcut[] {
  return list.filter((s) => s.id !== id);
}

/**
 * The title a new shortcut opens with, derived from the prompt it is being saved from: the first
 * line that has anything on it, with runs of whitespace collapsed, cut to the title cap. A
 * suggestion only — the editor puts it in an editable field, and an empty prompt suggests nothing.
 */
export function defaultShortcutTitle(prompt: string): string {
  const line = prompt.split("\n").find((l) => l.trim() !== "");
  if (line === undefined) return "";
  return line.trim().replace(/\s+/g, " ").slice(0, SHORTCUT_TITLE_MAX);
}
