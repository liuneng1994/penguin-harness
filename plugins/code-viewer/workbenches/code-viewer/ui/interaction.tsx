import { useEffect, useRef, useState } from "react";
import { Button, Fold, Md, NoticeStrip, Segmented, Textarea } from "@prismshadow/penguin-ui";
import type { CodeSelection } from "./editor/editor.js";
import { askCodeQuestion } from "./questions.js";
import { en, zh } from "./strings.js";
const S = new URLSearchParams(location.search).get("locale") === "zh" ? zh : en;
type Turn = { question: string; answer: string; prompt: string };

export function CodeInteraction({
  apiBase,
  session,
  path,
  selection,
  version,
}: {
  apiBase: string;
  session: string;
  path: string;
  selection: CodeSelection;
  version: string;
}) {
  const [mode, setMode] = useState<"modify" | "ask">("modify");
  const [drafts, setDrafts] = useState({ modify: "", ask: "" });
  const [busy, setBusy] = useState<"modify" | "ask" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [partial, setPartial] = useState("");
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<{
    id: string;
    resolve: (queued: boolean) => void;
    reject: (error: Error) => void;
  } | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        event.origin !== location.origin ||
        event.data?.type !== "penguin:code-modify-result" ||
        event.data.id !== pending.current?.id
      )
        return;
      const request = pending.current;
      pending.current = null;
      if (event.data.error) request?.reject(new Error(event.data.error));
      else request?.resolve(event.data.queued === true);
    };
    window.addEventListener("message", receive);
    return () => {
      mounted.current = false;
      controller.current?.abort();
      pending.current?.reject(new Error(S.closed));
      pending.current = null;
      window.removeEventListener("message", receive);
    };
  }, []);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [partial, turns]);
  const text = drafts[mode];
  const submit = async () => {
    if (busy || !text.trim() || !selection.text.trim()) return;
    setError(null);
    setSubmitted(null);
    setBusy(mode);
    try {
      if (mode === "modify") {
        const id = crypto.randomUUID();
        const queued = await new Promise<boolean>((resolve, reject) => {
          pending.current = { id, resolve, reject };
          window.parent.postMessage(
            { type: "penguin:code-modify", id, path, selection, comment: text },
            location.origin,
          );
        });
        if (!mounted.current) return;
        setSubmitted(queued ? S.queued : S.submitted);
      } else {
        const abort = new AbortController();
        controller.current = abort;
        setPartial("");
        const answer = await askCodeQuestion(
          `${apiBase}/sessions/${encodeURIComponent(session)}/code-questions`,
          {
            path,
            selection: {
              line: selection.line,
              column: selection.column,
              endLine: selection.endLine,
              endColumn: selection.endColumn,
            },
            version,
            question: text,
            history: turns.map((turn) => ({ question: turn.prompt, answer: turn.answer })),
          },
          abort.signal,
          (fragment) => {
            if (!abort.signal.aborted) setPartial((prev) => prev + fragment);
          },
        );
        if (!mounted.current || abort.signal.aborted) return;
        setTurns((prev) => [
          ...prev,
          { question: text, answer: answer.answer, prompt: answer.question },
        ]);
        setPartial("");
      }
      setDrafts((prev) => ({ ...prev, [mode]: "" }));
    } catch (err) {
      if (mounted.current && !(err instanceof Error && err.name === "AbortError"))
        setError(err instanceof Error ? err.message : S.answerFailed);
    } finally {
      if (mounted.current) setBusy(null);
      controller.current = null;
    }
  };
  return (
    <section
      className="code-interaction shrink-0 border-t border-line px-3 py-2"
      aria-label={S.interaction}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          cols={2}
          value={mode}
          onChange={setMode}
          options={[
            { value: "modify", label: S.modify },
            { value: "ask", label: S.ask },
          ]}
        />
        <span className="text-xs text-fg-muted">
          {S.selection(selection.line, selection.endLine)}
        </span>
      </div>
      <Fold open={mode === "ask"}>
        <p className="my-2 text-xs text-fg-muted">{S.privateHint}</p>
        {(turns.length > 0 || partial) && (
          <div
            ref={log}
            role="log"
            aria-label={S.privateConversation}
            className="code-questions overflow-y-auto"
          >
            {turns.map((turn, index) => (
              <div key={index} className="border-b border-line py-2">
                <p className="mb-2 whitespace-pre-wrap text-sm font-medium">{turn.question}</p>
                <Md text={turn.answer} />
              </div>
            ))}
            {partial && (
              <div className="py-2">
                <Md text={partial} streaming />
              </div>
            )}
          </div>
        )}
      </Fold>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="mt-2 flex items-end gap-2"
      >
        <div className="min-w-0 flex-1">
          <Textarea
            size="sm"
            rows={2}
            maxLength={5000}
            aria-label={mode === "modify" ? S.modifyPlaceholder : S.askPlaceholder}
            placeholder={mode === "modify" ? S.modifyPlaceholder : S.askPlaceholder}
            value={text}
            onChange={(event) => setDrafts((prev) => ({ ...prev, [mode]: event.target.value }))}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </div>
        <Button
          size="sm"
          type="submit"
          variant="primary"
          disabled={
            busy !== null || !text.trim() || !selection.text.trim() || selection.text.length > 24000
          }
        >
          {busy ? S.sending : mode === "modify" ? S.sendModification : S.sendQuestion}
        </Button>
      </form>
      {selection.text.length > 24000 && (
        <p className="mt-2 text-xs text-fg-muted">{S.smallerSelection}</p>
      )}
      {error && (
        <NoticeStrip tone="attention" role="alert" className="mt-2">
          {error}
        </NoticeStrip>
      )}
      {submitted && (
        <div
          role="status"
          className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted"
        >
          <span>{submitted}</span>
          <Button
            size="sm"
            onClick={() =>
              window.parent.postMessage({ type: "penguin:code-close" }, location.origin)
            }
          >
            {S.viewMain}
          </Button>
        </div>
      )}
      {mode === "ask" && (turns.length > 0 || busy === "ask") && (
        <div className="mt-2 flex justify-end gap-2">
          <Button
            size="sm"
            disabled={busy !== null}
            onClick={() => {
              setTurns([]);
              setPartial("");
            }}
          >
            {S.clearQuestions}
          </Button>
          {busy === "ask" && (
            <Button size="sm" onClick={() => controller.current?.abort()}>
              {S.stop}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
