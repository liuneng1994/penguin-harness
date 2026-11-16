/** A Workbench iframe with theme, keyboard forwarding and version controls. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { WorkbenchInfo, WorkbenchVersion } from "@prismshadow/penguin-server/api";
import { Button, ConfirmModal, NoticeStrip } from "@prismshadow/penguin-ui";
import * as api from "../api/endpoints";
import { formatDateTime } from "./format";
import { useShortcutLabel } from "./shortcuts/use-keymap";
import { S } from "./strings";
import { toneInk } from "./tone";
import {
  forwardFrameKeys,
  PAGE_FRAME_SANDBOX,
  readDocumentTheme,
  themeWorkbenchFrame,
} from "./workbench-theme";
import {
  FILL_APP_MESSAGE,
  workbenchAppPath,
  workbenchUiUrl,
  type WorkbenchTab,
} from "./workbench-tabs";
import { useTheme } from "../state/theme";

const FRAME_REVEAL_TIMEOUT_MS = 4000;

export function WorkbenchFrame({
  projectId,
  agentId,
  tab,
  bare = false,
  context,
  onChanged,
  onRemoved,
}: {
  projectId: string;
  agentId: string;
  tab: WorkbenchTab;
  /** The page alone, no bar: the full-page route (its palette carries the actions). */
  bare?: boolean;
  /** Read-only page context supplied by the host, encoded in the frame URL. */
  context?: Record<string, string>;
  /** The workbench was reloaded or restored; the caller refetches the list. */
  onChanged: (workbench: WorkbenchInfo) => void;
  /** The workbench and its versions are gone; the caller drops the tab (the list refetch confirms). */
  onRemoved: () => void;
}) {
  const { dark, appliedTheme, accent, textSize, fontLatin, fontCjk } = useTheme();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [busy, setBusy] = useState<"reload" | "rollback" | "remove" | null>(null);
  // Removal is armed by a first click and sent by the second; the arm drops when the tab changes.
  const [removeArmed, setRemoveArmed] = useState(false);
  useEffect(() => setRemoveArmed(false), [tab.workbenchId]);
  const [failure, setFailure] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<WorkbenchVersion[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  /** A revision whose restore awaits confirmation: it replaces the workbench's files. */
  const [restoring, setRestoring] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      setVersions(
        (await api.getWorkbenchHistory(projectId, agentId, tab.workbenchId, tab.machineId))
          .versions,
      );
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId, agentId, tab.workbenchId, tab.machineId]);

  useEffect(() => {
    if (historyOpen) void loadHistory();
  }, [historyOpen, loadHistory, tab.revision]);

  const reload = async () => {
    setBusy("reload");
    setFailure(null);
    try {
      onChanged(
        (await api.reloadWorkbench(projectId, agentId, tab.workbenchId, tab.machineId)).workbench,
      );
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const rollback = async (revision: string) => {
    setBusy("rollback");
    setFailure(null);
    try {
      onChanged(
        (await api.rollbackWorkbench(projectId, agentId, tab.workbenchId, revision, tab.machineId))
          .workbench,
      );
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  // The page is a separate document: the app's dark class, theme, accent, fonts and root font
  // size stop at the frame, so they are copied in (lib/workbench-theme.ts) on load and on every appearance
  // change. Past the commit, because the provider that stamps them on the app's own document
  // is an ancestor and its effect runs after this one's.
  const applyTheme = useCallback(() => {
    themeWorkbenchFrame(frameRef.current, readDocumentTheme(document));
  }, []);
  useEffect(() => {
    const id = requestAnimationFrame(applyTheme);
    return () => cancelAnimationFrame(id);
  }, [applyTheme, dark, appliedTheme, accent, textSize, fontLatin, fontCjk, tab.uiRev]);

  // A page is its own document: until it has loaded and been themed it paints the browser's
  // white canvas, and then its own unstyled markup — a white flash in a dark app, on every
  // tab switch and every reload. So the frame stays invisible over the app's own background
  // until the theme is on it, and fades in. The timer is for a page that never fires `load`
  // (a hung subresource): it is shown anyway rather than hidden forever.
  const frameUrl = workbenchUiUrl(tab, context);
  const frameKey = `${tab.tabId}@${frameUrl}`;
  const [shownKey, setShownKey] = useState<string | null>(null);
  const detachKeys = useRef<() => void>(() => undefined);
  useEffect(() => () => detachKeys.current(), []);
  const onFrameLoad = useCallback(() => {
    applyTheme();
    // The page's keys reach the app too, so the palette still answers after focus moves
    // into the full-page workbench.
    detachKeys.current();
    detachKeys.current = forwardFrameKeys(frameRef.current);
    setShownKey(frameKey);
  }, [applyTheme, frameKey]);
  useEffect(() => {
    const id = setTimeout(() => setShownKey(frameKey), FRAME_REVEAL_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [frameKey]);

  const remove = async () => {
    setBusy("remove");
    setFailure(null);
    try {
      await api.removeWorkbench(projectId, agentId, tab.workbenchId, tab.machineId);
      onRemoved();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
      setBusy(null);
      setRemoveArmed(false);
    }
  };

  // Filling the app: the bar's button, or the page asking for it itself
  // (`parent.postMessage({ type: "penguin:fill-app" }, "*")`) — only from our own frame.
  const navigate = useNavigate();
  const location = useLocation();
  const paletteShortcut = useShortcutLabel("palette.toggle");
  const fillApp = useCallback(
    () =>
      void navigate(workbenchAppPath(projectId, agentId, tab.workbenchId, tab.key, tab.machineId), {
        state: { returnTo: location.pathname + location.search },
      }),
    [
      navigate,
      projectId,
      agentId,
      tab.workbenchId,
      tab.key,
      tab.machineId,
      location.pathname,
      location.search,
    ],
  );
  useEffect(() => {
    if (bare) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      if ((e.data as { type?: unknown } | null)?.type === FILL_APP_MESSAGE) fillApp();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [bare, fillApp]);

  const historyId = `workbench-history-${tab.workbenchId}`;
  return (
    // No fill of its own: the bar and the page sit on the surface the window shows through (the
    // chat column's canvas, a wallpaper), as the chat does.
    <div className="flex h-full min-h-0 flex-col">
      <div
        hidden={bare}
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-200 px-3 py-1.5 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400"
      >
        <span className="font-medium text-gray-800 dark:text-gray-200">{tab.name}</span>
        {tab.version !== null && <span>v{tab.version}</span>}
        <span className="font-mono">{tab.revision}</span>
        <span className="flex-1" />
        <Button
          variant="secondary"
          size="sm"
          title={S.workbenches.fillAppHint(paletteShortcut)}
          data-tooltip-extra
          onClick={fillApp}
        >
          {S.workbenches.fillApp}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy !== null}
          onClick={() => void reload()}
        >
          {busy === "reload" ? S.workbenches.reloading : S.workbenches.reload}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={historyOpen}
          aria-controls={historyId}
          onClick={() => setHistoryOpen((v) => !v)}
        >
          {S.workbenches.history}
        </Button>
        {removeArmed ? (
          <>
            <span className={toneInk.danger}>{S.workbenches.removeConfirm}</span>
            <Button
              variant="danger"
              size="sm"
              disabled={busy !== null}
              onClick={() => void remove()}
            >
              {busy === "remove" ? S.workbenches.removing : S.workbenches.removeYes}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => setRemoveArmed(false)}
            >
              {S.workbenches.removeNo}
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            onClick={() => setRemoveArmed(true)}
          >
            {S.workbenches.remove}
          </Button>
        )}
      </div>
      {tab.error !== null && !bare && (
        <NoticeStrip banner tone="danger" className="shrink-0 px-3 py-1.5 text-xs">
          {S.workbenches.loadError}: {tab.error}
        </NoticeStrip>
      )}
      {failure !== null && (
        <NoticeStrip banner tone="danger" className="shrink-0 px-3 py-1.5 text-xs">
          {failure}
        </NoticeStrip>
      )}
      <div
        id={historyId}
        hidden={!historyOpen || bare}
        className="max-h-64 shrink-0 overflow-y-auto border-b border-gray-200 dark:border-gray-800"
      >
        {historyError !== null ? (
          <div className="flex items-center gap-3 px-3 py-2 text-xs">
            <span role="alert" className="min-w-0 flex-1">
              {historyError}
            </span>
            <Button variant="secondary" size="sm" onClick={() => void loadHistory()}>
              {S.workbenches.retryHistory}
            </Button>
          </div>
        ) : versions === null ? (
          <p className="px-3 py-2 text-xs text-gray-500">{S.workbenches.loadingHistory}</p>
        ) : versions.length === 0 ? (
          <p className="px-3 py-2 text-xs text-gray-500">{S.workbenches.noHistory}</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {versions.map((v, i) => {
              // A restore records an old revision again: only its newest entry is the current one.
              const current = i === versions.findIndex((w) => w.revision === tab.revision);
              return (
                <li key={v.commit} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                  <span className="font-mono">{v.revision}</span>
                  <span className="text-gray-500">{formatDateTime(v.savedAt)}</span>
                  <span className="flex-1" />
                  {current ? (
                    <span className={toneInk.success}>{S.workbenches.current}</span>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => setRestoring(v.revision)}
                    >
                      {S.workbenches.restore}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <iframe
        key={frameKey}
        ref={frameRef}
        onLoad={onFrameLoad}
        title={tab.title}
        src={frameUrl}
        className={`min-h-0 flex-1 border-0 transition-opacity duration-150 motion-reduce:transition-none ${
          shownKey === frameKey ? "opacity-100" : "opacity-0"
        }`}
        sandbox={PAGE_FRAME_SANDBOX}
      />
      <ConfirmModal
        open={restoring !== null}
        title={S.workbenches.restoreTitle}
        onClose={() => setRestoring(null)}
        onConfirm={() => {
          if (restoring !== null) void rollback(restoring);
          setRestoring(null);
        }}
        confirmLabel={S.workbenches.restore}
        cancelLabel={S.common.cancel}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {restoring !== null ? S.workbenches.restoreConfirm(restoring) : ""}
        </p>
      </ConfirmModal>
    </div>
  );
}
