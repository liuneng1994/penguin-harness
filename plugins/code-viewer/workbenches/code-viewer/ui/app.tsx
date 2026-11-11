import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, NoticeStrip, Segmented, Switch } from "@prismshadow/penguin-ui";
import { createPreviewEditor } from "./editor/editor.js";
import { CodeInteraction } from "./interaction.js";
import { codeChanges, RemovedCode } from "./inline-changes.js";
import type { CodeAnchor, CodeSelection, GitChange, PreviewEditor } from "./editor/editor.js";
import { en, zh } from "./strings.js";

const query = new URLSearchParams(location.search);
const S = query.get("locale") === "zh" ? zh : en;
const sdkPath = "../sdk/workbench.js";
const { apiBase } = (await import(sdkPath)) as { apiBase: string };
const position = (key: string) => {
  const n = Number(query.get(key));
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
};
type Scope = "working" | "staged";
type Snapshot = {
  available: boolean;
  scope: Scope;
  text: string | null;
  version: string | null;
  patch: string;
  binary: boolean;
  untracked: boolean;
};
async function checked(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal, credentials: "same-origin" });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const errors: Record<string, string> = {
      path_not_found: S.missing,
      editor_file_ambiguous: S.ambiguous,
      editor_search_incomplete: S.incomplete,
      forbidden: S.forbidden,
      diff_too_large: S.diffTooLarge,
    };
    throw new Error(
      errors[error?.error?.code] ?? error?.error?.message ?? `${S.failed} (${response.status})`,
    );
  }
  return response;
}

