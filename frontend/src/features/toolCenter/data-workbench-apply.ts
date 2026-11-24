import type { TransformInput } from "./data-transform-apply";
import { validTableHeaders, workbenchJsonTableInput } from "./data-transform-result";
import { type TableFileFormat, tableFileFormats, tableSettings } from "./manual-tool-file";

const prefix = "devtools.compute.table.";
const fileLimit = 8192;
const optionLimit = 16384;
const resultLimit = 48 * 1024;

export interface WorkbenchDraft extends TransformInput {
  format: TableFileFormat;
}

function knownFormat(candidate: unknown): candidate is TableFileFormat {
  return tableFileFormats.some((format) => format === candidate);
}

export function prepareWorkbenchApply(
  capabilityId: string,
  source: Record<string, string>,
  output: string,
): WorkbenchDraft | null {
  const bytes = new TextEncoder();
  if (
    !capabilityId.startsWith(prefix) ||
    output.length > resultLimit ||
    bytes.encode(output).length > resultLimit
  )
    return null;
  try {
    const options = tableSettings(source.options, "workbench");
    if (!knownFormat(options.format)) return null;
    const operation = capabilityId.slice(prefix.length);
    const expected = operation === "query" ? options.output || "json" : operation;
    if (
      !knownFormat(expected) ||
      (operation !== "query" && operation !== "json" && operation !== "csv")
    )
      return null;

    const result = JSON.parse(output);
    const { inputRows, selectedRows, columns, format, text } = result;
    if (
      format !== expected ||
      typeof text !== "string" ||
      !text.trim() ||
      !validTableHeaders(columns) ||
      !Number.isInteger(inputRows) ||
      inputRows < 0 ||
      inputRows > 10_000 ||
      !Number.isInteger(selectedRows) ||
      selectedRows < 0 ||
      selectedRows > inputRows ||
      (typeof options.sort === "string" && options.sort !== "" && !columns.includes(options.sort))
    )
      return null;

    const table = format === "json" ? workbenchJsonTableInput(columns, text, selectedRows) : text;
    const settings =
      options.format === format ? source.options : JSON.stringify({ ...options, format });
    if (
      table === null ||
      bytes.encode(table).length > fileLimit ||
      bytes.encode(settings).length > optionLimit
    )
      return null;
    return { text: table, options: settings, format };
  } catch {
    return null;
  }
}
