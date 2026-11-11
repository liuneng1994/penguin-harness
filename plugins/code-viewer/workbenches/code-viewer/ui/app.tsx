import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Button,
  Dropdown,
  Menu,
  MenuItem,
  NoticeStrip,
  Segmented,
  Switch,
} from "@prismshadow/penguin-ui";
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
type Preview = {
  scope: Scope;
  reload: number;
  snapshot: Snapshot;
  path: string;
  changes: GitChange[];
  editor: PreviewEditor | null;
  lines: number;
};
function snapshotStatus(snapshot: Snapshot) {
  if (!snapshot.available) return S.notGit;
  if (snapshot.binary) return S.binaryDiff;
  if (/^@@ /m.test(snapshot.patch)) return null;
  if (snapshot.patch) return S.metadataDiff;
  if (snapshot.untracked && snapshot.scope === "working" && !snapshot.text) return S.emptyNewFile;
  return snapshot.scope === "staged" ? S.noStaged : S.noUnstaged;
}
async function read<T>(url: string, signal: AbortSignal): Promise<T> {
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
      { cause: error?.error?.code },
    );
  }
  return response.json();
}

function App() {
  const mount = useRef<HTMLDivElement>(null);
  const resolved = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wrap, setWrap] = useState(false);
  const [showChanges, setShowChanges] = useState(true);
  const [scope, setScope] = useState<Scope>("working");
  const [copied, setCopied] = useState<"code" | "diff" | null>(null);
  const [more, setMore] = useState(false);
  const [anchor, setAnchor] = useState<CodeAnchor | null>(null);
  const [selection, setSelection] = useState<CodeSelection | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reload, setReload] = useState(0);
  const current = preview?.scope === scope && preview.reload === reload ? preview : null;
  const editor = current?.editor;
  const loaded = !!editor;
  const snapshot = current?.snapshot;
  const path = preview?.path ?? query.get("path") ?? "";
  const changes = current?.changes ?? [];
  useEffect(() => {
    editor?.changes(showChanges ? changes : []);
  }, [editor, showChanges]);
  useEffect(() => {
    editor?.wrap(wrap);
  }, [editor, wrap]);
  useEffect(() => {
    const session = query.get("session"),
      requested = query.get("path");
    if (!session || !requested) return;
    setError(null);
    setSelection(null);
    setAnchor(null);
    setCopied(null);
    setMore(false);
    const controller = new AbortController();
    let created: PreviewEditor | null = null;
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
          try {
            const target = await read<{ path: string; workspace: string }>(
              `${base}/editor-target?${params}`,
              controller.signal,
            );
            relative = target.path
              .replaceAll("\\", "/")
              .slice(target.workspace.replaceAll("\\", "/").replace(/\/$/, "").length + 1);
          } catch (err) {
            // A deleted file still has a Git diff; abbreviated names need the live path resolver.
            if (
              !(err instanceof Error) ||
              err.cause !== "path_not_found" ||
              !/[/\\]/.test(requested)
            )
              throw err;
            relative = requested.replaceAll("\\", "/");
          }
          resolved.current = relative;
        }
        const data = await read<Snapshot>(
          `${base}/git-diff?${new URLSearchParams({ path: relative, scope })}`,
          controller.signal,
        );
        if (controller.signal.aborted || !mount.current) return;
        const result: Preview = {
          scope,
          reload,
          snapshot: data,
          path: relative,
          changes: [],
          editor: null,
          lines: data.text?.split(/\r\n?|\n/).length ?? 0,
        };
        if (data.text === null) {
          setPreview(result);
          throw new Error(S.binary);
        }
        result.changes = data.binary ? [] : codeChanges(data.patch, data.text);
        created = await createPreviewEditor(mount.current, {
          text: data.text,
          path: relative,
          codeLabel: S.codeLabel,
          phrases: S.searchPhrases,
          line: position("line"),
          column: position("column"),
          endLine: position("endLine"),
          endColumn: position("endColumn"),
          changes: showChanges ? result.changes : [],
          changeLabels: { add: S.addedCode, modify: S.modifiedCode, delete: S.deletedCode },
          renderRemoved: (parent, change) => {
            const root = createRoot(parent);
            root.render(<RemovedCode change={change} />);
            return () => root.unmount();
          },
          onSelection: setSelection,
          onAnchor: setAnchor,
        });
        if (controller.signal.aborted) {
          created.destroy();
          created = null;
          return;
        }
        setPreview({ ...result, editor: created });
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : S.failed);
      }
    })();
    return () => {
      controller.abort();
      created?.destroy();
    };
  }, [reload, scope]);
  const available = query.has("session") && query.has("path");
  const status = loaded && snapshot ? snapshotStatus(snapshot) : null;
  const navigation =
    showChanges && changes.length > 0
      ? changes.length > 1
        ? ([-1, 1] as const)
        : ([1] as const)
      : [];
  const copy = (text: string, kind: "code" | "diff") => {
    void navigator.clipboard
      .writeText(text)
      .then(() => setCopied(kind))
      .catch(() => setError(S.copyFailed));
  };
  return (
    <main
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(event) => {
        // Let the menu close locally before the iframe host forwards unhandled keys.
        if (more && event.key === "Escape") event.preventDefault();
      }}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <span
          className="preview-path min-w-0 flex-1 truncate font-mono text-xs"
          data-tooltip={path}
        >
          {path || S.readOnly}
        </span>
        {preview?.snapshot.available && (
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
        <Button size="sm" disabled={!loaded} onClick={() => editor?.search()}>
          {S.search}
        </Button>
        <Button size="sm" disabled={!loaded} onClick={() => copy(editor?.copy() ?? "", "code")}>
          {copied === "code" ? S.copied : S.copy}
        </Button>
        <label className="flex items-center gap-2 whitespace-nowrap text-xs text-fg-secondary">
          <Switch checked={wrap} onChange={setWrap} />
          {S.wrap}
        </label>
        {preview?.snapshot.available && (
          <Dropdown
            open={more}
            setOpen={setMore}
            portal={{ direction: "down", align: "right" }}
            button={
              <Button
                size="sm"
                disabled={!current}
                aria-haspopup="menu"
                aria-expanded={more}
                onClick={() => setMore(!more)}
              >
                {S.more}
              </Button>
            }
          >
            <Menu density="sm" label={S.more}>
              {snapshot?.available && (
                <MenuItem
                  label={copied === "diff" ? S.copied : S.copyDiff}
                  aria-label={S.copyDiff}
                  disabled={!snapshot.patch}
                  onSelect={() => {
                    setMore(false);
                    copy(snapshot.patch, "diff");
                  }}
                />
              )}
            </Menu>
          </Dropdown>
        )}
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
        <div className="code-preview-footer flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span>{S.range(1, current!.lines, current!.lines)}</span>
            {changes.length > 0 && (
              <label className="flex items-center gap-2 whitespace-nowrap">
                <Switch checked={showChanges} onChange={setShowChanges} />
                {S.showChanges}
              </label>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {navigation.map((direction) => (
              <Button key={direction} size="sm" onClick={() => editor?.nextChange(direction)}>
                {changes.length === 1
                  ? S.locateChange
                  : direction === -1
                    ? S.previousChange
                    : S.nextChange}
              </Button>
            ))}
          </div>
        </div>
      )}
      {loaded && selection && snapshot && (
        <CodeInteraction
          key={`${scope}:${reload}`}
          editor={editor!}
          anchor={anchor}
          apiBase={apiBase}
          session={query.get("session")!}
          path={path}
          selection={selection}
          version={snapshot.version ?? ""}
          gitScope={snapshot.available ? scope : undefined}
          hasChanges={changes.length > 0}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
