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

interface TablePreview {
  headers: string[];
  rows: { number: number; cells: string[] }[];
}

export interface MergePreview extends TablePreview {
  report: string;
}

export interface TransformPreview extends TablePreview {
  input: string | null;
  changed: number;
  examples: [string, string][];
}

class ExactNumber {
  constructor(
    readonly source: string,
    readonly exact = true,
  ) {}
}

function renderCell(value: unknown, compact = false): string {
  const space = compact ? "" : " ";
  const separator = compact ? "," : ", ";
  if (value instanceof ExactNumber) {
    if (compact && !value.exact) throw new Error("Original numeric token unavailable");
    return value.source;
  }
  if (Array.isArray(value))
    return `[${value.map((item) => renderCell(item, compact)).join(separator)}]`;
  if (value !== null && typeof value === "object") {
    const fields = Object.entries(value).map(
      ([key, item]) => `${JSON.stringify(key)}:${space}${renderCell(item, compact)}`,
    );
    return `{${fields.join(separator)}}`;
  }
  return JSON.stringify(value);
}

function encodeTableInput(headers: string[], rows: unknown[][]): string | null {
  try {
    return `{"headers":${JSON.stringify(headers)},"rows":${renderCell(rows, true)}}`;
  } catch {
    return null;
  }
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

function readTableResult(text: string) {
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
        return new ExactNumber(JSON.stringify(value), false);
      },
    );
    const result = object(parsed);
    const table = object(result?.data);
    const headers = table?.headers;
    const rows = table?.rows;
    if (
      !result ||
      !Array.isArray(headers) ||
      headers.length === 0 ||
      headers.length > columnLimit ||
      headers.some((header) => typeof header !== "string" || !header.trim()) ||
      new Set(headers).size !== headers.length ||
      !Array.isArray(rows) ||
      rows.length > rowLimit ||
      !rows.every((row) => Array.isArray(row) && row.length === headers.length)
    )
      return null;

    return { result, headers: headers as string[], rows: rows as unknown[][] };
  } catch {
    return null;
  }
}

function previewRows(rows: unknown[][]): TablePreview["rows"] {
  return rows.map((row, index) => ({
    number: index + 1,
    cells: row.map((cell) => renderCell(cell)),
  }));
}

export function dataMergePreview(text: string): MergePreview | null {
  const table = readTableResult(text);
  const report = table?.result.report;
  if (
    !table ||
    typeof report !== "string" ||
    !report.trim() ||
    typeof table.result.csv !== "string"
  )
    return null;
  try {
    return { report, headers: table.headers, rows: previewRows(table.rows) };
  } catch {
    return null;
  }
}

export function dataTransformPreview(text: string): TransformPreview | null {
  const table = readTableResult(text);
  if (!table) return null;
  const { result, headers, rows } = table;
  const { changed: count, examples } = result;
  if (
    !(count instanceof ExactNumber) ||
    !Array.isArray(examples) ||
    examples.length > 6 ||
    !examples.every(stringPair)
  )
    return null;

  const changed = Number(count.source);
  try {
    if (!Number.isInteger(changed) || changed < 0 || changed > Math.max(rowLimit, columnLimit))
      return null;
    const distinctExamples = [
      ...new Map(examples.map((pair) => [JSON.stringify(pair), pair])).values(),
    ];
    return {
      input: encodeTableInput(headers, rows),
      headers,
      rows: previewRows(rows),
      changed,
      examples: distinctExamples,
    };
  } catch {
    return null;
  }
}
