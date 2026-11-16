/** Recent template choices are browser-local and scoped to the signed-in account. */
import type { UserShortcut } from "./user-shortcuts";

const key = (userId: string) => `penguin.shortcutRecents.${userId}`;

export function readShortcutRecents(userId: string, storage?: Pick<Storage, "getItem">): string[] {
  try {
    const value: unknown = JSON.parse((storage ?? localStorage).getItem(key(userId)) ?? "null");
    return Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === "string"))]
      : [];
  } catch {
    return [];
  }
}

export function rememberShortcut(
  userId: string,
  id: string,
  shortcuts: readonly UserShortcut[],
): string[] {
  const valid = new Set(shortcuts.map((s) => s.id));
  const recent = [id, ...readShortcutRecents(userId).filter((old) => old !== id && valid.has(old))];
  try {
    localStorage.setItem(key(userId), JSON.stringify(recent));
  } catch {
    /* Selection still works when storage is unavailable. */
  }
  return recent;
}

export function findShortcuts(
  shortcuts: readonly UserShortcut[],
  query: string,
  recent: readonly string[],
): UserShortcut[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const ranks = new Map(recent.map((id, i) => [id, i]));
  return shortcuts
    .filter((s) => {
      const text = `${s.title}\n${s.prompt}`.toLocaleLowerCase();
      return words.every((word) => text.includes(word));
    })
    .toSorted((a, b) => (ranks.get(a.id) ?? recent.length) - (ranks.get(b.id) ?? recent.length));
}
