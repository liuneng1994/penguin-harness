/** The Project's explicit General Agent skill sync action and its read-only preview. */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { SkillSyncResponse } from "@prismshadow/penguin-server/api";
import { Button, FieldError, PrefRow } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toastApiError } from "../../lib/toast-api-error";

export function ProjectSkillSync({
  projectId,
  isOwner,
  agentNames,
}: {
  projectId: string;
  isOwner: boolean;
  agentNames: Record<string, string>;
}) {
  const [status, setStatus] = useState<SkillSyncResponse | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [performed, setPerformed] = useState(false);
  useEffect(() => {
    let active = true;
    setStatus(null);
    setError(undefined);
    setLoading(true);
    setPerformed(false);
    void api
      .getProjectSkillSync(projectId)
      .then(
        (response) => {
          if (active) setStatus(response);
        },
        (err: unknown) => {
          if (active) setError(apiErrorText(err));
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  const sync = async () => {
    setBusy(true);
    try {
      setStatus(await api.syncProjectSkills(projectId));
      setError(undefined);
      setPerformed(true);
    } catch (err) {
      toastApiError(err);
    } finally {
      setBusy(false);
    }
  };
  const conflicts = status?.entries.filter((entry) => entry.status === "conflict") ?? [];
  const pending = status?.entries.filter((entry) => entry.status === "pending").length ?? 0;
  const synced =
    status?.entries.filter((entry) => entry.status === "synced" || entry.status === "current")
      .length ?? 0;
  return (
    <div className="py-3">
      <PrefRow
        label={S.project.skillSyncTitle}
        info={S.project.skillSyncInfo}
        hint={
          status
            ? performed
              ? S.project.skillSyncSummary(synced, status.targets, conflicts.length)
              : S.project.skillSyncPreview(pending, status.targets, conflicts.length)
            : undefined
        }
      >
        <Button size="sm" disabled={!isOwner || loading || busy} onClick={() => void sync()}>
          {S.project.skillSyncNow}
        </Button>
      </PrefRow>
      {error && <FieldError>{error}</FieldError>}
      {conflicts.length > 0 && (
        <ul
          className="mt-3 space-y-1 text-xs text-fg-muted"
          aria-label={S.project.skillSyncConflicts}
        >
          {conflicts.map((entry) => (
            <li key={`${entry.agentId}/${entry.name}`} className="flex flex-wrap gap-x-2">
              <Link
                to={`/agents/${encodeURIComponent(entry.agentId)}?tab=skills`}
                className="underline underline-offset-2"
              >
                {agentNames[entry.agentId] ?? entry.agentId}
              </Link>
              <span>{entry.name}</span>
              <span>
                {entry.reason
                  ? S.project.skillSyncReasons[entry.reason]
                  : S.project.skillSyncReasons.unreadable}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
