export interface PreviewEditor {
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
    onWindow(from: number, to: number, total: number): void;
  },
): Promise<PreviewEditor>;
