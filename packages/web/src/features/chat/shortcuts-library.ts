/** Account shortcuts shared by the draft folder and the composer's picker/manager. */
import { useEffect, useRef, useState } from "react";
import * as api from "../../api/endpoints";
import { toastApiError } from "../../lib/toast-api-error";
import { normalizeShortcuts } from "./user-shortcuts";
import type { UserShortcut } from "./user-shortcuts";

export function useShortcutsLibrary(enabled = true) {
  const [shortcuts, setShortcuts] = useState<UserShortcut[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const readVersion = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const version = readVersion.current;
    setState("loading");
    void api.getPrefs().then(
      (res) => {
        if (cancelled || version !== readVersion.current) return;
        setShortcuts(normalizeShortcuts(res.prefs.draftShortcuts));
        setState("ready");
      },
      () => {
        if (!cancelled && version === readVersion.current) setState("failed");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, attempt]);

  const save = async (next: UserShortcut[]): Promise<boolean> => {
    // A failed read must never become an empty list that a later save overwrites.
    if (state !== "ready" || savingRef.current) return false;
    savingRef.current = true;
    readVersion.current += 1;
    setSaving(true);
    try {
      await api.putPrefs({ draftShortcuts: next });
      setShortcuts(next);
      return true;
    } catch (err) {
      toastApiError(err);
      return false;
    } finally {
      // A refresh started before the write settled may still carry the replaced list.
      readVersion.current += 1;
      setState("ready");
      savingRef.current = false;
      setSaving(false);
    }
  };

  return { shortcuts, state, saving, save, retry: () => setAttempt((n) => n + 1) };
}

export type ShortcutsLibrary = ReturnType<typeof useShortcutsLibrary>;
