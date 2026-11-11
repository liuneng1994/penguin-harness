import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Dropdown, Input, Md, NoticeStrip } from "@prismshadow/penguin-ui";
import type { CodeAnchor, CodeSelection, PreviewEditor } from "./editor/editor.js";
import { askCodeQuestion } from "./questions.js";
import { en, zh } from "./strings.js";
const S = new URLSearchParams(location.search).get("locale") === "zh" ? zh : en;
type Turn = { question: string; answer: string; prompt: string };

export function CodeInteraction({
  editor,
  anchor,
  apiBase,
  session,
  path,
  selection,
  version,
  gitScope,
  hasChanges = false,
}: {
  editor: PreviewEditor;
  anchor: CodeAnchor | null;
  apiBase: string;
  session: string;
  path: string;
  selection: CodeSelection;
  version: string;
  gitScope?: "working" | "staged";
  hasChanges?: boolean;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [partial, setPartial] = useState("");
  const [pinned, setPinned] = useState<CodeSelection | null>(null);
  const controller = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLDivElement>(null);
  useEffect(() => {
    return () => {
      const pending = controller.current;
      controller.current = null;
      pending?.abort();
    };
  }, []);
  useEffect(() => {
    if (!anchor) setOpen(false);
  }, [anchor]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      input.current?.querySelector("input")?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [partial, turns, open]);
  const show = () => {
    if (open) {
      setOpen(false);
      editor.focus();
      return;
    }
    setPinned(editor.selection());
    editor.revealSelection();
    setOpen(true);
  };
  const chosen = pinned ?? selection;
  const canSubmit =
    !!text.trim() && (!!chosen.text.trim() || hasChanges) && chosen.text.length <= 24000;
  const submit = async () => {
    if (busy || !canSubmit) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError(null);
    setPartial("");
    try {
      const answer = await askCodeQuestion(
        `${apiBase}/sessions/${encodeURIComponent(session)}/code-questions`,
        {
          path,
          selection: {
            line: chosen.line,
            column: chosen.column,
            endLine: chosen.endLine,
            endColumn: chosen.endColumn,
          },
          version,
          ...(gitScope ? { gitScope, gitVersion: version } : {}),
          question: text,
          history: turns.map((turn) => ({ question: turn.prompt, answer: turn.answer })),
        },
        abort.signal,
        (fragment) => {
          if (!abort.signal.aborted) setPartial((prev) => prev + fragment);
        },
      );
      if (abort.signal.aborted) return;
      setTurns((prev) => [
        ...prev,
        { question: text, answer: answer.answer, prompt: answer.question },
      ]);
      setPartial("");
      setText("");
    } catch (err) {
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : S.answerFailed);
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
  };
  if (!anchor) return null;
  return createPortal(
    <Dropdown
      open={open}
      setOpen={setOpen}
      onEscape={() => {
        setOpen(false);
        editor.focus();
      }}
      portal={{ direction: "down", align: "left" }}
      anchorRect={anchor}
      followAnchor
      allowFlip={false}
      focusOnOpen={false}
      menuClass="code-question-popup"
      menuStyle={{ width: "min(28rem, calc(100vw - 16px))" }}
      button={
        <Button
          size="sm"
          aria-label={S.ask}
          aria-expanded={open}
          onClick={show}
          className="code-question-trigger"
          style={{ position: "fixed", left: anchor.triggerLeft, top: anchor.top }}
          data-tooltip={`${S.selection(selection.line, selection.endLine)}: ${S.privateHint}`}
        >
          {S.sendQuestion}
        </Button>
      }
    >
      <section
        aria-label={S.privateConversation}
        className="code-floating-content"
        onKeyDown={(event) => {
          // Keep handled keys inside the iframe; Dropdown owns Escape order and focus.
          if (event.key === "Escape") event.preventDefault();
        }}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2">
          <span className="text-xs text-fg-muted">{S.selection(chosen.line, chosen.endLine)}</span>
          <Button
            size="sm"
            onClick={() => {
              setOpen(false);
              editor.focus();
            }}
          >
            {S.collapseQuestions}
          </Button>
        </div>
        <div
          ref={log}
          role="log"
          aria-label={S.privateConversation}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
        >
          {turns.map((turn, index) => (
            <div key={index} className="border-b border-line py-1">
              <p className="mb-1 whitespace-pre-wrap text-xs font-medium">{turn.question}</p>
              <Md text={turn.answer} />
            </div>
          ))}
          {partial && (
            <div className="py-1">
              <Md text={partial} streaming />
            </div>
          )}
          {busy && !partial && (
            <p role="status" className="text-xs text-fg-muted">
              {S.sending}
            </p>
          )}
          {!busy && turns.length === 0 && !partial && !error && (
            <p className="text-xs text-fg-muted">{S.privateHint}</p>
          )}
          {error && (
            <NoticeStrip tone="attention" role="alert">
              {error}
            </NoticeStrip>
          )}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2"
        >
          <div ref={input} className="min-w-0 flex-1">
            <Input
              size="sm"
              maxLength={5000}
              aria-label={S.askPlaceholder}
              placeholder={S.askPlaceholder}
              value={text}
              disabled={busy}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          {busy ? (
            <Button
              size="sm"
              onClick={(event) => {
                // This DOM button becomes a submit button as busy clears; consume the click.
                event.preventDefault();
                const pending = controller.current;
                controller.current = null;
                pending?.abort();
                setBusy(false);
              }}
            >
              {S.stop}
            </Button>
          ) : (
            <Button
              size="sm"
              type="submit"
              variant="primary"
              disabled={!canSubmit}
              data-tooltip={chosen.text.length > 24000 ? S.smallerSelection : undefined}
            >
              {S.sendQuestion}
            </Button>
          )}
          {turns.length > 0 && !busy && (
            <Button
              size="sm"
              onClick={() => {
                setTurns([]);
                setPartial("");
                setError(null);
              }}
            >
              {S.clearQuestions}
            </Button>
          )}
        </form>
      </section>
    </Dropdown>,
    document.body,
  );
}
