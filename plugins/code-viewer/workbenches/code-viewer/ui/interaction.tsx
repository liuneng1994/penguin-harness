import { createPortal } from "react-dom";
import { useRef } from "react";
import {
  Button,
  TemporaryConversationPanel,
  useTemporaryConversation,
} from "@prismshadow/penguin-ui";
import type { CodeAnchor, CodeSelection, PreviewEditor } from "./editor/editor.js";
import { askCodeQuestion } from "./questions.js";
import { en, zh } from "./strings.js";
const S = new URLSearchParams(location.search).get("locale") === "zh" ? zh : en;
async function copyAnswer(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

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
  const conversation = useTemporaryConversation<CodeSelection>({
    resetKey: `${session}:${path}:${version}:${gitScope ?? ""}`,
    historyLimitMessage: S.historyLimit,
    errorMessage: (error) => (error instanceof Error ? error.message : S.answerFailed),
    request: (chosen, question, signal, onText) =>
      askCodeQuestion(
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
          ...question,
        },
        signal,
        onText,
      ),
  });
  const pinned = conversation.source?.value;
  const sameSelection =
    pinned &&
    pinned.line === selection.line &&
    pinned.column === selection.column &&
    pinned.endLine === selection.endLine &&
    pinned.endColumn === selection.endColumn;
  const pinnedAnchor = useRef<CodeAnchor | null>(null);
  if (!pinned) pinnedAnchor.current = null;
  else if (sameSelection && anchor) pinnedAnchor.current = anchor;
  const show = () => {
    if (!anchor) return;
    const chosen = editor.selection();
    conversation.open({
      value: chosen,
      anchor,
      label: `${path}:${chosen.line}${chosen.endLine === chosen.line ? "" : `–${chosen.endLine}`}`,
      text: chosen.text,
      code: true,
      ...((!chosen.text.trim() && !hasChanges) || chosen.text.length > 24000
        ? { invalid: S.smallerSelection }
        : {}),
      reveal: () => editor.revealSelection(chosen),
      returnFocus: () => document.querySelector<HTMLElement>(".cm-content"),
      onOpen: () => editor.pinSelection(chosen),
      onClose: () => editor.pinSelection(null),
    });
  };
  return (
    <>
      {anchor &&
        !sameSelection &&
        createPortal(
          <Button
            size="sm"
            aria-label={S.ask}
            onMouseDown={(event) => event.preventDefault()}
            onClick={show}
            className="code-question-trigger"
            style={{ position: "fixed", left: anchor.triggerLeft, top: anchor.top }}
          >
            {S.ask}
          </Button>,
          document.body,
        )}
      <TemporaryConversationPanel
        conversation={conversation}
        anchor={pinnedAnchor.current}
        labels={{
          title: S.privateConversation,
          hint: S.privateHint,
          placeholder: S.askPlaceholder,
          followup: S.followup,
          send: S.sendQuestion,
          stop: S.stop,
          stopped: S.stopped,
          sending: S.sending,
          close: S.closeQuestions,
          copy: S.copyAnswer,
          copied: S.copied,
          clearedOnClose: S.clearedOnClose,
          expand: S.expandReading,
          restore: S.restorePopup,
        }}
        copy={copyAnswer}
      />
    </>
  );
}
