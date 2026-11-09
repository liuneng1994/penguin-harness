/** The reader's SSH alias is a browser preference, independent of the server's credentials. */
import { useState } from "react";
import { Modal, Input, Button, useFormDraft, useGuardedClose } from "@prismshadow/penguin-ui";
import { isEditorSshAlias } from "@prismshadow/penguin-server/editor";
import type { FilesScope } from "../../api/workspace-files";
import { editorConnectionConfigured, editorSshAlias, saveEditorSshAlias } from "./open-in-editor";
import { ApiError } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { useMachines } from "../../state/machines";

export function VSCodeSettings({
  scope,
  userId,
  onClose,
}: {
  scope: FilesScope;
  userId: string;
  onClose: () => void;
}) {
  const machineHosts = useMachines().state?.machines;
  const initial = editorSshAlias(userId, scope, machineHosts);
  const form = useFormDraft(initial, { normalize: (value) => value.trim() });
  const alias = form.draft.trim();
  const requestClose = useGuardedClose(onClose, form.scope);
  const valid = isEditorSshAlias(alias);
  const canSave = valid && (form.dirty || !editorConnectionConfigured(userId, scope, machineHosts));
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    if (!canSave) return;
    try {
      saveEditorSshAlias(userId, scope, alias);
      form.adopt(alias);
      onClose();
    } catch (error) {
      setError(error instanceof ApiError ? apiErrorText(error) : S.files.editorInvalidAlias);
    }
  };
  return (
    <Modal
      open
      title={S.files.editorSettings}
      onClose={requestClose}
      footer={
        <>
          <Button size="sm" onClick={requestClose}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" onClick={save} disabled={!canSave}>
            {S.common.save}
          </Button>
        </>
      }
    >
      <Input
        size="sm"
        label={S.files.editorSshAlias}
        placeholder={S.files.editorSshPlaceholder}
        hint={S.files.editorSshHint}
        value={form.draft}
        error={valid ? (error ?? undefined) : S.files.editorInvalidAlias}
        onChange={(event) => {
          form.setDraft(event.target.value);
          setError(null);
        }}
      />
    </Modal>
  );
}
