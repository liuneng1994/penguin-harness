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
import { Button, CloseButton, Dropdown, Input, Md, NoticeStrip } from "@prismshadow/penguin-ui";
import type { AnchorRect } from "@prismshadow/penguin-ui";
import type { AssistantTextItem, ChatItem } from "../../lib/amsp/stream-model";
import type { TracePosition } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { ApiError } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { writeClipboard } from "../../lib/clipboard";
import { inEditable } from "../../lib/selection-copy";
import { selectionEndAnchor } from "../../lib/selection-menu";
import type { CapturedSelection } from "./stream-selection-menu";
import { askBtw, btwReplyPosition } from "./btw-request";
import "./btw-reading.css";

type Turn = { question: string; answer: string; stopped?: boolean };
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
  const [active, setActive] = useState<ReadingTarget | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const partialRef = useRef("");
  const questionRef = useRef("");
  const rangeRef = useRef<Range | undefined>(undefined);
  const returnRef = useRef<HTMLElement | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const field = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setActive(null);
    setCandidate(null);
    setTurns([]);
    setDraft("");
    setBusy(false);
    setPartial("");
    setPendingQuestion("");
    setError(null);
    setCopied(false);
    partialRef.current = "";
    questionRef.current = "";
    if (rangeRef.current) highlight();
    rangeRef.current = undefined;
  }, []);
  useEffect(() => {
    close();
    return close;
  }, [sessionId, close]);
  useEffect(() => {
    if (active) {
      const frame = requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
      return () => cancelAnimationFrame(frame);
    }
  }, [active]);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [partial, turns]);
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
      close();
      returnRef.current = target.element;
      setActive(target);
      rangeRef.current = target.range;
      highlight(target.range);
      window.getSelection()?.removeAllRanges();
      if (target.excerpt && target.excerpt.length > 24000) setError(S.chat.btw.smallerSelection);
    },
    [close],
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
                  left: rect.right - 420,
                  right: rect.right,
                },
                position: reply.tracePosition,
              });
            },
          },
    [sessionId, open],
  );
  const capture = () => {
    if (!sessionId) return;
    setCandidate(selectionTarget(itemsRef.current));
  };
  const stop = () => {
    controller.current?.abort();
    controller.current = null;
    if (partialRef.current)
      setTurns((old) => [
        ...old,
        { question: questionRef.current, answer: partialRef.current, stopped: true },
      ]);
    else setDraft(questionRef.current);
    partialRef.current = "";
    setPartial("");
    setPendingQuestion("");
    setBusy(false);
  };
  const submit = async () => {
    const question = draft.trim();
    if (!sessionId || !active || busy || !question || (active.excerpt?.length ?? 0) > 24000) return;
    if (
      turns.length >= 64 ||
      turns.reduce((n, turn) => n + turn.question.length + turn.answer.length, 0) > 100000
    ) {
      setError(S.chat.btw.historyLimit);
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError(null);
    setPartial("");
    setDraft("");
    setCopied(false);
    setPendingQuestion(question);
    partialRef.current = "";
    questionRef.current = question;
    try {
      const position = active.position ?? (await btwReplyPosition(sessionId, active.reply));
      if (abort.signal.aborted) return;
      active.position = position;
      const answer = await askBtw(
        sessionId,
        {
          position,
          question,
          ...(active.excerpt !== undefined ? { excerpt: active.excerpt } : {}),
          history: turns.map(({ question, answer }) => ({ question, answer })),
        },
        abort.signal,
        (text) => {
          if (abort.signal.aborted) return;
          partialRef.current += text;
          setPartial(partialRef.current);
        },
      );
      if (abort.signal.aborted) return;
      setTurns((old) => [...old, { question, answer }]);
      setPartial("");
      setPendingQuestion("");
      partialRef.current = "";
    } catch (cause) {
      if (!abort.signal.aborted) {
        setError(
          cause instanceof ApiError
            ? cause.code === "btw_reply_unavailable"
              ? S.chat.btw.sourceUnavailable
              : apiErrorText(cause)
            : cause instanceof Error
              ? cause.message
              : S.chat.btw.failed,
        );
        setDraft(question);
      }
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
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
      <Dropdown
        open={active !== null}
        setOpen={() => {}}
        onEscape={close}
        button={null}
        anchorRect={active?.anchor ?? null}
        portal={{ direction: "down", align: "left" }}
        followAnchor
        focusOnOpen={false}
        returnFocus={() => returnRef.current}
        menuClass="btw-reading-popup"
        menuStyle={{ width: "min(26rem, calc(100vw - 16px))" }}
      >
        {active && (
          <section aria-label={labels.title} className="btw-reading-panel">
            <header className="btw-reading-heading">
              <strong>btw</strong>
              <span>{labels.title}</span>
              <CloseButton label={labels.close} onClose={close} />
            </header>
            <div className="btw-reading-source">
              <Button
                variant="link"
                size="xs"
                disabled={!active.element.isConnected}
                onClick={() => {
                  active.element.scrollIntoView({ block: "center", behavior: "smooth" });
                  highlight(active.range);
                }}
              >
                {active.excerpt !== undefined ? labels.selected : labels.whole}
              </Button>
              <p>{(active.excerpt ?? active.reply.text).slice(0, 400)}</p>
            </div>
            <div ref={log} className="btw-reading-log" role="log" aria-label={labels.title}>
              {!turns.length && !pendingQuestion && (
                <p className="text-xs text-fg-muted">{labels.hint}</p>
              )}
              {turns.map((turn, index) => (
                <div className="btw-reading-turn" key={index}>
                  <p className="btw-reading-question">{turn.question}</p>
                  <Md text={turn.answer} />
                  {turn.stopped && <p className="text-xs text-fg-muted">{labels.stopped}</p>}
                </div>
              ))}
              {pendingQuestion && (
                <div className="btw-reading-turn">
                  <p className="btw-reading-question">{pendingQuestion}</p>
                  {partial ? (
                    <Md text={partial} streaming={busy} />
                  ) : busy ? (
                    <p role="status" className="text-xs text-fg-muted">
                      {labels.sending}
                    </p>
                  ) : null}
                </div>
              )}
              {error && (
                <NoticeStrip tone="attention" role="alert">
                  {error}
                </NoticeStrip>
              )}
            </div>
            <form
              className="btw-reading-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <Input
                ref={field}
                size="sm"
                aria-label={labels.title}
                placeholder={turns.length ? labels.followup : labels.placeholder}
                value={draft}
                maxLength={5000}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.nativeEvent.isComposing)
                    event.preventDefault();
                }}
                onChange={(event) => setDraft(event.target.value)}
                disabled={busy}
              />
              {busy ? (
                <Button size="sm" onClick={stop}>
                  {labels.stop}
                </Button>
              ) : (
                <Button
                  size="sm"
                  type="submit"
                  variant="primary"
                  disabled={!draft.trim() || (active.excerpt?.length ?? 0) > 24000}
                >
                  {labels.send}
                </Button>
              )}
            </form>
            <footer className="btw-reading-footer">
              <span>{labels.clearedOnClose}</span>
              {(turns.length > 0 || partial) && (
                <Button
                  size="xs"
                  variant="link"
                  onClick={() => {
                    void writeClipboard(partial || turns.at(-1)!.answer).then(
                      (ok) => ok && setCopied(true),
                    );
                  }}
                >
                  {copied ? S.common.copied : labels.copy}
                </Button>
              )}
            </footer>
          </section>
        )}
      </Dropdown>
    </>
  );
  return {
    actions,
    panel,
    open: active !== null,
    capture,
    fromSelection,
    canAskSelection: (selection: CapturedSelection) =>
      !!sessionId && selectionTarget(itemsRef.current, selection) !== null,
  };
}
