import type { ManualTool } from "./manual-tools";

const byteLimit = 48 * 1024; // The Compute Worker returns at most 48 KiB.
const columnLimit = 128;
const rowLimit = 10_000;

export function isDataTransform(tool: Pick<ManualTool, "pluginId" | "capabilityId">): boolean {
  return (
    tool.pluginId === "com.zicode.devtools.compute" &&
    tool.capabilityId.startsWith("devtools.compute.transform.")
  );
}

interface TransformPreview {
  headers: string[];
  rows: { number: number; cells: string[] }[];
  changed: number;
  examples: [string, string][];
}

class ExactNumber {
  constructor(readonly source: string) {}
}

function renderCell(value: unknown): string {
  if (value instanceof ExactNumber) return value.source;
  if (Array.isArray(value)) return `[${value.map(renderCell).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const fields = Object.entries(value).map(
      ([key, item]) => `${JSON.stringify(key)}: ${renderCell(item)}`,
    );
    return `{${fields.join(", ")}}`;
  }
  return JSON.stringify(value);
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringPair(value: unknown): value is [string, string] {
  return (
    Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === "string")
  );
}

export function dataTransformPreview(text: string): TransformPreview | null {
  if (text.length > byteLimit || new TextEncoder().encode(text).length > byteLimit) return null;
  try {
    const parsed: unknown = JSON.parse(
      text,
      (_key, value: unknown, context?: { source?: string }) => {
        if (typeof value !== "number") return value;
        // Older engines do not expose the original token. Prefer the full text
        // view if that engine has already rounded an integer in a table cell.
        if (context?.source) return new ExactNumber(context.source);
        if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
          throw new Error("Numeric token unavailable");
        }
        return new ExactNumber(JSON.stringify(value));
      },
    );
    const result = object(parsed);
    const table = object(result?.data);
    const headers = table?.headers;
    const rows = table?.rows;
    const examples = result?.examples;
    const count = result?.changed;
    if (
      !(count instanceof ExactNumber) ||
      !Array.isArray(headers) ||
      headers.length === 0 ||
      headers.length > columnLimit ||
      headers.some((header) => typeof header !== "string" || !header.trim()) ||
      new Set(headers).size !== headers.length ||
      !Array.isArray(rows) ||
      rows.length > rowLimit ||
      !rows.every((row) => Array.isArray(row) && row.length === headers.length) ||
      !Array.isArray(examples) ||
      examples.length > 6 ||
      !examples.every(stringPair)
    )
      return null;

    const changed = Number(count.source);
    if (!Number.isInteger(changed) || changed < 0 || changed > Math.max(rowLimit, columnLimit))
      return null;
    const previewRows = rows.map((row, index) => ({
      number: index + 1,
      cells: row.map(renderCell),
    }));
    const distinctExamples = [
      ...new Map(examples.map((pair) => [JSON.stringify(pair), pair])).values(),
    ];
    return { headers, rows: previewRows, changed, examples: distinctExamples };
  } catch {
    return null;
  }
}
