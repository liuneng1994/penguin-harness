/** The Agent's Workbench catalog and selection, shared by tabs and citation previews. */
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api/endpoints";
import { isSafeMode, useSafeMode } from "../rescue/safe-mode";
import {
  runningWorkbenches,
  settleActiveTab,
  WORKBENCH_UPDATED_EVENT,
  workbenchNoticesOf,
  workbenchTabsOf,
  type WorkbenchNotice,
  type WorkbenchTab,
  type WorkbenchUpdatedDetail,
} from "./workbench-tabs";

export function useWorkbenchTabs(
  projectId: string | null,
  agentId: string | null,
  machineId: string | null = null,
  selectionKey = "",
  initialTab: string | null = null,
) {
  const safe = useSafeMode();
  const scope = JSON.stringify([projectId, agentId, machineId]);
  const selectionScope = JSON.stringify([scope, selectionKey]);
  const [loaded, setLoaded] = useState<{
    scope: string;
    tabs: WorkbenchTab[];
    notices: WorkbenchNotice[];
  } | null>(null);
  const [selection, setSelection] = useState<{ scope: string; id: string | null } | null>(null);
  const availableTabs = loaded?.scope === scope ? loaded.tabs : [];
  // Code previews need a chat citation; keep their renderer available without a standalone tab.
  const codePreviewTab = availableTabs.find((tab) => tab.key === "code-preview");
  const tabs = availableTabs.filter((tab) => tab.key !== "code-preview");
  const notices = loaded?.scope === scope ? loaded.notices : [];
  const active = selection?.scope === selectionScope ? selection.id : initialTab;
  const setActiveRaw = useCallback(
    (id: string | null) => setSelection({ scope: selectionScope, id }),
    [selectionScope],
  );

  // Which Agent the newest request was for. A slow answer for the Agent just left must not
  // land on the one now open: the strip would show its tabs beside another Agent's chat, and
  // a Remove from there would address the wrong Agent's workbench.
  const asked = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++asked.current;
    if (safe || projectId === null || agentId === null) {
      setLoaded({ scope, tabs: [], notices: [] });
      return;
    }
    try {
      const res = await api.getWorkbenches(projectId, agentId, machineId);
      if (asked.current !== mine || isSafeMode()) return;
      // A switched-off workbench loads nothing: it offers no tab and has nothing to report.
      const running = runningWorkbenches(res);
      setLoaded({
        scope,
        tabs: workbenchTabsOf(running, machineId),
        notices: workbenchNoticesOf(running),
      });
    } catch {
      // The strip is a convenience over the chat: a failed list leaves it as it was.
    }
  }, [safe, projectId, agentId, machineId, scope]);

  useEffect(() => {
    void refresh();
    return () => {
      asked.current++;
    };
  }, [refresh]);

  useEffect(() => {
    const onUpdated = (e: Event) => {
      const d = (e as CustomEvent<WorkbenchUpdatedDetail>).detail;
      if (d.projectId === projectId && d.agentId === agentId) void refresh();
    };
    window.addEventListener(WORKBENCH_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(WORKBENCH_UPDATED_EVENT, onUpdated);
  }, [projectId, agentId, refresh]);

  const visibleTabs = safe ? [] : tabs;
  const visibleNotices = safe ? [] : notices;
  const settled = settleActiveTab(active, visibleTabs);
  // A tab that is gone is forgotten, not merely filtered: kept, the raw id would pull the
  // frame back over the chat the moment a workbench of the same id reappears — which is what
  // an Agent rewriting its folder (delete, then write) looks like from here.
  useEffect(() => {
    if (loaded?.scope === scope && active !== null && settled === null) setActiveRaw(null);
  }, [active, settled, loaded, scope, setActiveRaw]);
  const activeTab = settled === null ? null : (tabs.find((t) => t.tabId === settled) ?? null);
  return {
    tabs: visibleTabs,
    codePreviewTab: safe ? undefined : codePreviewTab,
    notices: visibleNotices,
    active: settled,
    activeTab,
    setActive: setActiveRaw,
    refresh,
  };
}
