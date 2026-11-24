import type { TransformPreview } from "./data-transform-result";

const outputSources = new Set([
  "trim",
  "lower",
  "upper",
  "empty_null",
  "fill_null",
  "rename",
  "text",
  "integer",
  "number",
  "bool",
  "select",
]);
const prefix = "devtools.compute.transform.";
const inputFormats = new Set(["csv", "tsv", "json"]);
const optionFields = new Set(["format", "column", "value", "keep"]);

interface TransformOptions {
  format: "csv" | "tsv" | "json";
  column: string;
  value?: string;
  keep?: string[];
}

export interface TransformInput {
  text: string;
  options: string;
}

function parseOptions(source: string): TransformOptions | null {
  try {
    const options = JSON.parse(source);
    if (
      options === null ||
      Array.isArray(options) ||
      typeof options !== "object" ||
      !Object.keys(options).every((key) => optionFields.has(key)) ||
      !inputFormats.has(options.format) ||
      typeof options.column !== "string" ||
      ("value" in options && typeof options.value !== "string") ||
      ("keep" in options &&
        (!Array.isArray(options.keep) ||
          !options.keep.every((name: unknown) => typeof name === "string")))
    ) {
      return null;
    }
    return options;
  } catch {
    return null;
  }
}

export function prepareTransformApply(
  capabilityId: string,
  source: Record<string, string>,
  table: TransformPreview,
): TransformInput | null {
  if (!capabilityId.startsWith(prefix) || !table.input) return null;
  const operation = capabilityId.slice(prefix.length);
  if (!outputSources.has(operation)) return null;
  const options = parseOptions(source.options);
  if (!options) return null;

  if (operation === "select") {
    if (
      !options.keep?.length ||
      new Set(options.keep).size !== table.headers.length ||
      !options.keep.every((name) => table.headers.includes(name))
    )
      return null;
  } else if (!table.headers.includes(options.column)) {
    if (operation !== "rename" || table.changed !== 1 || table.examples.length !== 1) return null;
    const [before, after] = table.examples[0];
    if (before !== options.column || !table.headers.includes(after)) return null;
    options.column = after;
  }

  options.format = "json";
  const adjusted = JSON.stringify(options);
  const encoder = new TextEncoder();
  // Limits of the frozen Compute text/options contract, in UTF-8 bytes.
  if (encoder.encode(table.input).length > 8192 || encoder.encode(adjusted).length > 16384)
    return null;
  return { text: table.input, options: adjusted };
}
