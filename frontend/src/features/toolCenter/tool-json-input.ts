export type ToolInputValue = string | number | boolean | null | ToolInputValue[] | { [key: string]: ToolInputValue };

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const keywords = new Set(["$schema", "$id", "title", "description", "default", "type", "properties", "required",
  "additionalProperties", "items", "minItems", "maxItems", "minProperties", "maxProperties", "minLength", "maxLength", "minimum", "maximum", "enum", "const"]);
const types = new Set(["object", "array", "string", "integer", "number", "boolean", "null"]);

/** Only expose a JSON editor when every declared constraint has a Host implementation. */
export function editableJsonSchema(schema: unknown, depth = 0): boolean {
  if (!object(schema) || depth > 16 || Object.keys(schema).some(key => !keywords.has(key))) return false;
  if (schema.type !== undefined && (typeof schema.type !== "string" || !types.has(schema.type))) return false;
  if (["$schema", "$id", "title", "description"].some(key => schema[key] !== undefined && typeof schema[key] !== "string")) return false;
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") return false;
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) return false;
  if (schema.required !== undefined && (!Array.isArray(schema.required) ||
    !schema.required.every(name => typeof name === "string") || new Set(schema.required).size !== schema.required.length)) return false;
  for (const [minimum, maximum] of [["minLength", "maxLength"], ["minItems", "maxItems"], ["minProperties", "maxProperties"]]) {
    const lower = schema[minimum], upper = schema[maximum];
    if (lower !== undefined && (!Number.isSafeInteger(lower) || (lower as number) < 0)) return false;
    if (upper !== undefined && (!Number.isSafeInteger(upper) || (upper as number) < 0)) return false;
    if (typeof lower === "number" && typeof upper === "number" && lower > upper) return false;
  }
  for (const key of ["minimum", "maximum"]) {
    const value = schema[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value)))) return false;
  }
  if (typeof schema.minimum === "number" && typeof schema.maximum === "number" && schema.minimum > schema.maximum) return false;
  if (schema.properties !== undefined && (!object(schema.properties) ||
    Object.values(schema.properties).some(value => !editableJsonSchema(value, depth + 1)))) return false;
  if (schema.items !== undefined && !editableJsonSchema(schema.items, depth + 1)) return false;
  return true;
}

const numberAt = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
function decimal(value: string): string {
  const [mantissa, exponent = "0"] = value.toLowerCase().split("e");
  const negative = mantissa.startsWith("-");
  const [whole, fraction = ""] = (negative ? mantissa.slice(1) : mantissa).split(".");
  let digits = (whole + fraction).replace(/^0+/, "");
  if (!digits) return "0";
  let power = Number(exponent) - fraction.length;
  while (digits.endsWith("0")) { digits = digits.slice(0, -1); power++; }
  return `${negative ? "-" : ""}${digits}e${power}`;
}

// JSON.parse rounds large numeric literals. Check their spelling before any conversion.
function losslessNumbers(text: string): boolean {
  let quoted = false, escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "-" || (char >= "0" && char <= "9")) {
      numberAt.lastIndex = index;
      const literal = numberAt.exec(text)?.[0];
      if (!literal) return false;
      const value = Number(literal);
      if (!Number.isFinite(value) || Object.is(value, -0) || decimal(literal) !== decimal(String(value))) return false;
      index += literal.length - 1;
    }
  }
  return true;
}

function uniqueObjectKeys(text: string): boolean {
  const stack: ({ keys: Set<string>; expectingKey: boolean } | null)[] = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      const start = index;
      for (index++; index < text.length; index++) {
        if (text[index] === "\\") index++;
        else if (text[index] === '"') break;
      }
      const frame = stack.at(-1);
      if (frame?.expectingKey) {
        const key: string = JSON.parse(text.slice(start, index + 1));
        if (frame.keys.has(key)) return false;
        frame.keys.add(key);
        frame.expectingKey = false;
      }
    } else if (char === "{") stack.push({ keys: new Set(), expectingKey: true });
    else if (char === "[") stack.push(null);
    else if (char === "}" || char === "]") stack.pop();
    else if (char === ",") {
      const frame = stack.at(-1);
      if (frame) frame.expectingKey = true;
    }
  }
  return true;
}

export function parseToolJson(text: string, kind: "array" | "object"): { value: ToolInputValue } | { error: string } {
  if (text.length > 32768 || new TextEncoder().encode(text).length > 32768) return { error: "JSON input exceeds the 32 KiB form limit." };
  if (!losslessNumbers(text)) return { error: "JSON contains a number that cannot be preserved exactly." };
  try {
    const value: unknown = JSON.parse(text);
    if (!uniqueObjectKeys(text)) return { error: "JSON object contains duplicate keys." };
    if (kind === "array" ? !Array.isArray(value) : !object(value)) return { error: `Enter a JSON ${kind}.` };
    return { value: value as ToolInputValue };
  } catch { return { error: "Enter valid JSON." }; }
}
