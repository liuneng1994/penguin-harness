import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, NoticeStrip, Switch } from "@prismshadow/penguin-ui";
import { createPreviewEditor } from "./editor/editor.js";
import { CodeInteraction } from "./interaction.js";
import type { CodeAnchor, CodeSelection, PreviewEditor } from "./editor/editor.js";
import { en, zh } from "./strings.js";

const query = new URLSearchParams(location.search);
const S = query.get("locale") === "zh" ? zh : en;
const sdkPath = "../sdk/workbench.js";
const { apiBase } = (await import(sdkPath)) as { apiBase: string };
const position = (key: string) => {
  const n = Number(query.get(key));
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
};
async function checked(url: string, signal: AbortSignal) {
  const res = await fetch(url, { signal, credentials: "same-origin" });
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    const errors: Record<string, string> = {
      path_not_found: S.missing,
      editor_file_ambiguous: S.ambiguous,
      editor_search_incomplete: S.incomplete,
      forbidden: S.forbidden,
    };
    throw new Error(
      errors[error?.error?.code] ?? error?.error?.message ?? `${S.failed} (${res.status})`,
    );
  }
  return res;
}
async function readText(res: Response) {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 2 * 1024 * 1024) throw new Error(S.tooLarge);
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(merged);
  } catch {
    throw new Error(S.binary);
  }
  if (text.includes("\0")) throw new Error(S.binary);
  return text;
}

function App() {
  const mount = useRef<HTMLDivElement>(null);
  const editor = useRef<PreviewEditor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [path, setPath] = useState(query.get("path") ?? "");
  const [window, setWindow] = useState({ from: 1, to: 1, total: 1 });
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [anchor, setAnchor] = useState<CodeAnchor | null>(null);
  const [selection, setSelection] = useState<CodeSelection | null>(null);
  const [version, setVersion] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const session = query.get("session"),
      requested = query.get("path");
    if (!session || !requested) return;
    setLoaded(false);
    setError(null);
    setSelection(null);
    const controller = new AbortController();
    void (async () => {
      try {
        const base = `${apiBase}/sessions/${encodeURIComponent(session)}/files`;
        const params = new URLSearchParams({ path: requested });
        for (const key of ["line", "column"]) {
          const n = position(key);
          if (n) params.set(key, String(n));
        }
        const target = (await (
          await checked(`${base}/editor-target?${params}`, controller.signal)
        ).json()) as { path: string; workspace: string };
        const normalized = target.path.replaceAll("\\", "/");
        const workspace = target.workspace.replaceAll("\\", "/").replace(/\/$/, "");
        const relative = normalized.slice(workspace.length + 1);
        setPath(relative);
        const response = await checked(
          `${base}/content?${new URLSearchParams({ path: relative })}`,
          controller.signal,
        );
        setVersion(response.headers.get("ETag") ?? "");
        const text = await readText(response);
        if (controller.signal.aborted || !mount.current) return;
        const preview = await createPreviewEditor(mount.current, {
          text,
          path: relative,
          codeLabel: S.codeLabel,
          phrases: S.searchPhrases,
          line: position("line"),
          column: position("column"),
          endLine: position("endLine"),
          endColumn: position("endColumn"),
          onSelection: setSelection,
          onAnchor: setAnchor,
          onWindow: (from, to, total) => setWindow({ from, to, total }),
        });
        if (controller.signal.aborted) {
          preview.destroy();
          return;
        }
        editor.current = preview;
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
  }, [reload]);
  const available = query.has("session") && query.has("path");
  return (
    <main className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <span
          className="preview-path min-w-0 flex-1 truncate font-mono text-xs"
          data-tooltip={path}
        >
          {path || S.readOnly}
        </span>
        <Button size="sm" disabled={!loaded} onClick={() => setReload((n) => n + 1)}>
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
        <label className="flex items-center gap-2 whitespace-nowrap text-xs text-fg-secondary">
          <Switch
            checked={wrap}
            onChange={(v) => {
              setWrap(v);
              editor.current?.wrap(v);
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
      <div ref={mount} className="code-preview-editor min-h-0 flex-1 overflow-hidden" />
      {loaded && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
          <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
            <span>{S.range(window.from, window.to, window.total)}</span>
            <span>{S.readOnly}</span>
          </div>
          <div className="flex flex-wrap gap-2">
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
      {loaded && selection && (
        <CodeInteraction
          key={reload}
          editor={editor.current!}
          anchor={anchor}
          apiBase={apiBase}
          session={query.get("session")!}
          path={path}
          selection={selection}
          version={version}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
