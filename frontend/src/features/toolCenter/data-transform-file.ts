import type { TransformInput } from "./data-transform-apply";

const maxFileBytes = 8192; // Frozen Compute input limit in UTF-8 bytes.
const formats = new Set(["csv", "tsv", "json"]);

export async function readTransformFile(file: File, previousOptions = ""): Promise<TransformInput> {
  const format = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!file.name.includes(".") || !formats.has(format)) {
    throw Error("Choose a CSV, TSV, or JSON file.");
  }
  if (file.size > maxFileBytes) throw Error("Table files must be 8 KiB or smaller.");

  // Keep the rest of the existing operation settings. Existing invalid settings
  // must stay available for editing instead of being silently replaced.
  let settings: Record<string, unknown>;
  try {
    const parsed: unknown = previousOptions.trim() ? JSON.parse(previousOptions) : {};
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw Error();
    settings = parsed as Record<string, unknown>;
    for (const [key, value] of Object.entries(settings)) {
      if (key === "keep" ? Array.isArray(value) && value.every(item => typeof item === "string")
        : ["format", "column", "value"].includes(key) && typeof value === "string") continue;
      throw Error();
    }
  } catch {
    throw Error("Fix the tool options before importing a file.");
  }
  const adjusted = settings.format === format ? previousOptions : JSON.stringify({ ...settings, format });
  if (new TextEncoder().encode(adjusted).length > 16384) {
    throw Error("Tool options must be 16 KiB or smaller.");
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
  return { text, options: adjusted };
}
