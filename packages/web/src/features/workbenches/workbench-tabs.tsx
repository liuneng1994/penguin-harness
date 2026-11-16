/** Workbench tab navigation; catalog and frame behavior live in shared libraries. */
import { NoticeStrip } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { localizedText } from "../../lib/skill-use";
import { useLocale } from "../../state/locale";
import type { WorkbenchTab, WorkbenchNotice } from "../../lib/workbench-tabs";
export { useWorkbenchTabs } from "../../lib/use-workbench-tabs";
export { WorkbenchFrame } from "../../lib/workbench-frame";

const TAB_BASE =
  "relative h-9 shrink-0 whitespace-nowrap border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-400";
const TAB_ACTIVE = "border-accent font-medium text-gray-900 dark:text-gray-100";
const TAB_IDLE =
  "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200";

export function WorkbenchTabStrip({
  tabs,
  notices = [],
  active,
  onSelect,
}: {
  tabs: readonly WorkbenchTab[];
  /** Workbenches with nothing to show but something to say; see workbenchNoticesOf. */
  notices?: readonly WorkbenchNotice[];
  active: string | null;
  onSelect: (tabId: string | null) => void;
}) {
  const { locale } = useLocale();
  if (tabs.length === 0 && notices.length === 0) return null;
  return (
    <>
      {notices.map((n) => (
        <NoticeStrip
          key={n.workbenchId}
          tone={n.error === null ? "neutral" : "attention"}
          role="status"
          className="shrink-0 truncate px-3 py-1 text-xs"
          data-tooltip={n.error ?? n.hints.join("\n")}
          data-tooltip-content="text"
          data-tooltip-extra={n.error === null && n.hints.length > 1}
        >
          <span className="font-mono">{n.workbenchId}</span>: {n.error ?? n.hints[0]}
        </NoticeStrip>
      ))}
      {tabs.length > 0 && (
        <div
          role="tablist"
          aria-label={S.workbenches.tabsLabel}
          className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-b border-gray-200 px-2 dark:border-gray-800"
        >
          <button
            type="button"
            role="tab"
            aria-selected={active === null}
            className={`${TAB_BASE} ${active === null ? TAB_ACTIVE : TAB_IDLE}`}
            onClick={() => onSelect(null)}
          >
            {S.workbenches.chatTab}
          </button>
          {tabs.map((t) => (
            <button
              key={t.tabId}
              type="button"
              role="tab"
              aria-selected={active === t.tabId}
              data-tooltip={t.error ?? undefined}
              data-tooltip-extra={t.error !== null}
              className={`${TAB_BASE} ${active === t.tabId ? TAB_ACTIVE : TAB_IDLE}`}
              onClick={() => onSelect(t.tabId)}
            >
              {localizedText(locale, t.title, t.titleZh)}
              {t.error !== null && (
                <span className={`ml-1.5 ${toneInk.danger}`} aria-label={S.workbenches.brokenMark}>
                  !
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
