/** A citation opens the Agent's code-viewer Workbench, falling back to its configured editor. */
import { useCallback, useEffect, useState } from "react";
import type { FileLocation } from "../../lib/file-location";
import { machineForSession } from "../../lib/session-machines";
import { useWorkbenchTabs } from "../workbenches";
import { CodePreview } from "./code-preview";
import { useFileEditor } from "./use-file-editor";

export function useCodePreview(projectId: string | null, agentId: string | null, sessionId: string | null) {
  const [location, setLocation] = useState<FileLocation | null>(null);
  const workbenches = useWorkbenchTabs(projectId, agentId, sessionId ? machineForSession(sessionId) : null);
  const tab = workbenches.codePreviewTab;
  const openVSCode = useFileEditor(sessionId);
  useEffect(() => setLocation(null), [sessionId]);
  const openEditorFile = useCallback((next: FileLocation) => {
    if (tab && sessionId) setLocation(next);
    else openVSCode(next);
  }, [tab, sessionId, openVSCode]);
  return {
    openEditorFile,
    codePreviewDialog: location && tab && projectId && agentId && sessionId ? (
      <CodePreview projectId={projectId} agentId={agentId} sessionId={sessionId} location={location}
        tab={tab} onClose={() => setLocation(null)} onOpenEditor={openVSCode}
        onChanged={() => void workbenches.refresh()} />
    ) : null,
  };
}
