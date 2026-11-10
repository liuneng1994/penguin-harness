/** The code-preview Workbench receives a chat citation in the shared central dialog. */
import { useCallback } from "react";
import { codeModification } from "../../lib/code-modification";
import type { CodeModification } from "../../lib/code-modification";
import { Button, Modal } from "@prismshadow/penguin-ui";
import type { FileLocation } from "../../lib/file-location";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { WorkbenchFrame } from "../workbenches/workbench-tabs";

export function CodePreview({
  projectId,
  agentId,
  sessionId,
  location,
  tab,
  onClose,
  onOpenEditor,
  onChanged,
  onModify,
}: {
  projectId: string;
  agentId: string;
  sessionId: string;
  location: FileLocation;
  tab: WorkbenchTab;
  onClose: () => void;
  onOpenEditor: (location: FileLocation) => void;
  onChanged: () => void;
  onModify: (data: CodeModification) => Promise<{ queued?: boolean }>;
}) {
  const { locale } = useLocale();
  const receive = useCallback(
    (event: MessageEvent) => {
      const message = event.data;
      if (message?.type === "penguin:code-close") {
        onClose();
        return;
      }
      if (
        message?.type !== "penguin:code-modify" ||
        typeof message.id !== "string" ||
        message.id.length > 64
      )
        return;
      const data = codeModification(message);
      if (!data) return;
      const source = event.source as Window;
      void onModify(data)
        .then((result) =>
          source.postMessage(
            { type: "penguin:code-modify-result", id: message.id, queued: result.queued === true },
            event.origin,
          ),
        )
        .catch((error) =>
          source.postMessage(
            {
              type: "penguin:code-modify-result",
              id: message.id,
              error: error instanceof Error ? error.message : String(error),
            },
            event.origin,
          ),
        );
    },
    [onModify, onClose],
  );
  const context: Record<string, string> = { session: sessionId, path: location.path, locale };
  for (const key of ["line", "column", "endLine", "endColumn"] as const) {
    const n = location[key];
    if (n !== undefined) context[key] = String(n);
  }
  const title =
    location.path +
    (location.line === undefined
      ? ""
      : `:${location.line}${location.endLine === undefined ? "" : `–${location.endLine}`}`);
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      bare
      fullScreenOnPhone
      widthClass="sm:max-w-[80vw] sm:h-[70vh]"
      footer={
        <Button size="sm" onClick={() => onOpenEditor(location)}>
          {S.files.openInVSCode}
        </Button>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <WorkbenchFrame
          projectId={projectId}
          agentId={agentId}
          tab={tab}
          context={context}
          onMessage={receive}
          bare
          onChanged={onChanged}
          onRemoved={onClose}
        />
      </div>
    </Modal>
  );
}
