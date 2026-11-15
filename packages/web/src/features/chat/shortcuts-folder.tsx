/**
 * Account shortcuts fill the composer without sending. Saved rows scroll while New shortcut
 * stays visible. Row actions remain visible on touch; create/edit wait for the server, and
 * failed optimistic deletes roll back.
 */
import { useCallback, useEffect, useRef, useState } from "react";
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
import * as api from "../../api/endpoints";
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
  normalizeShortcuts,
  removeShortcut,
  shortcutDraftError,
  upsertShortcut,
} from "./user-shortcuts";
import type { ShortcutDraft, UserShortcut } from "./user-shortcuts";
import { toastApiError } from "../../lib/toast-api-error";

/** Separate from EXAMPLE_FOLDERS because saved rows contain the user's own text. */
export const SHORTCUTS_FOLDER_ID = "shortcuts";

const SHORTCUTS_GLYPH = ICONS.zap;

/** An always-visible row action (edit / delete), sized and coloured to recede until pointed at. */
function RowAction({
  label,
  glyph,
  danger = false,
  onClick,
}: {
  label: string;
  glyph: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-tooltip={label}
      aria-label={label}
      onClick={onClick}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors duration-150 ${
        danger ? "hover:text-tone-danger-fg" : "hover:text-fg"
      }`}
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
  /** The composer's current text, read at click time — a new shortcut starts from what was typed. */
  readComposerText: () => string;
  /** Hand the saved prompt to the composer. Pins no Skills; see user-shortcuts.ts. */
  onFill: (prompt: string) => void;
}) {
  const [shortcuts, setShortcuts] = useState<UserShortcut[]>([]);
  // A failed read must never become an empty list that a later save overwrites.
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [draft, setDraft] = useState<ShortcutDraft | null>(null);
  const [deleting, setDeleting] = useState<UserShortcut | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getPrefs()
      .then((res) => {
        if (cancelled) return;
        setShortcuts(normalizeShortcuts(res.prefs.draftShortcuts));
        setLoadState("ready");
      })
      .catch(() => {
        if (!cancelled) setLoadState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  /** Latest list for the rollback value: a stale closure would restore a list two edits old. */
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;
  const persist = useCallback((next: UserShortcut[]) => {
    const rollback = shortcutsRef.current;
    setShortcuts(next);
    api.putPrefs({ draftShortcuts: next }).catch((e: unknown) => {
      setShortcuts(rollback);
      toastApiError(e);
    });
  }, []);

  const startCreate = () => {
    // The high-value path: whatever is already in the composer becomes the body of the new
    // shortcut, with its first line suggested as the name. Both fields stay editable.
    const text = readComposerText().trim();
    setDraft({ id: null, title: defaultShortcutTitle(text), prompt: text });
  };

  /** The dialog's write: resolves with whether it landed; the list changes only once it has. */
  const saveDraft = async (next: ShortcutDraft): Promise<boolean> => {
    const list = upsertShortcut(shortcuts, next);
    try {
      await api.putPrefs({ draftShortcuts: list });
    } catch (e) {
      toastApiError(e);
      return false;
    }
    setShortcuts(list);
    setDraft(null);
    return true;
  };

  // A fragment, not a wrapper: the row and the panel are cells of the examples grid, placed by
  // it like a built-in folder's (the dialogs are portals and take no cell).
  return (
    <>
      <ExampleFolderRow
        open={open}
        glyph={SHORTCUTS_GLYPH}
        label={S.chat.shortcuts.folder}
        count={shortcuts.length}
        onOpen={onOpen}
      />

      {open && (
        <div className={examplePanelClass}>
          {loadState === "failed" && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span role="alert" className="text-xs text-tone-danger-fg">
                {S.chat.shortcuts.loadFailed}
              </span>
              <Button
                size="sm"
                onClick={() => {
                  setLoadState("loading");
                  setLoadAttempt((attempt) => attempt + 1);
                }}
              >
                {S.common.retry}
              </Button>
            </div>
          )}
          {loadState === "ready" && (
            <>
              <ul
                aria-label={S.chat.shortcuts.folder}
                className="max-h-48 space-y-1.5 overflow-y-auto overscroll-contain"
              >
                {shortcuts.map((shortcut) => (
                  <li key={shortcut.id} className="flex items-center gap-1">
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
                    <RowAction
                      label={S.common.edit}
                      glyph={ICONS.pencil}
                      onClick={() => setDraft({ ...shortcut })}
                    />
                    <RowAction
                      label={S.common.delete}
                      glyph={ICONS.trash}
                      danger
                      onClick={() => setDeleting(shortcut)}
                    />
                  </li>
                ))}
              </ul>
              <button
                type="button"
                data-tooltip={S.chat.shortcuts.newFromComposer}
                onClick={startCreate}
                className={`mt-1.5 flex w-full items-center ${ICON_GAP.menu} ${exampleRowClass}`}
              >
                {/* In a row glyph's box, so its title starts where the shortcuts' do. */}
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-fg-muted">
                  <PlusIcon size={ICON_SIZE.inlineGlyph} />
                </span>
                <span className="min-w-0 flex-1 truncate">{S.chat.shortcuts.new}</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Create and edit share one dialog — the fields and the rules are identical, and only the
          dialog's name says which one is happening (the same Modal + Input idiom as the sidebar's
          rename dialogs). Mounted per opening, so it starts from what it was opened with. */}
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
          if (deleting !== null) persist(removeShortcut(shortcuts, deleting.id));
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
