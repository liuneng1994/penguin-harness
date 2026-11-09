/** Session file links open using the account's editor settings and the target node. */
import { useCallback, useRef } from "react";
import { useAuth } from "../../state/auth";
import { useMachines } from "../../state/machines";
import { isDesktopShellWindow } from "../../lib/account-menu";
import type { FileLocation } from "../../lib/file-location";
import { toastApiError } from "../../lib/toast-api-error";
import { openFileInVSCode } from "./open-in-editor";

export function useFileEditor(sessionId: string | null) {
  const { user, desktopMode, sessionVia } = useAuth();
  const machines = useMachines().state?.machines;
  const machinesRef = useRef(machines);
  machinesRef.current = machines;
  return useCallback((location: FileLocation) => {
    if (!sessionId || !user) return;
    void openFileInVSCode({ kind: "session", sessionId }, location, {
      userId: user.userId,
      desktop: isDesktopShellWindow({ desktopMode, sessionVia }),
      machines: machinesRef.current,
    }).catch(toastApiError);
  }, [sessionId, user?.userId, desktopMode, sessionVia]);
}
