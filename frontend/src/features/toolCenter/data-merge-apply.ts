import { prepareToolInput, type ToolField } from "./manual-tool-fields";

export type MergeSide = "left" | "right";

export function prepareMergeApply(
  side: MergeSide,
  fields: ToolField[],
  source: Record<string, string>,
  input: string | null,
): Record<string, string> | null {
  if (input === null || new TextEncoder().encode(input).length > 8192) return null;
  const formatKey = side === "left" ? "leftFormat" : "rightFormat";
  const table = fields.find((field) => field.key === side);
  const format = fields.find((field) => field.key === formatKey);
  const json = format?.choices?.indexOf("json") ?? -1;
  if (table?.kind !== "string" || table.choices || json < 0) return null;
  const next = { [side]: input, [formatKey]: String(json) };
  return "error" in prepareToolInput(fields, { ...source, ...next }) ? null : next;
}
