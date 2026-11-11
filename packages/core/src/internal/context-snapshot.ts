/** Visible main-context data for a side request, without reasoning or transport fidelity. */
import type { AmspRecord } from "@prismshadow/amsp/records";
export function contextRecords(records: readonly AmspRecord[]): unknown[] {
  return records.flatMap((record) => {
    if (record.origin?.length) return [];
    const p = record.payload as {
      role?: string;
      type?: string;
      text?: string;
      name?: string;
      arguments?: string;
      output?: string;
    };
    if (!["text", "tool_call", "tool_call_output"].includes(p.type ?? "")) return [];
    const item = {
      role: p.role,
      type: p.type,
      ...(p.text !== undefined ? { text: p.text } : {}),
      ...(p.name !== undefined ? { name: p.name, arguments: p.arguments } : {}),
      ...(p.output !== undefined ? { output: p.output } : {}),
    };
    return [item];
  });
}
