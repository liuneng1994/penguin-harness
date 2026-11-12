/** Capture one reply's selection and keep a temporary reading conversation in page memory. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  TemporaryConversationPanel,
  useTemporaryConversation,
} from "@prismshadow/penguin-ui";
import type { AnchorRect } from "@prismshadow/penguin-ui";
import type { AssistantTextItem, ChatItem } from "../../lib/amsp/stream-model";
import type { TracePosition } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { ApiError } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { inEditable } from "../../lib/selection-copy";
import { selectionEndAnchor } from "../../lib/selection-menu";
import type { CapturedSelection } from "./stream-selection-menu";
import { askBtw, btwReplyPosition } from "./btw-request";
import "./btw-reading.css";

interface ReadingTarget {
  reply: AssistantTextItem;
  element: HTMLElement;
  range?: Range;
  excerpt?: string;
  anchor: AnchorRect;
  position?: TracePosition;
}
interface BtwActions {
  whole: (reply: AssistantTextItem, element: HTMLElement) => void;
}
export const BtwActionsContext = createContext<BtwActions | null>(null);
export function useBtwActions() {
  return useContext(BtwActionsContext);
}

function replyElement(node: Node) {
  return (
    (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(
      "[data-btw-reply]",
    ) ?? null
  );
}
function selectionTarget(items: ChatItem[], captured?: CapturedSelection): ReadingTarget | null {
  const selection = window.getSelection();
  if (!captured && (!selection || selection.rangeCount !== 1 || selection.isCollapsed)) return null;
  const range = captured?.range ?? selection!.getRangeAt(0);
  const text = (captured?.text ?? selection!.toString()).trim();
  if (!text || inEditable(range.startContainer) || inEditable(range.endContainer)) return null;
  const element = replyElement(range.startContainer);
  if (!element || replyElement(range.endContainer) !== element) return null;
  const body = element.querySelector("[data-btw-body]");
  if (!body?.contains(range.startContainer) || !body.contains(range.endContainer)) return null;
  const reply = items.find(
    (item) => item.kind === "assistant_text" && String(item.id) === element.dataset.btwReply,
  );
  if (reply?.kind !== "assistant_text" || reply.streaming) return null;
  return {
    reply: { ...reply },
    element,
    excerpt: text,
    range: range.cloneRange(),
    position: reply.tracePosition,
    anchor: selectionEndAnchor(Array.from(range.getClientRects()), range.getBoundingClientRect()),
  };
}
const HIGHLIGHT = "penguin-btw-reading";
function highlight(range?: Range) {
  if (!globalThis.CSS?.highlights) return;
  CSS.highlights.delete(HIGHLIGHT);
  if (range && globalThis.Highlight) CSS.highlights.set(HIGHLIGHT, new Highlight(range));
}

export function useBtwReading(sessionId: string | undefined, items: ChatItem[]) {
  const [candidate, setCandidate] = useState<ReadingTarget | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const conversation = useTemporaryConversation<ReadingTarget>({
    resetKey: sessionId,
    historyLimitMessage: S.chat.btw.historyLimit,
    request: async (target, { question, history }, signal, onText) => {
      if (!sessionId) throw new Error(S.chat.btw.sourceUnavailable);
      const position = target.position ?? (await btwReplyPosition(sessionId, target.reply));
      signal.throwIfAborted();
      target.position = position;
      return {
        answer: await askBtw(
          sessionId,
          {
            position,
            question,
            ...(target.excerpt !== undefined ? { excerpt: target.excerpt } : {}),
            history,
          },
          signal,
          onText,
        ),
      };
    },
    errorMessage: (cause) =>
      cause instanceof ApiError
        ? cause.code === "btw_reply_unavailable"
          ? S.chat.btw.sourceUnavailable
          : apiErrorText(cause)
        : cause instanceof Error
          ? cause.message
          : S.chat.btw.failed,
  });
  useEffect(() => setCandidate(null), [sessionId]);
  useEffect(() => {
    if (!candidate) return;
    const hide = () => setCandidate(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [candidate]);
  const open = useCallback(
    (target: ReadingTarget) => {
      conversation.open({
        value: target,
        anchor: target.anchor,
        text: target.excerpt ?? target.reply.text,
        label: target.excerpt !== undefined ? S.chat.btw.selected : S.chat.btw.whole,
        ...(target.excerpt && target.excerpt.length > 24000
          ? { invalid: S.chat.btw.smallerSelection }
          : {}),
        returnFocus: () => target.element,
        reveal: () => {
          if (!target.element.isConnected) return;
          target.element.scrollIntoView({ block: "center", behavior: "smooth" });
          highlight(target.range);
        },
        onOpen: () => {
          setCandidate(null);
          highlight(target.range);
          window.getSelection()?.removeAllRanges();
        },
        onClose: () => {
          setCandidate(null);
          highlight();
        },
      });
    },
    [conversation.open],
  );
  const fromSelection = useCallback(
    (captured: CapturedSelection) => {
      if (!sessionId) return false;
      const target = selectionTarget(itemsRef.current, captured);
      if (!target) return false;
      open(target);
      return true;
    },
    [sessionId, open],
  );
  const actions = useMemo<BtwActions | null>(
    () =>
      !sessionId
        ? null
        : {
            whole: (reply, element) => {
              const selected = selectionTarget(itemsRef.current);
              if (selected?.reply.id === reply.id) return open(selected);
              const rect = element.getBoundingClientRect();
              open({
                reply: { ...reply },
                element,
                anchor: {
                  top: Math.max(8, rect.top),
                  bottom: Math.max(8, rect.top),
                  left: rect.right - 512,
                  right: rect.right,
                },
                position: reply.tracePosition,
              });
            },
          },
    [sessionId, open],
  );
  const capture = () => {
    if (sessionId) setCandidate(selectionTarget(itemsRef.current));
  };
  const labels = S.chat.btw;
  const panel: ReactNode = (
    <>
      {candidate &&
        createPortal(
          <Button
            size="sm"
            className="btw-selection-trigger"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => open(candidate)}
            style={{
              position: "fixed",
              left: Math.max(8, Math.min(window.innerWidth - 120, candidate.anchor.left - 100)),
              top: Math.max(8, Math.min(window.innerHeight - 42, candidate.anchor.bottom + 5)),
            }}
          >
            {labels.ask}
          </Button>,
          document.body,
        )}
      <TemporaryConversationPanel
        conversation={conversation}
        labels={{ ...labels, copied: S.common.copied }}
      />
    </>
  );
  return {
    actions,
    panel,
    open: conversation.source !== null,
    capture,
    fromSelection,
    canAskSelection: (selection: CapturedSelection) =>
      !!sessionId && selectionTarget(itemsRef.current, selection) !== null,
  };
}
