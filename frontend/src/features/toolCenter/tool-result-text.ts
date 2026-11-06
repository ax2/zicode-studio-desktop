export interface ResultTextField { key: string; text: string }

// An optional view of string fields; never replace or reserialize the original.
export function resultTextFields(text: string): ResultTextField[] {
  if (text.length > 1024 * 1024) return [];
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    return Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .slice(0, 16).map(([key, text]) => ({ key, text }));
  } catch { return []; }
}
