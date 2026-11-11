import { Compartment, EditorState, RangeSet, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  lineNumbers,
  highlightSpecialChars,
  drawSelection,
  gutter,
  GutterMarker,
  WidgetType,
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
export interface GitChange {
  line: number;
  added: Array<{ line: number; words: readonly (readonly [number, number])[] }>;
  removed: Array<{ line: number; text: string }>;
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
  changes?: GitChange[];
  changeLabels?: { add: string; modify: string; delete: string };
  renderRemoved?: (parent: HTMLElement, change: GitChange) => () => void;
  onAnchor?: (anchor: CodeAnchor | null) => void;
  onSelection?: (selection: CodeSelection) => void;
  onWindow: (from: number, to: number, total: number) => void;
}
export interface PreviewEditor {
  revealSelection(): void;
  focus(): void;
  selection(): CodeSelection;
  changes(changes: GitChange[]): void;
  nextChange(direction: -1 | 1): void;
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
  let selectionTouched = false;
  let changes = options.changes ?? [];
  const windowEffect = StateEffect.define<{ from: number; to: number }>();
  const changeEffect = StateEffect.define<GitChange[]>();
  const widgetMounts = new WeakMap<
    HTMLElement,
    { cleanup: () => void; observer: ResizeObserver }
  >();
  class RemovedWidget extends WidgetType {
    constructor(readonly change: GitChange) {
      super();
    }
    eq(other: RemovedWidget) {
      return other.change === this.change;
    }
    toDOM(view: EditorView) {
      const dom = document.createElement("div");
      const cleanup = options.renderRemoved?.(dom, this.change) ?? (() => {});
      const observer = new ResizeObserver(() => view.requestMeasure());
      observer.observe(dom);
      widgetMounts.set(dom, { cleanup, observer });
      return dom;
    }
    destroy(dom: HTMLElement) {
      const mounted = widgetMounts.get(dom);
      mounted?.observer.disconnect();
      queueMicrotask(() => mounted?.cleanup());
    }
  }
  const position = (line: number, state: EditorState) =>
    state.doc.line(Math.max(1, Math.min(state.doc.lines, line))).from;
  const marks = (state: EditorState): DecorationSet => {
    const ranges = [];
    if (from > 1)
      ranges.push(Decoration.replace({ block: true }).range(0, state.doc.line(from).from));
    if (options.line !== undefined) {
      for (let line = first; line <= last; line++)
        ranges.push(Decoration.line({ class: "cm-cited-line" }).range(state.doc.line(line).from));
    }
    for (const change of changes) {
      for (const added of change.added) {
        if (added.line < from || added.line > to) continue;
        const start = position(added.line, state);
        ranges.push(
          Decoration.line({ class: change.removed.length ? "cm-git-modify" : "cm-git-add" }).range(
            start,
          ),
        );
        for (const [a, b] of added.words)
          if (b > a)
            ranges.push(Decoration.mark({ class: "cm-git-word" }).range(start + a, start + b));
      }
      if (change.removed.length && change.line >= from && change.line <= to + 1) {
        const lastAdded = change.added.at(-1)?.line;
        const atEnd = change.line > state.doc.lines;
        const after = lastAdded !== undefined || atEnd;
        const at =
          lastAdded !== undefined
            ? state.doc.line(Math.min(state.doc.lines, lastAdded)).to
            : atEnd
              ? state.doc.length
              : position(change.line, state);
        ranges.push(
          Decoration.widget({
            widget: new RemovedWidget(change),
            block: true,
            side: after ? 1 : -1,
          }).range(at),
        );
      }
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
      if (
        tr.selection &&
        (tr.isUserEvent("select.pointer") ||
          (tr.isUserEvent("select") && !tr.startState.selection.eq(tr.state.selection)))
      )
        selectionTouched = true;
      let changed = false;
      for (const effect of tr.effects) {
        if (effect.is(changeEffect)) {
          changes = effect.value;
          changed = true;
        }
        if (effect.is(windowEffect)) {
          from = effect.value.from;
          to = effect.value.to;
          options.onWindow(from, to, doc.lines);
          changed = true;
        }
      }
      return changed ? marks(tr.state) : value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  class ChangeMarker extends GutterMarker {
    constructor(readonly kind: "add" | "modify" | "delete") {
      super();
    }
    toDOM() {
      const node = document.createElement("span");
      node.textContent = { add: "+", modify: "~", delete: "−" }[this.kind];
      node.setAttribute("aria-label", options.changeLabels?.[this.kind] ?? this.kind);
      node.setAttribute("role", "img");
      node.dataset.tooltip = options.changeLabels?.[this.kind] ?? this.kind;
      return node;
    }
    eq(other: ChangeMarker) {
      return other.kind === this.kind;
    }
  }
  const changeGutter = gutter({
    class: "cm-git-gutter",
    markers: (view) => {
      const markers = new Map<number, "add" | "modify" | "delete">();
      for (const change of changes) {
        if (!change.added.length) markers.set(position(change.line, view.state), "delete");
        for (const added of change.added)
          markers.set(position(added.line, view.state), change.removed.length ? "modify" : "add");
      }
      return RangeSet.of(
        [...markers]
          .sort((a, b) => a[0] - b[0])
          .map(([at, kind]) => new ChangeMarker(kind).range(at)),
      );
    },
    lineMarkerChange: (update) =>
      update.transactions.some((tr) => tr.effects.some((effect) => effect.is(changeEffect))),
  });
  const selectedCode = (state: EditorState): CodeSelection => {
    const selection = state.selection.main;
    const startLine = selectionTouched ? doc.lineAt(selection.head) : doc.line(first);
    const endLine = selectionTouched ? startLine : doc.line(last);
    const start = selection.empty
      ? startLine.from +
        (selectionTouched ? 0 : Math.min(startLine.length, Math.max(0, (options.column ?? 1) - 1)))
      : selection.from;
    const end = selection.empty
      ? endLine.from +
        (selectionTouched || options.endColumn === undefined
          ? endLine.length
          : Math.min(endLine.length, Math.max(0, options.endColumn - 1)))
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
        changeGutter,
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
          ".cm-git-add, .cm-git-modify, .cm-cited-line.cm-git-add, .cm-cited-line.cm-git-modify": {
            backgroundColor: "var(--ui-diff-add-bg)",
          },
          ".cm-git-word": { backgroundColor: "var(--ui-diff-add-word)" },
          ".cm-git-gutter .cm-gutterElement": { minWidth: "1.5em", textAlign: "center" },
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
  // Git markers convey changes; only the decorative line-number gutter stays hidden.
  view.dom.querySelector(".cm-gutters")?.removeAttribute("aria-hidden");
  view.dom.querySelector(".cm-lineNumbers")?.setAttribute("aria-hidden", "true");
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
        const viewport = view.scrollDOM.getBoundingClientRect();
        const gutter = view.dom.querySelector(".cm-gutters")?.getBoundingClientRect();
        const left = Math.max(viewport.left + 8, (gutter?.right ?? viewport.left + 48) + 8);
        let rect = view.coordsAtPos(end, -1);
        if (!rect || rect.bottom > viewport.bottom || rect.top < viewport.top) {
          const visible = view.posAtCoords({
            x: left,
            y: viewport.bottom - view.defaultLineHeight / 2,
          });
          const start = doc.line(range.line).from + range.column - 1;
          rect = view.coordsAtPos(Math.max(start, Math.min(end, visible ?? end)));
        }
        if (!rect || rect.bottom <= viewport.top || rect.top >= viewport.bottom) return null;
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
        (range.endLine - range.line + 1) * view.defaultLineHeight < parent.clientHeight / 2
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
    changes(value) {
      view.dispatch({ effects: changeEffect.of(value) });
    },
    nextChange(direction) {
      const line = doc.lineAt(view.state.selection.main.head).number;
      const ordered = [...changes].sort((a, b) => a.line - b.line);
      const target =
        direction === 1
          ? (ordered.find((change) => change.line > line) ?? ordered[0])
          : (ordered.findLast((change) => change.line < line) ?? ordered.at(-1));
      if (!target) return;
      const at = Math.max(1, Math.min(doc.lines, target.line));
      view.dispatch({
        selection: { anchor: doc.line(at).from },
        effects: [
          windowEffect.of({
            from: Math.min(from, Math.max(1, at - 12)),
            to: Math.max(to, Math.min(doc.lines, at + 12)),
          }),
          EditorView.scrollIntoView(doc.line(at).from, { y: "center" }),
        ],
        userEvent: "select",
      });
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
