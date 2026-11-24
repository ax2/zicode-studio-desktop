export const tableFileFormats = ["csv", "tsv", "json"] as const;
type TableFileFormat = typeof tableFileFormats[number];
export type TableFileTarget = "transform" | "workbench" | "left" | "right" | TableFileFormat;
type TableSettings = Record<string, string | string[] | boolean>;

const maxFileBytes = 8192; // Frozen Compute input limit in UTF-8 bytes.
const formatError = {
  csv: "Choose a CSV file.",
  tsv: "Choose a TSV file.",
  json: "Choose a JSON file.",
};
const transformOptions = new Set(["format", "column", "value"]);
const workbenchOptions = new Set(["format", "query", "sort", "output"]);
const mergeOptions = new Set(["format", "left_key", "right_key", "right"]);

function tableSettings(source: string, target: TableFileTarget): TableSettings {
  try {
    const parsed: unknown = source.trim() ? JSON.parse(source) : {};
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw Error();
    const keys = target === "transform" ? transformOptions : target === "workbench" ? workbenchOptions : mergeOptions;
    for (const [key, value] of Object.entries(parsed)) {
      if (keys.has(key) && typeof value === "string") continue;
      if (target === "workbench" && key === "descending" && typeof value === "boolean") continue;
      if (target === "transform" && key === "keep" && Array.isArray(value) &&
          value.every(item => typeof item === "string")) continue;
      throw Error();
    }
    return parsed as TableSettings;
  } catch {
    throw Error("Fix the tool options before importing a file.");
  }
}

export async function readComputeTableFile(
  file: File, values: Record<string, string>, target: TableFileTarget,
): Promise<Record<string, string>> {
  const name = file.name.toLowerCase();
  const format = tableFileFormats.find(extension => name.endsWith("." + extension));
  const fixedFormat = tableFileFormats.find(extension => extension === target);
  if (fixedFormat && format !== fixedFormat) throw Error(formatError[fixedFormat]);
  if (!format) {
    throw Error("Choose a CSV, TSV, or JSON file.");
  }
  if (file.size > maxFileBytes) throw Error("Table files must be 8 KiB or smaller.");

  const previousOptions = values.options ?? "";
  const settings = fixedFormat ? {} : tableSettings(previousOptions, target);
  const otherTable = target === "left" ? settings.right : target === "right" ? values.text : undefined;
  if (typeof otherTable === "string" && otherTable.trim() && settings.format && settings.format !== format) {
    throw Error("Both tables must use the same file format.");
  }

  let data: ArrayBuffer;
  try {
    data = await file.slice(0, maxFileBytes + 1).arrayBuffer();
  } catch {
    throw Error("Could not read the table file.");
  }
  if (data.byteLength > maxFileBytes) throw Error("Table files must be 8 KiB or smaller.");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw Error("The file must contain valid UTF-8 text.");
  }
  if (!text.trim()) throw Error("The selected table file is empty.");

  if (fixedFormat) return { text };

  const options = target === "right" ? JSON.stringify({ ...settings, format, right: text })
    : settings.format === format ? previousOptions : JSON.stringify({ ...settings, format });
  if (new TextEncoder().encode(options).length > 16384) {
    throw Error("Tool options must be 16 KiB or smaller.");
  }
  return target === "right" ? { options } : { text, options };
}
