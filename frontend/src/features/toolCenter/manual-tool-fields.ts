import { textFields } from "./manual-tools";
import { editableJsonSchema, parseToolJson, type ToolInputValue } from "./tool-json-input";

export type ToolScalar = string | number | boolean;
export interface ToolField {
  key: string; label: string; description?: string; required: boolean; kind: "string" | "integer" | "number" | "boolean" | "array" | "object";
  choices?: ToolScalar[]; minLength?: number; maxLength?: number; minimum?: number; maximum?: number;
  suggested?: { input: string; preview: string };
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Host-supported schemas only. Structured fields use a bounded JSON editor. */
export function toolFields(schema: unknown): ToolField[] | null {
  if (!object(schema) || schema.type !== "object" || !object(schema.properties)) return null;
  if (Object.keys(schema).some(key => !["type", "properties", "required", "additionalProperties", "minProperties", "maxProperties", "title", "description", "$schema", "$id"].includes(key))) return null;
  if (!editableJsonSchema(schema)) return null;
  if (schema.$id !== undefined && typeof schema.$id !== "string") return null;
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") return null;
  if (schema.required !== undefined && (!Array.isArray(schema.required) || !schema.required.every(key => typeof key === "string" && Object.hasOwn(schema.properties as object, key)) || new Set(schema.required).size !== schema.required.length)) return null;
  const required = (schema.required ?? []) as string[];
  const entries = Object.entries(schema.properties);
  if (entries.length > 16) return null;
  const fields: ToolField[] = [];
  for (const [key, declaration] of entries) {
    if (!object(declaration)) return null;
    const kind = declaration.type;
    const field: ToolField = { key, label: typeof declaration.title === "string" ? declaration.title : key, required: required.includes(key), kind: kind as ToolField["kind"] };
    if (typeof declaration.description === "string" && declaration.description.trim()) field.description = declaration.description;
    if (kind === "string") {
      const strings = textFields({ type: "object", properties: { [key]: declaration }, required: field.required ? [key] : [] });
      if (!strings) return null;
      field.minLength = strings[0].minLength; field.maxLength = strings[0].maxLength;
      if (field.minLength > field.maxLength) return null;
    } else if (kind === "integer" || kind === "number" || kind === "boolean") {
      const allowed = ["type", "title", "description", "default", "enum", ...(kind === "boolean" ? [] : ["minimum", "maximum"])];
      if (Object.keys(declaration).some(name => !allowed.includes(name))) return null;
      for (const name of ["minimum", "maximum"] as const) {
        const bound = declaration[name];
        if (bound !== undefined && (!finite(bound) || (Number.isInteger(bound) && !Number.isSafeInteger(bound)))) return null;
        if (finite(bound)) field[name] = bound;
      }
      if (field.minimum !== undefined && field.maximum !== undefined && field.minimum > field.maximum) return null;
    } else if (kind === "array" || kind === "object") {
      if (!editableJsonSchema(declaration)) return null;
    } else return null;
    if (kind !== "array" && kind !== "object" && declaration.enum !== undefined) {
      if (!Array.isArray(declaration.enum) || !declaration.enum.length || declaration.enum.length > 40 || !declaration.enum.every(value =>
        kind === "string" ? typeof value === "string" : kind === "boolean" ? typeof value === "boolean" : finite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)) && (kind !== "integer" || Number.isSafeInteger(value)))) return null;
      field.choices = declaration.enum as ToolScalar[];
      if (new Set(field.choices.map(value => JSON.stringify(value))).size !== field.choices.length) return null;
    }
    if (kind === "boolean" && !field.choices) field.choices = [true, false];
    field.suggested = scalarSuggestion(field, declaration.default);
    fields.push(field);
  }
  // Keep provider order within each group; keys and submitted values are unchanged.
  return fields.sort((a, b) => Number(b.required) - Number(a.required));
}

