export interface ManualToolResult {
  successful: boolean;
  text: string;
  raw: string;
  errorCode?: string;
  errorMessage?: string;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Only unwrap the versioned text contract. Other plugin outputs remain intact.
// A provider-declared failure must never become a successful recent-use entry.
export function manualToolResult(value: unknown): ManualToolResult {
  const raw = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
  if (record(value) && value.ok === false) {
    const error = record(value.error) ? value.error : {};
    return { successful: false, text: "", raw,
      errorCode: typeof error.code === "string" ? error.code.slice(0, 80) : undefined,
      errorMessage: typeof error.message === "string" ? error.message.slice(0, 240) : undefined };
  }
  if (record(value) && value.contractVersion === "1.0.0-rc.1") {
    if (value.ok === true && value.error === null && record(value.data) && typeof value.data.text === "string") {
      return { successful: true, text: value.data.text, raw };
    }
    return { successful: false, text: "", raw, errorCode: "INVALID_RESULT" };
  }
  return { successful: true, text: raw, raw };
}
