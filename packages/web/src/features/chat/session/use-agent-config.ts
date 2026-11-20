/** The conversation's Agent defaults, read and saved on the machine that holds it. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentConfigDto } from "@prismshadow/penguin-server/api";
import { toastError, toastSuccess } from "@prismshadow/penguin-ui";
import * as api from "../../../api/endpoints";
import { S } from "../../../lib/strings";
import { apiErrorText } from "../../../lib/api-error";
import { configuredCompactionLimit } from "../../../lib/context";
import { humanizeTokens } from "../../../lib/format";
import { scoped, scopedValue, scopeKey, type Scoped } from "../../../lib/project-scope";

export function useAgentConfig(
  projectId: string | null,
  agentId: string | null,
  machineId: string | null,
) {
  const scope = scopeKey(projectId, agentId, machineId);
  const [stored, setStored] = useState<Scoped<AgentConfigDto> | null>(null);
  const config = scopedValue(stored, scope);
  // Returning to an Agent after a switch is a new view, even when its scope key is identical.
  const owner = useMemo(() => ({ scope }), [scope]);
  const activeOwner = useRef<typeof owner | null>(owner);
  const readVersion = useRef(0);
  useEffect(() => {
    activeOwner.current = owner;
    return () => {
      activeOwner.current = null;
    };
  }, [owner]);

  // Other tabs can edit the same Agent. A refresh keeps its current values visible.
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const onFocus = () => setRefresh((n) => n + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  useEffect(() => {
    if (!projectId || !agentId || scope === null) return;
    const version = ++readVersion.current;
    let cancelled = false;
    api
      .getAgentConfig(projectId, agentId, machineId)
      .then((res) => {
        if (!cancelled && version === readVersion.current) setStored(scoped(scope, res.config));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, agentId, machineId, scope, refresh]);

  const onChangeCompactionLimit = useCallback(
    async (maxContextLength: number): Promise<void> => {
      if (!projectId || !agentId || scope === null) return;
      const res = await api
        .putAgentConfig(
          projectId,
          agentId,
          { config: { compaction: { maxContextLength } } },
          machineId,
        )
        .catch((e) => {
          toastError(apiErrorText(e));
          throw e;
        });
      if (activeOwner.current !== owner) return;
      // PUT returns the stored config. Retire reads that started before this save completed.
      readVersion.current += 1;
      setStored(scoped(scope, res.config));
      toastSuccess(S.chat.contextThresholdSaved(humanizeTokens(maxContextLength)));
    },
    [projectId, agentId, machineId, scope, owner],
  );

  return {
    agentThinkingLevel: config?.model?.thinkingLevel ?? "",
    compactionLimit:
      config === null ? undefined : configuredCompactionLimit(config.compaction?.maxContextLength),
    onChangeCompactionLimit,
  };
}