function scalarSuggestion(field: ToolField, declared: unknown): ToolField["suggested"] {
  if (field.kind === "array" || field.kind === "object" || declared === undefined) return undefined;
  if (typeof declared === "string" && field.kind !== "string") return undefined;
  if (typeof declared === "boolean" && field.kind !== "boolean") return undefined;
  if (typeof declared === "number" && (field.kind !== "integer" && field.kind !== "number" || !Number.isFinite(declared) || Object.is(declared, -0))) return undefined;
  if (!["string", "number", "boolean"].includes(typeof declared)) return undefined;
  const preview = String(declared);
  const characters = [...preview];
  if (characters.length > 80 || characters.some(character => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029;
  })) return undefined;
  const choiceIndex = field.choices?.findIndex(choice => Object.is(choice, declared));
  if (choiceIndex === -1) return undefined;
  const input = choiceIndex === undefined ? preview : String(choiceIndex);
  const prepared = prepareToolInput([{ ...field, required: true }], { [field.key]: input });
  if ("error" in prepared || !Object.is(prepared.input[field.key], declared)) return undefined;
  return { input, preview };
}

const numericLiteral = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
// Compare decimal spellings, so 1e3 == 1000 while 9007199254740993 != rounded Number.
function decimal(value: string): string {
  const [mantissa, exponent = "0"] = value.toLowerCase().split("e");
  const negative = mantissa.startsWith("-");
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const [whole, fraction = ""] = unsigned.split(".");
  let digits = (whole + fraction).replace(/^0+/, "");
  if (!digits) return "0";
  let power = Number(exponent) - fraction.length;
  while (digits.endsWith("0")) { digits = digits.slice(0, -1); power++; }
  return `${negative ? "-" : ""}${digits}e${power}`;
}
export type PreparedToolInput = { input: Record<string, ToolInputValue> } | { error: string; field: string };
export function prepareToolInput(fields: ToolField[], values: Record<string, string>): PreparedToolInput {
  const input: Record<string, ToolInputValue> = Object.create(null);
  for (const field of fields) {
    const raw = Object.hasOwn(values, field.key) ? values[field.key] : undefined;
    const fail = (error: string): PreparedToolInput => ({ error, field: field.key });
    if (field.choices) {
      if (raw === undefined || raw === "") {
        if (field.required) return fail("Choose a value for this required field.");
        continue;
      }
      if (!/^(0|[1-9]\d*)$/.test(raw) || !Object.hasOwn(field.choices, Number(raw))) return fail("Choose one of the available values.");
      input[field.key] = field.choices[Number(raw)];
    } else if (field.kind === "string") {
      if (raw === undefined && !field.required) continue;
      const value = raw ?? "";
      const length = [...value].length;
      if (length < (field.minLength ?? 0) || length > (field.maxLength ?? 32768)) return fail("Text length does not match this field's limits.");
      input[field.key] = value;
    } else if (field.kind === "array" || field.kind === "object") {
      const text = raw?.trim() ?? "";
      if (!text) {
        if (field.required) return fail("Enter JSON for this required field.");
        continue;
      }
      const parsed = parseToolJson(text, field.kind);
      if ("error" in parsed) return fail(parsed.error);
      input[field.key] = parsed.value;
    } else {
      const text = raw?.trim() ?? "";
      if (!text) {
        if (field.required) return fail("Enter a value for this required field.");
        continue;
      }
      const value = Number(text);
      if (text.length > 128 || !numericLiteral.test(text) || !Number.isFinite(value) || Object.is(value, -0) || decimal(text) !== decimal(String(value))) return fail("Enter a finite number without losing precision.");
      if (field.kind === "integer" && !Number.isSafeInteger(value)) return fail("Enter a safe whole number.");
      if ((field.minimum !== undefined && value < field.minimum) || (field.maximum !== undefined && value > field.maximum)) return fail("Number is outside this field's allowed range.");
      input[field.key] = value;
    }
    const selected = input[field.key];
    if (typeof selected === "string" && ([...selected].length < (field.minLength ?? 0) || [...selected].length > (field.maxLength ?? 32768))) return fail("Text length does not match this field's limits.");
    if (typeof selected === "number" && ((field.minimum !== undefined && selected < field.minimum) || (field.maximum !== undefined && selected > field.maximum))) return fail("Number is outside this field's allowed range.");
  }
  return { input };
}
