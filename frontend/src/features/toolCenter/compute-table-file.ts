export type TableFileTarget = "transform" | "left" | "right";

const maxFileBytes = 8192; // Frozen Compute input limit in UTF-8 bytes.
const formats = new Set(["csv", "tsv", "json"]);
const transformOptions = new Set(["format", "column", "value"]);
const mergeOptions = new Set(["format", "left_key", "right_key", "right"]);

function tableSettings(source: string, target: TableFileTarget): Record<string, string | string[]> {
  try {
    const parsed: unknown = source.trim() ? JSON.parse(source) : {};
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw Error();
    const keys = target === "transform" ? transformOptions : mergeOptions;
    for (const [key, value] of Object.entries(parsed)) {
      if (keys.has(key) && typeof value === "string") continue;
      if (target === "transform" && key === "keep" && Array.isArray(value) &&
          value.every(item => typeof item === "string")) continue;
      throw Error();
    }
    return parsed as Record<string, string | string[]>;
  } catch {
    throw Error("Fix the tool options before importing a file.");
  }
}

export async function readComputeTableFile(
  file: File, values: Record<string, string>, target: TableFileTarget,
): Promise<Record<string, string>> {
  const format = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!file.name.includes(".") || !formats.has(format)) {
    throw Error("Choose a CSV, TSV, or JSON file.");
  }
  if (file.size > maxFileBytes) throw Error("Table files must be 8 KiB or smaller.");

  const previousOptions = values.options ?? "";
  const settings = tableSettings(previousOptions, target);
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

  const options = target === "right" ? JSON.stringify({ ...settings, format, right: text })
    : settings.format === format ? previousOptions : JSON.stringify({ ...settings, format });
  if (new TextEncoder().encode(options).length > 16384) {
    throw Error("Tool options must be 16 KiB or smaller.");
  }
  return target === "right" ? { options } : { text, options };
}
