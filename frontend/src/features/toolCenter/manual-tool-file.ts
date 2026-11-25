export const tableFileFormats = ["csv", "tsv", "json"] as const;
export type TableFileFormat = typeof tableFileFormats[number];
export type ToolFileTarget = "transform" | "workbench" | "left" | "right" | "merge-left" | "merge-right" | "json-path" | "sql-format" | "yaml-to-json" | "yaml-from-json" | "utf8-bytes" | "base64-decode" | "utf8-text" | "url-inspect" | "qr-source" | "diff-left" | "diff-right" | "json-diff-left" | "json-diff-right" | "schema-instance" | "schema-root" | "spring-config-baseline" | "spring-config-comparison" | TableFileFormat;
type TableSettings = Record<string, string | string[] | boolean>;

const maxFileBytes = 8192; // The frozen tool document input limit.
const jsonFileFields = new Map<ToolFileTarget, string>([
  ["json-path", "text"],
  ["yaml-from-json", "text"],
  ["json-diff-left", "left"],
  ["json-diff-right", "right"],
  ["schema-instance", "instance"],
  ["schema-root", "schema"],
]);
const formatError = {
  csv: "Choose a CSV file.",
  tsv: "Choose a TSV file.",
  json: "Choose a JSON file.",
};
const transformOptions = new Set(["format", "column", "value"]);
const workbenchOptions = new Set(["format", "query", "sort", "output"]);
const mergeOptions = new Set(["format", "left_key", "right_key", "right"]);

export function tableSettings(source: string, target: ToolFileTarget): TableSettings {
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

export async function readManualToolFile(
  file: File, values: Record<string, string>, target: ToolFileTarget, choices?: readonly unknown[],
): Promise<Record<string, string>> {
  if (target === "diff-left" || target === "diff-right") {
    const sizeError = "Text files must be 8 KiB or smaller.";
    if (file.size > maxFileBytes) throw Error(sizeError);
    const text = await readUtf8ToolFile(file, sizeError, "Could not read the text file.");
    return target === "diff-left" ? { left: text } : { right: text };
  }

  if (target === "qr-source") {
    return { text: await readUtf8ToolFile(file, "QR input files must be 2 KiB or smaller.", "Could not read the text file.", 2048, true) };
  }

  if (target === "utf8-bytes" || target === "base64-decode" || target === "utf8-text" || target === "url-inspect") {
    const preserveBom = target === "utf8-bytes";
    const text = await readUtf8ToolFile(file, "Text files must be 8 KiB or smaller.", "Could not read the text file.", maxFileBytes, preserveBom);
    if (target === "url-inspect") {
      const url = text.trim();
      if (!url || /[\r\n]/.test(url)) throw Error("Choose a text file containing one URL.");
    }
    return { text: target === "base64-decode" ? text.replace(/[\r\n]/g, "") : text };
  }

  const name = file.name.toLowerCase();
  if (target === "sql-format") {
    if (!name.endsWith(".sql")) throw Error("Choose a SQL file.");
    const text = await readUtf8ToolFile(file, "SQL files must be 8 KiB or smaller.", "Could not read the SQL file.");
    if (!text.trim()) throw Error("The selected SQL file is empty.");
    return { text };
  }
  if (target === "yaml-to-json") {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) throw Error("Choose a YAML file.");
    const text = await readUtf8ToolFile(file, "YAML files must be 8 KiB or smaller.", "Could not read the YAML file.");
    if (!text.trim()) throw Error("The selected YAML file is empty.");
    return { text };
  }
  if (target === "spring-config-baseline" || target === "spring-config-comparison") {
    if (!name.endsWith(".json") && !name.endsWith(".yaml") && !name.endsWith(".yml")) {
      throw Error("Choose a JSON or YAML configuration file.");
    }
    const text = await readUtf8ToolFile(file, "Configuration files must be 8 KiB or smaller.", "Could not read the configuration file.");
    if (!text.trim()) throw Error("The selected configuration file is empty.");
    return target === "spring-config-baseline" ? { text } : { secondary: text };
  }
  const format = tableFileFormats.find(extension => name.endsWith("." + extension));
  const jsonField = jsonFileFields.get(target);
  const jsonDocument = jsonField !== undefined;
  const fixedFormat = jsonDocument ? "json" : tableFileFormats.find(extension => extension === target);
  if (fixedFormat && format !== fixedFormat) throw Error(formatError[fixedFormat]);
  if (!format) {
    throw Error("Choose a CSV, TSV, or JSON file.");
  }
  const sizeError = jsonDocument ? "JSON files must be 8 KiB or smaller." : "Table files must be 8 KiB or smaller.";
  if (file.size > maxFileBytes) throw Error(sizeError);

  const mergeSide = target === "merge-left" ? "left" : target === "merge-right" ? "right" : undefined;
  const choice = mergeSide ? choices?.indexOf(format) ?? -1 : -1;
  if (mergeSide && choice === -1) throw Error("This tool does not accept the selected table format.");

  const previousOptions = values.options ?? "";
  const settings = fixedFormat || mergeSide ? {} : tableSettings(previousOptions, target);
  const otherTable = target === "left" ? settings.right : target === "right" ? values.text : undefined;
  if (typeof otherTable === "string" && otherTable.trim() && settings.format && settings.format !== format) {
    throw Error("Both tables must use the same file format.");
  }

  const text = await readUtf8ToolFile(file, sizeError,
    jsonDocument ? "Could not read the JSON file." : "Could not read the table file.");
  if (!text.trim()) throw Error(jsonDocument ? "The selected JSON file is empty." : "The selected table file is empty.");

  if (fixedFormat) return { [jsonField ?? "text"]: text };
  if (mergeSide) return { [mergeSide]: text, [mergeSide + "Format"]: String(choice) };

  const options = target === "right" ? JSON.stringify({ ...settings, format, right: text })
    : settings.format === format ? previousOptions : JSON.stringify({ ...settings, format });
  if (new TextEncoder().encode(options).length > 16384) {
    throw Error("Tool options must be 16 KiB or smaller.");
  }
  return target === "right" ? { options } : { text, options };
}

export async function readUtf8ToolFile(
  file: File, sizeError: string, readError: string, maxBytes = maxFileBytes, preserveBom = false,
): Promise<string> {
  if (file.size > maxBytes) throw Error(sizeError);
  let data: ArrayBuffer;
  try {
    data = await file.slice(0, maxBytes + 1).arrayBuffer();
  } catch {
    throw Error(readError);
  }
  if (data.byteLength > maxBytes) throw Error(sizeError);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: preserveBom }).decode(data);
  } catch {
    throw Error("The file must contain valid UTF-8 text.");
  }
}
