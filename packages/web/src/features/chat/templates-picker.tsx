/** A searchable template picker alongside the composer's attachment menu. */
import { useEffect, useState } from "react";
import {
  Button,
  Dropdown,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  MenuItem,
  Modal,
  PickerList,
  ToolbarTrigger,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { ShortcutsContent } from "./shortcuts-folder";
import { useShortcutsLibrary } from "./shortcuts-library";
import { findShortcuts, readShortcutRecents, rememberShortcut } from "./shortcut-recents";

export function TemplatesPicker({
  userId,
  disabled = false,
  onOpen,
  onPick,
  readComposerText,
  returnFocus,
}: {
  userId: string;
  disabled?: boolean;
  onOpen: () => void;
  onPick: (prompt: string) => void;
  readComposerText: () => string;
  returnFocus: () => HTMLTextAreaElement | null;
}) {
  const [panel, setPanel] = useState<"picker" | "manager" | null>(null);
  const open = panel === "picker";
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const library = useShortcutsLibrary(panel !== null);
  useEffect(() => {
    if (disabled && open) setPanel(null);
  }, [disabled, open]);
  const words = S.chat.shortcuts;
  const items = library.state === "ready" ? findShortcuts(library.shortcuts, query, recent) : [];
  const dismiss = () => {
    setPanel(null);
    requestAnimationFrame(() => returnFocus()?.focus());
  };
  return (
    <>
      <Dropdown
        open={open}
        setOpen={() => setPanel(null)}
        portal={{ direction: "up", align: "left" }}
        allowFlip={false}
        menuClass="w-[22rem] max-w-[calc(100vw-1rem)]"
        returnFocus={returnFocus}
        button={
          <ToolbarTrigger
            glyph={ICONS.zap}
            label={words.templates}
            caret
            ariaLabel={words.templates}
            disabled={disabled}
            ariaHaspopup="dialog"
            expanded={open}
            onClick={() => {
              if (!open) {
                onOpen();
                setQuery("");
                setRecent(readShortcutRecents(userId));
              }
              setPanel(open ? null : "picker");
            }}
          />
        }
      >
        <div role="dialog" aria-label={words.templates}>
          <PickerList
            items={items}
            itemKey={(s) => s.id}
            commitOnTab={false}
            query={query}
            onQueryChange={setQuery}
            onDismiss={dismiss}
            searchPlaceholder={words.searchTemplates}
            emptyText={
              library.state === "loading"
                ? S.common.loading
                : library.state === "failed"
                  ? words.loadFailed
                  : library.shortcuts.length === 0
                    ? words.noTemplates
                    : words.noMatches
            }
            onPick={(shortcut) => {
              rememberShortcut(userId, shortcut.id, library.shortcuts);
              setPanel(null);
              onPick(shortcut.prompt);
            }}
            renderRow={(shortcut) => (
              <>
                <GlyphIcon
                  d={ICONS.zap}
                  size={ICON_SIZE.rowLead}
                  className="shrink-0 text-fg-subtle"
                />
                <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                  <span className="max-w-full truncate">{shortcut.title}</span>
                  <span className="max-w-full truncate text-fg-muted">
                    {shortcut.prompt.replace(/\s+/g, " ")}
                  </span>
                </span>
              </>
            )}
            footer={
              <div className="mt-1 border-t border-line-muted pt-1">
                {library.state === "failed" && (
                  <Button size="sm" onClick={library.retry}>
                    {S.common.retry}
                  </Button>
                )}
                <MenuItem
                  density="sm"
                  glyph={ICONS.sliders}
                  label={words.manageTemplates}
                  onSelect={() => setPanel("manager")}
                />
              </div>
            }
          />
        </div>
      </Dropdown>
      {panel === "manager" && (
        <Modal open title={words.manageTemplates} widthClass="sm:max-w-lg" onClose={dismiss}>
          <ShortcutsContent library={library} readComposerText={readComposerText} />
        </Modal>
      )}
    </>
  );
}