function App() {
  const mount = useRef<HTMLDivElement>(null);
  const editor = useRef<PreviewEditor | null>(null);
  const resolved = useRef<string | null>(null);
  const changes = useRef<GitChange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [path, setPath] = useState(query.get("path") ?? "");
  const [window, setWindow] = useState({ from: 1, to: 1, total: 1 });
  const [wrap, setWrap] = useState(false);
  const [showChanges, setShowChanges] = useState(true);
  const [scope, setScope] = useState<Scope>("working");
  const [copied, setCopied] = useState(false);
  const [copiedDiff, setCopiedDiff] = useState(false);
  const [anchor, setAnchor] = useState<CodeAnchor | null>(null);
  const [selection, setSelection] = useState<CodeSelection | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    editor.current?.changes(showChanges ? changes.current : []);
  }, [showChanges]);
  useEffect(() => {
    const session = query.get("session"),
      requested = query.get("path");
    if (!session || !requested) return;
    setLoaded(false);
    setError(null);
    setSelection(null);
    setAnchor(null);
    setCopied(false);
    setCopiedDiff(false);
    const controller = new AbortController();
    void (async () => {
      try {
        const base = `${apiBase}/sessions/${encodeURIComponent(session)}/files`;
        let relative = resolved.current;
        if (!relative) {
          const params = new URLSearchParams({ path: requested });
          for (const key of ["line", "column"]) {
            const n = position(key);
            if (n) params.set(key, String(n));
          }
          const target = (await (
            await checked(`${base}/editor-target?${params}`, controller.signal)
          ).json()) as { path: string; workspace: string };
          relative = target.path
            .replaceAll("\\", "/")
            .slice(target.workspace.replaceAll("\\", "/").replace(/\/$/, "").length + 1);
          resolved.current = relative;
        }
        setPath(relative);
        const data = (await (
          await checked(
            `${base}/git-diff?${new URLSearchParams({ path: relative, scope })}`,
            controller.signal,
          )
        ).json()) as Snapshot;
        if (controller.signal.aborted || !mount.current) return;
        setSnapshot(data);
        if (data.text === null) throw new Error(S.binary);
        try {
          changes.current = data.binary ? [] : codeChanges(data.patch, data.text);
        } catch (err) {
          changes.current = [];
          setError(err instanceof Error ? err.message : S.fileChanged);
        }
        const preview = await createPreviewEditor(mount.current, {
          text: data.text,
          path: relative,
          codeLabel: S.codeLabel,
          phrases: S.searchPhrases,
          line: position("line"),
          column: position("column"),
          endLine: position("endLine"),
          endColumn: position("endColumn"),
          changes: showChanges ? changes.current : [],
          changeLabels: { add: S.addedCode, modify: S.modifiedCode, delete: S.deletedCode },
          renderRemoved: (parent, change) => {
            const root = createRoot(parent);
            root.render(<RemovedCode change={change} />);
            return () => root.unmount();
          },
          onSelection: setSelection,
          onAnchor: setAnchor,
          onWindow: (from, to, total) => setWindow({ from, to, total }),
        });
        if (controller.signal.aborted) {
          preview.destroy();
          return;
        }
        editor.current = preview;
        preview.wrap(wrap);
        setLoaded(true);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : S.failed);
      }
    })();
    return () => {
      controller.abort();
      editor.current?.destroy();
      editor.current = null;
    };
  }, [reload, scope]);
  const available = query.has("session") && query.has("path");
  const status =
    loaded && snapshot
      ? !snapshot.available
        ? S.notGit
        : !/^@@ /m.test(snapshot.patch)
          ? snapshot.patch
            ? S.metadataDiff
            : snapshot.untracked && scope === "working" && !snapshot.text
              ? S.emptyNewFile
              : scope === "staged"
                ? S.noStaged
                : S.noUnstaged
          : null
      : null;
  return (
    <main className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <span
          className="preview-path min-w-0 flex-1 truncate font-mono text-xs"
          data-tooltip={path}
        >
          {path || S.readOnly}
        </span>
        {snapshot?.available && (
          <Segmented
            cols={2}
            value={scope}
            onChange={setScope}
            options={[
              { value: "working", label: S.unstaged },
              { value: "staged", label: S.staged },
            ]}
          />
        )}
        <Button size="sm" disabled={!available} onClick={() => setReload((n) => n + 1)}>
          {S.refresh}
        </Button>
        <Button size="sm" disabled={!loaded} onClick={() => editor.current?.search()}>
          {S.search}
        </Button>
        <Button
          size="sm"
          disabled={!loaded}
          onClick={() => {
            void navigator.clipboard
              .writeText(editor.current?.copy() ?? "")
              .then(() => setCopied(true))
              .catch(() => setError(S.copyFailed));
          }}
        >
          {copied ? S.copied : S.copy}
        </Button>
        {snapshot?.available && (
          <Button
            size="sm"
            disabled={!snapshot.patch || snapshot.scope !== scope}
            onClick={() => {
              void navigator.clipboard
                .writeText(snapshot.patch)
                .then(() => setCopiedDiff(true))
                .catch(() => setError(S.copyFailed));
            }}
          >
            {copiedDiff ? S.copied : S.copyDiff}
          </Button>
        )}
        <label className="flex items-center gap-2 whitespace-nowrap text-xs text-fg-secondary">
          <Switch
            checked={wrap}
            onChange={(value) => {
              setWrap(value);
              editor.current?.wrap(value);
            }}
          />
          {S.wrap}
        </label>
      </div>
      {error && (
        <NoticeStrip tone="attention" role="alert" className="px-3 py-2">
          {error}
        </NoticeStrip>
      )}
      {!loaded && !error && (
        <p role="status" className="px-4 py-4 text-sm text-fg-muted">
          {available ? S.loading : S.empty}
        </p>
      )}
      {status && (
        <p role="status" className="px-3 py-2 text-xs text-fg-muted">
          {status}
        </p>
      )}
      <div ref={mount} className="code-preview-editor min-h-0 flex-1 overflow-hidden" />
      {loaded && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span>{S.range(window.from, window.to, window.total)}</span>
            <span>
              {snapshot?.available
                ? scope === "staged"
                  ? S.stagedCode
                  : S.workingCode
                : S.readOnly}
            </span>
            {snapshot?.available && (
              <label className="flex items-center gap-2 whitespace-nowrap">
                <Switch checked={showChanges} onChange={setShowChanges} />
                {S.showChanges}
              </label>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {changes.current.length > 0 && (
              <>
                <Button size="sm" onClick={() => editor.current?.nextChange(-1)}>
                  {S.previousChange}
                </Button>
                <Button size="sm" onClick={() => editor.current?.nextChange(1)}>
                  {S.nextChange}
                </Button>
              </>
            )}
            <Button
              size="sm"
              disabled={window.from === 1}
              onClick={() => editor.current?.expand("up")}
            >
              {S.up}
            </Button>
            <Button
              size="sm"
              disabled={window.to === window.total}
              onClick={() => editor.current?.expand("down")}
            >
              {S.down}
            </Button>
            <Button
              size="sm"
              disabled={window.from === 1 && window.to === window.total}
              onClick={() => editor.current?.expand("all")}
            >
              {S.all}
            </Button>
          </div>
        </div>
      )}
      {loaded && selection && snapshot && (
        <CodeInteraction
          key={`${scope}:${reload}`}
          editor={editor.current!}
          anchor={anchor}
          apiBase={apiBase}
          session={query.get("session")!}
          path={path}
          selection={selection}
          version={snapshot.version ?? ""}
          gitScope={snapshot.available ? scope : undefined}
          hasChanges={/^@@ /m.test(snapshot.patch)}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
