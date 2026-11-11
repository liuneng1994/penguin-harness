export interface CodeAnchor {
  top: number;
  bottom: number;
  left: number;
  right: number;
  triggerLeft: number;
}
export interface CodeSelection {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  text: string;
}
export interface GitChange {
  line: number;
  added: Array<{ line: number; words: readonly (readonly [number, number])[] }>;
  removed: Array<{ line: number; text: string }>;
}
export interface PreviewEditor {
  revealSelection(): void;
  focus(): void;
  selection(): CodeSelection;
  changes(changes: GitChange[]): void;
  nextChange(direction: -1 | 1): void;
  wrap(enabled: boolean): void;
  search(): void;
  copy(): string;
  destroy(): void;
}
export function createPreviewEditor(
  parent: HTMLElement,
  options: {
    text: string;
    path: string;
    codeLabel: string;
    phrases?: Record<string, string>;
    changes?: GitChange[];
    changeLabels?: { add: string; modify: string; delete: string };
    renderRemoved?: (parent: HTMLElement, change: GitChange) => () => void;
    line?: number;
    column?: number;
    endLine?: number;
    endColumn?: number;
    onAnchor?: (anchor: CodeAnchor | null) => void;
    onSelection?: (selection: CodeSelection) => void;
  },
): Promise<PreviewEditor>;
