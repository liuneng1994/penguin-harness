/** Account shortcuts share their editor and actions with the composer's template manager. */
import { useState } from "react";
import {
  Button,
  ConfirmModal,
  GlyphIcon,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  Input,
  Modal,
  PlusIcon,
  Textarea,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import {
  ExampleFolderRow,
  ExampleRowGlyph,
  ExampleRowGo,
  examplePanelClass,
  exampleRowClass,
} from "./example-folder-row";
import {
  SHORTCUT_PROMPT_MAX,
  SHORTCUT_TITLE_MAX,
  defaultShortcutTitle,
  removeShortcut,
  shortcutDraftError,
  upsertShortcut,
} from "./user-shortcuts";
import type { ShortcutDraft, UserShortcut } from "./user-shortcuts";
import { useShortcutsLibrary } from "./shortcuts-library";
import type { ShortcutsLibrary } from "./shortcuts-library";

export const SHORTCUTS_FOLDER_ID = "shortcuts";
const SHORTCUTS_GLYPH = ICONS.zap;

function RowAction({
  label,
  glyph,
  danger = false,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  danger?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-tooltip={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors duration-150 disabled:opacity-50 ${danger ? "hover:text-tone-danger-fg" : "hover:text-fg"}`}
    >
      <GlyphIcon d={glyph} size={ICON_SIZE.rowLead} />
    </button>
  );
}

export function ShortcutsFolder({
  open,
  onOpen,
  readComposerText,
  onFill,
}: {
  open: boolean;
  onOpen: () => void;
  readComposerText: () => string;
  onFill: (prompt: string) => void;
}) {
  const library = useShortcutsLibrary();
  return (
    <>
      <ExampleFolderRow
        open={open}
        glyph={SHORTCUTS_GLYPH}
        label={S.chat.shortcuts.folder}
        count={library.shortcuts.length}
        onOpen={onOpen}
      />
      {open && (
        <div className={examplePanelClass}>
          <ShortcutsContent library={library} readComposerText={readComposerText} onFill={onFill} />
        </div>
      )}
    </>
  );
}

/** Saved rows and create/edit/delete dialogs, used in the folder and template manager. */
export function ShortcutsContent({
  library,
  readComposerText,
  onFill,
}: {
  library: ShortcutsLibrary;
  readComposerText: () => string;
  onFill?: (prompt: string) => void;
}) {
  const { shortcuts, state, saving } = library;
  const [draft, setDraft] = useState<ShortcutDraft | null>(null);
  const [deleting, setDeleting] = useState<UserShortcut | null>(null);
  const startCreate = () => {
    const text = readComposerText().trim();
    setDraft({ id: null, title: defaultShortcutTitle(text), prompt: text });
  };
  const saveDraft = async (next: ShortcutDraft): Promise<boolean> => {
    if (!(await library.save(upsertShortcut(shortcuts, next)))) return false;
    setDraft(null);
    return true;
  };
  return (
    <>
      {state === "failed" && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span role="alert" className="text-xs text-tone-danger-fg">
            {S.chat.shortcuts.loadFailed}
          </span>
          <Button size="sm" onClick={library.retry}>
            {S.common.retry}
          </Button>
        </div>
      )}
      {state === "ready" && (
        <>
          <ul
            aria-label={S.chat.shortcuts.folder}
            className="max-h-48 space-y-1.5 overflow-y-auto overscroll-contain"
          >
            {shortcuts.map((shortcut) => (
              <li key={shortcut.id} className="flex items-center gap-1">
                {onFill ? (
                  <button
                    type="button"
                    data-tooltip={`${shortcut.title}\n${S.chat.exampleFillHint}`}
                    onClick={() => onFill(shortcut.prompt)}
                    className={`flex min-w-0 flex-1 items-center ${ICON_GAP.menu} ${exampleRowClass}`}
                  >
                    <ExampleRowGlyph glyph={SHORTCUTS_GLYPH} />
                    <span className="min-w-0 flex-1 truncate">{shortcut.title}</span>
                    <ExampleRowGo />
                  </button>
                ) : (
                  <span
                    className={`flex min-w-0 flex-1 items-center ${ICON_GAP.menu} px-2.5 py-2 text-sm`}
                  >
                    <ExampleRowGlyph glyph={SHORTCUTS_GLYPH} />
                    <span className="min-w-0 flex-1 truncate">{shortcut.title}</span>
                  </span>
                )}
                <RowAction
                  label={S.common.edit}
                  glyph={ICONS.pencil}
                  disabled={saving}
                  onClick={() => setDraft({ ...shortcut })}
                />
                <RowAction
                  label={S.common.delete}
                  glyph={ICONS.trash}
                  danger
                  disabled={saving}
                  onClick={() => setDeleting(shortcut)}
                />
              </li>
            ))}
          </ul>
          <button
            type="button"
            data-tooltip={S.chat.shortcuts.newFromComposer}
            onClick={startCreate}
            disabled={saving}
            className={`mt-1.5 flex w-full items-center ${ICON_GAP.menu} ${exampleRowClass} disabled:opacity-50`}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-fg-muted">
              <PlusIcon size={ICON_SIZE.inlineGlyph} />
            </span>
            <span className="min-w-0 flex-1 truncate">{S.chat.shortcuts.new}</span>
          </button>
        </>
      )}
      {draft !== null && (
        <ShortcutDialog opening={draft} onClose={() => setDraft(null)} onSave={saveDraft} />
      )}
      <ConfirmModal
        open={deleting !== null}
        title={S.chat.shortcuts.deleteTitle}
        confirmLabel={S.common.delete}
        cancelLabel={S.common.cancel}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting !== null) void library.save(removeShortcut(shortcuts, deleting.id), true);
          setDeleting(null);
        }}
      >
        <p className="text-sm text-fg-muted">
          {deleting !== null ? S.chat.shortcuts.deleteConfirm(deleting.title) : ""}
        </p>
      </ConfirmModal>
    </>
  );
}

/**
 * The create / edit dialog. It opens on the shortcut being edited, or on a new one already
 * filled from the composer — that prefill is where it starts, so closing it untouched asks
 * nothing, and a valid new shortcut can be saved as it stands. Save waits for its write: a
 * refused one leaves the dialog open with what was typed.
 */
function ShortcutDialog({
  opening,
  onClose,
  onSave,
}: {
  opening: ShortcutDraft;
  onClose: () => void;
  onSave: (draft: ShortcutDraft) => Promise<boolean>;
}) {
  const form = useFormDraft(opening, {
    normalize: (d) => ({ id: d.id, title: d.title.trim(), prompt: d.prompt.trim() }),
  });
  const draft = form.draft;
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });
  const editing = draft.id !== null;
  const draftError = shortcutDraftError(draft);
  // A new shortcut is a change on its own; an edit has to change something.
  const canSave = draftError === null && (!editing || form.dirty) && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    // On success the host closes the dialog; a refused write leaves the typing as it was.
    if (!(await onSave(draft))) setBusy(false);
  };

  return (
    <Modal
      open
      title={editing ? S.chat.shortcuts.editTitle : S.chat.shortcuts.createTitle}
      onClose={requestClose}
      widthClass="sm:max-w-lg"
      footer={
        <>
          <Button size="sm" disabled={busy} onClick={requestClose}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={!canSave} onClick={() => void save()}>
            {S.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          size="sm"
          label={S.chat.shortcuts.titleLabel}
          hint={S.chat.shortcuts.titleHint(SHORTCUT_TITLE_MAX)}
          error={
            draftError === "titleTooLong"
              ? S.chat.shortcuts.titleTooLong(SHORTCUT_TITLE_MAX)
              : undefined
          }
          value={draft.title}
          autoFocus
          maxLength={SHORTCUT_TITLE_MAX}
          onChange={(e) => form.patch({ title: e.target.value })}
        />
        <Textarea
          label={S.chat.shortcuts.promptLabel}
          info={S.chat.shortcuts.promptInfo}
          infoLabel={S.common.moreInfoAbout(S.chat.shortcuts.promptLabel)}
          hint={S.chat.shortcuts.promptHint(SHORTCUT_PROMPT_MAX)}
          error={
            draftError === "promptTooLong"
              ? S.chat.shortcuts.promptTooLong(SHORTCUT_PROMPT_MAX)
              : undefined
          }
          value={draft.prompt}
          rows={8}
          size="sm"
          maxLength={SHORTCUT_PROMPT_MAX}
          onChange={(e) => form.patch({ prompt: e.target.value })}
        />
      </div>
    </Modal>
  );
}
