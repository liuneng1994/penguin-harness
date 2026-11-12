/** Reading positions live for this page's lifetime; reopening a Session reloads its history. */
import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import type { ChatItem } from "../../lib/amsp/stream-model";
import type { OlderHistoryControls } from "./message-stream";
import type { StreamFollow } from "./stream-follow";
import { stickToBottom } from "./stream-follow";

type Prompt = Extract<ChatItem, { kind: "user_text" | "user_image" }>;
interface ReadingPosition {
  following: boolean;
  scrollTop: number;
  anchor: { kind: Prompt["kind"]; atMs?: number; content: string; offset: number } | null;
}
const positions = new Map<string, ReadingPosition>();
const contentOf = (item: Prompt) => (item.kind === "user_text" ? item.text : item.imageUrl);
const isPrompt = (item: ChatItem): item is Prompt =>
  item.kind === "user_text" || item.kind === "user_image";
const metrics = (el: HTMLElement) => ({
  scrollTop: el.scrollTop,
  scrollHeight: el.scrollHeight,
  clientHeight: el.clientHeight,
});

/** Called before the stream's snap effects; pending restoration owns scrolling until its window arrives. */
export function useSessionScroll(
  sessionId: string | undefined,
  region: string,
  scrollRef: RefObject<HTMLDivElement | null>,
  follow: StreamFollow,
  items: ChatItem[],
) {
  const key = sessionId === undefined ? null : `${region}:${sessionId}`;
  const pending = useRef(key === null ? null : (positions.get(key) ?? null));
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (pending.current !== null && !pending.current.following) follow.wheel(-1);
    // Layout cleanup reads the outgoing DOM before React removes it. A passive cleanup would
    // find an empty container, and leaving during a history read must keep the original target.
    return () => {
      if (key === null || el === null || pending.current !== null) return;
      follow.observed(metrics(el));
      const top = el.getBoundingClientRect().top;
      let anchor: ReadingPosition["anchor"] = null;
      const prompts = new Map(
        itemsRef.current.filter(isPrompt).map((item) => [String(item.id), item]),
      );
      for (const node of el.querySelectorAll<HTMLElement>("[data-outline-anchor]")) {
        const item = prompts.get(node.dataset.outlineAnchor ?? "");
        if (item === undefined) continue;
        const offset = node.getBoundingClientRect().top - top;
        // Use the prompt immediately above the viewport, including when reading its long reply.
        if (offset > 0 && anchor !== null) break;
        anchor = { kind: item.kind, atMs: item.atMs, content: contentOf(item), offset };
        if (offset > 0) break;
      }
      positions.set(key, { following: follow.stick, scrollTop: el.scrollTop, anchor });
    };
  }, [key, follow, scrollRef]);

  return {
    pending: () => pending.current !== null,
    cancel: () => {
      pending.current = null;
    },
    /** Returns true when restoring owned this commit, so prepend compensation must skip it. */
    restore(el: HTMLDivElement, older: OlderHistoryControls | undefined): boolean {
      const saved = pending.current;
      if (saved === null) return false;
      if (saved.following) {
        follow.resume();
        stickToBottom(el, follow);
      } else {
        const a = saved.anchor;
        // Item ids are local to a history window and change on reload. Match the prompt's
        // original timestamp and content, then locate its CURRENT outline id in this DOM.
        const item =
          a === null
            ? undefined
            : items.find(
                (i) =>
                  isPrompt(i) &&
                  i.kind === a.kind &&
                  i.atMs === a.atMs &&
                  contentOf(i) === a.content,
              );
        const node =
          item === undefined
            ? null
            : el.querySelector<HTMLElement>(`[data-outline-anchor="${item.id}"]`);
        if (a !== null && node === null && older?.hasMore && older.error === null) {
          if (!older.loading) older.onLoad();
          return true;
        }
        el.scrollTop =
          a !== null && node !== null
            ? el.scrollTop +
              node.getBoundingClientRect().top -
              el.getBoundingClientRect().top -
              a.offset
            : saved.scrollTop;
        follow.scrolled(metrics(el));
        follow.wheel(-1); // Restoring near the bottom is still the reader's paused intent.
      }
      pending.current = null;
      return true;
    },
  };
}
