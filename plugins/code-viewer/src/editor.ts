import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  lineNumbers,
  highlightSpecialChars,
  drawSelection,
} from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting, StreamLanguage } from "@codemirror/language";
import { search, searchKeymap, openSearchPanel } from "@codemirror/search";
import { defaultKeymap } from "@codemirror/commands";
import { tags } from "@lezer/highlight";

export interface CodeSelection {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  text: string;
}

export interface CodeAnchor {
  top: number;
  bottom: number;
  left: number;
  right: number;
  triggerLeft: number;
}

export interface PreviewOptions {
  text: string;
  path: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  codeLabel: string;
  phrases?: Record<string, string>;
  onAnchor?: (anchor: CodeAnchor | null) => void;
  onSelection?: (selection: CodeSelection) => void;
  onWindow: (from: number, to: number, total: number) => void;
}
export interface PreviewEditor {
  revealSelection(): void;
  focus(): void;
  selection(): CodeSelection;
  expand: (direction: "up" | "down" | "all") => void;
  wrap: (enabled: boolean) => void;
  search: () => void;
  copy: () => string;
  destroy: () => void;
}

async function language(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  if (["cpp", "cc", "cxx", "c", "h", "hpp", "hh", "hxx"].includes(ext ?? ""))
    return (await import("@codemirror/lang-cpp")).cpp();
  if (["js", "jsx", "ts", "tsx", "mjs", "cjs"].includes(ext ?? ""))
    return (await import("@codemirror/lang-javascript")).javascript({
      typescript: ext === "ts" || ext === "tsx",
      jsx: ext === "jsx" || ext === "tsx",
    });
  if (ext === "py") return (await import("@codemirror/lang-python")).python();
  if (ext === "json") return (await import("@codemirror/lang-json")).json();
  if (ext === "rs") return (await import("@codemirror/lang-rust")).rust();
  if (["sh", "bash", "zsh"].includes(ext ?? ""))
    return StreamLanguage.define((await import("@codemirror/legacy-modes/mode/shell")).shell);
  return [];
}

const codeStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.operator], class: "cv-keyword" },
  { tag: tags.comment, class: "cv-comment" },
  { tag: [tags.string, tags.regexp], class: "cv-string" },
  { tag: [tags.number, tags.bool, tags.null], class: "cv-number" },
  { tag: tags.typeName, class: "cv-type" },
  { tag: tags.function(tags.variableName), class: "cv-function" },
  { tag: [tags.propertyName, tags.definition(tags.variableName)], class: "cv-property" },
]);

