import { Button, Modal } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

/** Native login has no editable connection fields: the credentials belong to the server. */
export function NativeProviderSettings({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <Modal
      open
      title={S.models.groupSettingsTitle(label)}
      onClose={onClose}
      footer={
        <Button size="sm" onClick={onClose}>
          {S.common.close}
        </Button>
      }
    >
      <p className="text-sm text-muted">{S.models.traeLoginHint}</p>
    </Modal>
  );
}
