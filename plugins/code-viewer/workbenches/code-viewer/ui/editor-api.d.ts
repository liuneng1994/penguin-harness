export interface CodeSelection {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  text: string;
}
export interface PreviewEditor {
  selection(): CodeSelection;
  expand(direction: "up" | "down" | "all"): void;
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
    line?: number;
    column?: number;
    endLine?: number;
    endColumn?: number;
    onSelection?: (selection: CodeSelection) => void;
    onWindow(from: number, to: number, total: number): void;
  },
): Promise<PreviewEditor>;
