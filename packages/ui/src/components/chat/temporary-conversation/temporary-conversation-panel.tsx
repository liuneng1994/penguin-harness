/** One reading popup for temporary questions; hosts supply their source and request adapter. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../actions/button/button";
import { CloseButton } from "../../actions/close-button/close-button";
import { CopiedStatus, useCopied } from "../../actions/copy-button/copy-button";
import { Prose } from "../../content/prose/prose";
import { Input } from "../../forms/input/input";
import { NoticeStrip } from "../../feedback/notice/notice-strip";
import { Dropdown } from "../../overlays/dropdown/dropdown";
import type { TemporaryConversation } from "./use-temporary-conversation";
import type { AnchorRect } from "../../overlays/portal-panel/context-menu";
import "./temporary-conversation.css";

export interface TemporaryConversationLabels {
  title: string;
  hint: string;
  placeholder: string;
  followup: string;
  send: string;
  stop: string;
  stopped: string;
  sending: string;
  close: string;
  copy: string;
  copied: string;
  clearedOnClose: string;
  expand: string;
  restore: string;
}

export function TemporaryConversationPanel<T>({
  conversation: c,
  labels,
  anchor,
}: {
  conversation: TemporaryConversation<T>;
  labels: TemporaryConversationLabels;
  /** Code hosts can follow a still-selected source as their editor scrolls. */
  anchor?: AnchorRect | null;
}) {
  const [viewport, setViewport] = useState({ width: 1024, height: 768 });
  const field = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const source = c.source;
  const sourceAnchor = anchor ?? source?.anchor;
  const answer = c.partial || c.turns.at(-1)?.answer || "";
  const copyTarget = c.partial ? c.pendingQuestion : c.turns.at(-1);
  const copyScope = useMemo(() => ({ source, copyTarget }), [source, copyTarget]);
  const { copied, flash } = useCopied(copyScope);
  useLayoutEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    followBottom.current = true;
  }, [source]);
  useEffect(() => {
    if (c.pendingQuestion) {
      followBottom.current = true;
    }
  }, [c.pendingQuestion]);
  useEffect(() => {
    if (log.current && followBottom.current) log.current.scrollTop = log.current.scrollHeight;
  }, [c.partial, c.turns, c.pendingQuestion]);
  useEffect(() => {
    if (!source || c.busy) return;
    const frame = requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [c.busy, source]);
  const mobile = viewport.width <= 640;
  const width = Math.min(c.expanded ? 768 : 512, viewport.width - 16);
  const height = mobile
    ? Math.min(c.expanded ? viewport.height * 0.85 : 448, viewport.height - 16)
    : c.expanded
      ? Math.min(760, viewport.height * 0.8, viewport.height - 16)
      : Math.min(
          448,
          viewport.height - 16,
          Math.max(240, viewport.height - (sourceAnchor?.bottom ?? 0) - 12),
        );
  const top = mobile
    ? viewport.height - height - 12
    : Math.max(8, Math.min(sourceAnchor?.bottom ?? 8, viewport.height - height - 12));
  const left = c.expanded
    ? Math.max(8, viewport.width - width - Math.max(16, (viewport.width - 1280) / 2))
    : Math.max(8, Math.min(sourceAnchor?.left ?? 8, viewport.width - width - 8));
  const close = () => {
    const target = source?.returnFocus?.();
    c.close();
    if (target?.isConnected) target.focus({ preventScroll: true });
  };
  return (
    <Dropdown
      open={source !== null}
      setOpen={() => {}}
      onEscape={close}
      button={null}
      anchorRect={{ top, bottom: top, left, right: left + width }}
      portal={{ direction: "down", align: "left" }}
      followAnchor
      allowFlip={false}
      focusOnOpen={false}
      returnFocus={source?.returnFocus}
      layoutMotion
      menuClass={`temporary-conversation-popup${c.expanded ? " temporary-conversation-expanded" : ""}`}
      menuStyle={{ width, height }}
    >
      {source && (
        <section
          aria-label={labels.title}
          className="temporary-conversation-panel"
          style={{ width, height }}
          onKeyDown={(event) => {
            // Dropdown closes its own Escape layer; iframe hosts must not forward that key.
            if (event.key === "Escape") event.preventDefault();
          }}
        >
          <header className="temporary-conversation-heading">
            <strong>btw</strong>
            <span>{labels.title}</span>
            <Button
              size="xs"
              variant="ghost"
              className="temporary-conversation-size"
              aria-expanded={c.expanded}
              onClick={() => c.setReadingMode(c.expanded ? "compact" : "expanded")}
            >
              {c.expanded ? labels.restore : labels.expand}
            </Button>
            <CloseButton label={labels.close} onClose={close} />
          </header>
          <div className={`temporary-conversation-source${source.code ? " code-source" : ""}`}>
            <Button variant="link" size="xs" onClick={source.reveal} disabled={!source.reveal}>
              <span className="truncate">{source.label}</span>
            </Button>
            <p>{source.text.slice(0, 400)}</p>
          </div>
          <div
            ref={log}
            className="temporary-conversation-log"
            role="log"
            aria-label={labels.title}
            onScroll={() => {
              const element = log.current!;
              followBottom.current =
                element.scrollHeight - element.scrollTop - element.clientHeight < 40;
            }}
          >
            {!c.turns.length && !c.pendingQuestion && (
              <p className="temporary-conversation-hint">{labels.hint}</p>
            )}
            {c.turns.map((turn, index) => (
              <div className="temporary-conversation-turn" key={index}>
                <p className="temporary-conversation-question">{turn.question}</p>
                <Prose text={turn.answer} />
                {turn.stopped && <p className="temporary-conversation-hint">{labels.stopped}</p>}
              </div>
            ))}
            {c.pendingQuestion && (
              <div className="temporary-conversation-turn">
                <p className="temporary-conversation-question">{c.pendingQuestion}</p>
                {c.partial ? (
                  <Prose text={c.partial} streaming={c.busy} />
                ) : (
                  <p role="status" className="temporary-conversation-hint">
                    {labels.sending}
                  </p>
                )}
              </div>
            )}
            {c.error && (
              <NoticeStrip tone="attention" role="alert">
                {c.error}
              </NoticeStrip>
            )}
          </div>
          <form
            className="temporary-conversation-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void c.submit();
            }}
          >
            <Input
              ref={field}
              size="sm"
              aria-label={labels.title}
              placeholder={c.turns.length ? labels.followup : labels.placeholder}
              value={c.draft}
              maxLength={5000}
              disabled={c.busy}
              onChange={(event) => c.setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
              }}
            />
            {c.busy ? (
              <Button
                size="sm"
                type="button"
                onClick={(event) => {
                  // Clearing busy reuses this DOM node as a submit button before its default action.
                  event.preventDefault();
                  c.stop();
                }}
              >
                {labels.stop}
              </Button>
            ) : (
              <Button
                size="sm"
                type="submit"
                variant="primary"
                disabled={!c.draft.trim() || !!source.invalid}
              >
                {labels.send}
              </Button>
            )}
          </form>
          <footer className="temporary-conversation-footer">
            <span>{labels.clearedOnClose}</span>
            {answer && (
              <Button size="xs" variant="link" onClick={() => flash(answer)}>
                {copied ? labels.copied : labels.copy}
              </Button>
            )}
            <CopiedStatus copied={copied} announcement={labels.copied} />
          </footer>
        </section>
      )}
    </Dropdown>
  );
}
