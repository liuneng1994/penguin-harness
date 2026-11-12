/** Temporary questions stay in component memory and cancel when their source is dismissed. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnchorRect } from "../../overlays/portal-panel/context-menu";

export interface TemporaryConversationSource<T> {
  value: T;
  anchor: AnchorRect;
  label: string;
  text: string;
  code?: boolean;
  invalid?: string;
  reveal?: () => void;
  returnFocus?: () => HTMLElement | null;
  onOpen?: () => void;
  onClose?: () => void;
}
export interface TemporaryTurn {
  question: string;
  answer: string;
  /** The server can return the actual question supplied to the model. */
  prompt?: string;
  stopped?: boolean;
}
export interface TemporaryQuestion {
  question: string;
  history: Array<{ question: string; answer: string }>;
}
export interface TemporaryConversationOptions<T> {
  resetKey: unknown;
  request: (
    source: T,
    question: TemporaryQuestion,
    signal: AbortSignal,
    onText: (text: string) => void,
  ) => Promise<{ answer: string; question?: string }>;
  errorMessage: (error: unknown) => string;
  historyLimitMessage: string;
}

export function useTemporaryConversation<T>(options: TemporaryConversationOptions<T>) {
  const [source, setSource] = useState<TemporaryConversationSource<T> | null>(null);
  const [turns, setTurns] = useState<TemporaryTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [partial, setPartial] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readingMode, setReadingMode] = useState<"auto" | "compact" | "expanded">("auto");
  const sourceRef = useRef(source);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const request = useRef<{
    abort: AbortController;
    question: string;
    partial: string;
  } | null>(null);
  const close = useCallback(() => {
    request.current?.abort.abort();
    request.current = null;
    const previous = sourceRef.current;
    sourceRef.current = null;
    previous?.onClose?.();
    setSource(null);
    setTurns([]);
    setDraft("");
    setPartial("");
    setPendingQuestion("");
    setBusy(false);
    setError(null);
    setReadingMode("auto");
  }, []);
  useEffect(() => {
    close();
    return close;
  }, [options.resetKey, close]);
  const open = useCallback(
    (next: TemporaryConversationSource<T>) => {
      close();
      sourceRef.current = next;
      setSource(next);
      setError(next.invalid ?? null);
      next.onOpen?.();
    },
    [close],
  );
  const stop = () => {
    const pending = request.current;
    if (!pending) return;
    request.current = null;
    pending.abort.abort();
    if (pending.partial)
      setTurns((old) => [
        ...old,
        { question: pending.question, answer: pending.partial, stopped: true },
      ]);
    else setDraft(pending.question);
    setPartial("");
    setPendingQuestion("");
    setBusy(false);
  };
  const submit = async () => {
    const question = draft.trim();
    const target = sourceRef.current;
    if (!target || target.invalid || request.current || !question) return;
    const history = turns.map((turn) => ({
      question: turn.prompt ?? turn.question,
      answer: turn.answer,
    }));
    if (
      history.length >= 64 ||
      history.reduce((length, turn) => length + turn.question.length + turn.answer.length, 0) >
        100000
    ) {
      setError(optionsRef.current.historyLimitMessage);
      return;
    }
    const pending = { abort: new AbortController(), question, partial: "" };
    request.current = pending;
    setBusy(true);
    setError(null);
    setDraft("");
    setPartial("");
    setPendingQuestion(question);
    try {
      const result = await optionsRef.current.request(
        target.value,
        { question, history },
        pending.abort.signal,
        (fragment) => {
          if (request.current !== pending) return;
          pending.partial += fragment;
          setPartial(pending.partial);
        },
      );
      if (request.current !== pending) return;
      setTurns((old) => [
        ...old,
        {
          question,
          answer: result.answer,
          ...(result.question ? { prompt: result.question } : {}),
        },
      ]);
    } catch (cause) {
      if (request.current !== pending) return;
      setError(optionsRef.current.errorMessage(cause));
      setDraft(question);
    } finally {
      if (request.current === pending) {
        request.current = null;
        setPartial("");
        setPendingQuestion("");
        setBusy(false);
      }
    }
  };
  const expanded =
    readingMode === "expanded" ||
    (readingMode === "auto" &&
      (turns.length >= 2 || turns.reduce((length, turn) => length + turn.answer.length, 0) > 450));
  return {
    source,
    turns,
    draft,
    setDraft,
    partial,
    pendingQuestion,
    busy,
    error,
    expanded,
    setReadingMode,
    open,
    close,
    stop,
    submit,
  };
}
export type TemporaryConversation<T> = ReturnType<typeof useTemporaryConversation<T>>;
