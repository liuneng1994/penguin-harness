import { useEffect, useState } from "react";
import { Button, DiffViewer, NoticeStrip, Segmented } from "@prismshadow/penguin-ui";
import { en, zh } from "./strings.js";
const S = new URLSearchParams(location.search).get("locale") === "zh" ? zh : en;
type Scope = "working" | "staged";
type GitDiff = {
  available: boolean;
  path: string;
  scope: Scope;
  patch: string;
  binary: boolean;
  untracked: boolean;
};

export function GitChanges({
  apiBase,
  session,
  path,
  wrap,
  reload,
}: {
  apiBase: string;
  session: string;
  path: string;
  wrap: boolean;
  reload: number;
}) {
  const [scope, setScope] = useState<Scope>("working");
  const [mode, setMode] = useState<"unified" | "split">("unified");
  const [data, setData] = useState<GitDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setBusy(true);
    setError(null);
    setCopied(false);
    void (async () => {
      try {
        const response = await fetch(
          `${apiBase}/sessions/${encodeURIComponent(session)}/files/git-diff?${new URLSearchParams({ path, scope })}`,
          { signal: abort.signal, credentials: "same-origin" },
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error?.code === "diff_too_large"
              ? S.diffTooLarge
              : (result.error?.message ?? S.diffFailed),
          );
        if (!abort.signal.aborted) setData(result);
      } catch (err) {
        if (!abort.signal.aborted) setError(err instanceof Error ? err.message : S.diffFailed);
      } finally {
        if (!abort.signal.aborted) setBusy(false);
      }
    })();
    return () => abort.abort();
  }, [apiBase, session, path, scope, reload]);
  return (
    <section className="anim-fade flex min-h-0 flex-1 flex-col" aria-label={S.gitDiff}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <Segmented
          cols={2}
          value={scope}
          onChange={setScope}
          options={[
            { value: "working", label: S.unstaged },
            { value: "staged", label: S.staged },
          ]}
        />
        <Segmented
          cols={2}
          value={mode}
          onChange={setMode}
          options={[
            { value: "unified", label: S.unified },
            { value: "split", label: S.split },
          ]}
        />
        <Button
          size="sm"
          disabled={busy || !data?.patch}
          onClick={() => {
            void navigator.clipboard
              .writeText(data?.patch ?? "")
              .then(() => setCopied(true))
              .catch(() => setError(S.copyFailed));
          }}
        >
          {copied ? S.copied : S.copyDiff}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {busy ? (
          <p role="status" className="text-xs text-fg-muted">
            {S.loadingDiff}
          </p>
        ) : error ? (
          <NoticeStrip tone="attention" role="alert">
            {error}
          </NoticeStrip>
        ) : !data?.available ? (
          <p role="status" className="text-xs text-fg-muted">
            {S.notGit}
          </p>
        ) : data.binary ? (
          <p role="status" className="text-xs text-fg-muted">
            {S.binaryDiff}
          </p>
        ) : !data.patch ? (
          <p role="status" className="text-xs text-fg-muted">
            {scope === "working" && data.untracked
              ? S.emptyNewFile
              : scope === "staged"
                ? S.noStaged
                : S.noUnstaged}
          </p>
        ) : !/^@@ /m.test(data.patch) ? (
          <p role="status" className="text-xs text-fg-muted">
            {S.metadataDiff}
          </p>
        ) : (
          <DiffViewer patch={data.patch} mode={mode} wrap={wrap} label={S.diffLabel(path)} />
        )}
      </div>
    </section>
  );
}