/** Keep the whole document for syntax parsing and real line numbers; hide only its surroundings. */
export async function createPreviewEditor(
  parent: HTMLElement,
  options: PreviewOptions,
): Promise<PreviewEditor> {
  const lang = await language(options.path);
  const doc = EditorState.create({ doc: options.text }).doc;
  const clamp = (n: number) => Math.max(1, Math.min(doc.lines, n));
  const first = clamp(options.line ?? 1);
  const last = clamp(Math.max(first, options.endLine ?? first));
  let from = Math.max(1, first - 12),
    to = Math.min(doc.lines, last + 12);
  const windowEffect = StateEffect.define<{ from: number; to: number }>();
  const marks = (state: EditorState): DecorationSet => {
    const ranges = [];
    if (from > 1)
      ranges.push(Decoration.replace({ block: true }).range(0, state.doc.line(from).from));
    if (options.line !== undefined) {
      for (let line = first; line <= last; line++)
        ranges.push(Decoration.line({ class: "cm-cited-line" }).range(state.doc.line(line).from));
    }
    if (to < state.doc.lines)
      ranges.push(
        Decoration.replace({ block: true }).range(state.doc.line(to).to, state.doc.length),
      );
    return Decoration.set(ranges, true);
  };
  const windowField = StateField.define<DecorationSet>({
    create: marks,
    update(value, tr) {
      for (const effect of tr.effects)
        if (effect.is(windowEffect)) {
          from = effect.value.from;
          to = effect.value.to;
          options.onWindow(from, to, doc.lines);
          return marks(tr.state);
        }
      return value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  const selectedCode = (state: EditorState): CodeSelection => {
    const selection = state.selection.main;
    const start = selection.empty
      ? doc.line(first).from +
        Math.min(doc.line(first).length, Math.max(0, (options.column ?? 1) - 1))
      : selection.from;
    const end = selection.empty
      ? doc.line(last).from +
        (options.endColumn === undefined
          ? doc.line(last).length
          : Math.min(doc.line(last).length, Math.max(0, options.endColumn - 1)))
      : selection.to;
    const a = doc.lineAt(start),
      b = doc.lineAt(end);
    return {
      line: a.number,
      column: start - a.from + 1,
      endLine: b.number,
      endColumn: end - b.from + 1,
      text: doc.sliceString(start, end),
    };
  };
  const wrapping = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: {
        anchor:
          doc.line(first).from +
          Math.min(doc.line(first).length, Math.max(0, (options.column ?? 1) - 1)),
      },
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorState.phrases.of(options.phrases ?? {}),
        EditorView.contentAttributes.of({ "aria-label": options.codeLabel, tabindex: "0" }),
        lineNumbers(),
        highlightSpecialChars(),
        drawSelection(),
        lang,
        syntaxHighlighting(codeStyle),
        search({ top: true }),
        // Search owns Escape while open; otherwise the host closes the preview.
        keymap.of([
          ...searchKeymap,
          ...defaultKeymap.filter((binding) => binding.key !== "Escape"),
        ]),
        windowField,
        wrapping.of([]),
        EditorView.theme({
          "&": { height: "100%", color: "var(--ui-fg)", backgroundColor: "var(--ui-surface)" },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily: "var(--ui-font-mono)",
            fontSize: "var(--ui-text-code-size)",
            lineHeight: "var(--ui-text-code-lh)",
          },
          ".cm-content": { padding: "12px 0" },
          ".cm-gutters": {
            backgroundColor: "var(--ui-surface-muted)",
            color: "var(--ui-fg-muted)",
            borderRight: "1px solid var(--ui-line)",
          },
          ".cm-lineNumbers .cm-gutterElement": { minWidth: "4em", padding: "0 12px 0 8px" },
          ".cm-cited-line": {
            backgroundColor: "var(--ui-accent-tint)",
            boxShadow: "inset 2px 0 var(--ui-accent)",
          },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
            backgroundColor: "var(--ui-code-selection)",
          },
          ".cm-panels": {
            backgroundColor: "var(--ui-surface-muted)",
            color: "var(--ui-fg)",
            borderColor: "var(--ui-line)",
          },
          ".cm-textfield": {
            backgroundColor: "var(--ui-surface)",
            color: "var(--ui-fg)",
            borderColor: "var(--ui-line)",
          },
        }),
        EditorView.updateListener.of((update) => {
          queueMicrotask(measureAnchor);
          if (!update.selectionSet) return;
          options.onSelection?.(selectedCode(update.state));
          const a = doc.lineAt(update.state.selection.main.from).number;
          const b = doc.lineAt(update.state.selection.main.to).number;
          // Search can select outside the snippet; reveal its result without changing the citation.
          if (a < from || b > to)
            queueMicrotask(() => {
              if (!destroyed)
                view.dispatch({
                  effects: [
                    windowEffect.of({
                      from: Math.min(from, Math.max(1, a - 12)),
                      to: Math.max(to, Math.min(doc.lines, b + 12)),
                    }),
                    EditorView.scrollIntoView(update.state.selection.main, { y: "center" }),
                  ],
                });
            });
        }),
      ],
    }),
  });
  let destroyed = false;
  function measureAnchor() {
    if (destroyed) return;
    view.requestMeasure({
      key: options,
      read: () => {
        const range = selectedCode(view.state);
        const end =
          doc.line(range.endLine).from +
          Math.min(doc.line(range.endLine).length, range.endColumn - 1);
        const rect = view.coordsAtPos(end);
        const viewport = view.scrollDOM.getBoundingClientRect();
        if (!rect || rect.bottom <= viewport.top || rect.top >= viewport.bottom) return null;
        const gutter = view.dom.querySelector(".cm-gutters")?.getBoundingClientRect();
        const left = Math.max(viewport.left + 8, (gutter?.right ?? viewport.left + 48) + 8);
        return {
          top: rect.top,
          bottom: rect.bottom,
          left,
          right: left + 1,
          triggerLeft: Math.max(left, Math.min(viewport.right - 64, rect.right + 12)),
        };
      },
      write: (anchor) => options.onAnchor?.(anchor),
    });
  }
  view.scrollDOM.addEventListener("scroll", measureAnchor, { passive: true });

  let measuredHeight = -1;
  // Keep the selected code visible when the preview viewport changes size.
  const resize = new ResizeObserver(([entry]) => {
    if (!entry || entry.contentRect.height === measuredHeight) return;
    measuredHeight = entry.contentRect.height;
    measureAnchor();
    queueMicrotask(() => {
      if (!destroyed)
        view.dispatch({
          effects: EditorView.scrollIntoView(view.state.selection.main, { y: "center" }),
        });
    });
  });
  resize.observe(parent);
  measureAnchor();
  options.onWindow(from, to, doc.lines);
  options.onSelection?.(selectedCode(view.state));
  view.dispatch({
    effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" }),
  });
  return {
    revealSelection() {
      const range = selectedCode(view.state);
      const position =
        (range.endLine - range.line + 1) * 24 < parent.clientHeight / 2
          ? doc.line(range.line).from + range.column - 1
          : doc.line(range.endLine).from + range.endColumn - 1;
      view.dispatch({ effects: EditorView.scrollIntoView(position, { y: "start", yMargin: 24 }) });
      measureAnchor();
    },
    focus() {
      view.focus();
    },
    selection() {
      return selectedCode(view.state);
    },
    expand(direction) {
      view.dispatch({
        effects: windowEffect.of({
          from: direction === "all" ? 1 : direction === "up" ? Math.max(1, from - 40) : from,
          to:
            direction === "all"
              ? doc.lines
              : direction === "down"
                ? Math.min(doc.lines, to + 40)
                : to,
        }),
      });
    },
    wrap(enabled) {
      view.dispatch({ effects: wrapping.reconfigure(enabled ? EditorView.lineWrapping : []) });
    },
    search() {
      openSearchPanel(view);
    },
    copy() {
      return selectedCode(view.state).text;
    },
    destroy() {
      destroyed = true;
      resize.disconnect();
      view.scrollDOM.removeEventListener("scroll", measureAnchor);
      view.destroy();
    },
  };
}
