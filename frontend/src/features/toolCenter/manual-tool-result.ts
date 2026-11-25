export interface ManualToolResult {
  successful: boolean;
  text: string;
  raw: string;
  errorCode?: string;
  errorMessage?: string;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function isJsonCapture(reference: unknown): boolean {
  return record(reference) && reference.schemaVersion === 2 && reference.mimeType === "application/json" &&
    typeof reference.resultId === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(reference.resultId) &&
    typeof reference.contentVersion === "string" && /^[0-9a-f]{64}$/.test(reference.contentVersion) &&
    typeof reference.byteLength === "number" && Number.isSafeInteger(reference.byteLength) &&
    reference.byteLength >= 2 && reference.byteLength <= 48 * 1024;
}

// A structured result is only unwrapped when the caller expects a verified Host capture.
export function manualToolResult(value: unknown, structured?: { reference: unknown }): ManualToolResult {
  const raw = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
  if (record(value) && value.ok === false) {
    const error = record(value.error) ? value.error : {};
    return { successful: false, text: "", raw,
      errorCode: typeof error.code === "string" ? error.code.slice(0, 80) : undefined,
      errorMessage: typeof error.message === "string" ? error.message.slice(0, 240) : undefined };
  }
  if (structured || (record(value) && value.contractVersion === "1.0.0-rc.1")) {
    if (record(value) && value.contractVersion === "1.0.0-rc.1" && value.ok === true && value.error === null && record(value.data)) {
      if (structured && isJsonCapture(structured.reference)) {
        return { successful: true, text: JSON.stringify(value.data, null, 2), raw };
      }
      if (!structured && typeof value.data.text === "string") {
        return { successful: true, text: value.data.text, raw };
      }
    }
    return { successful: false, text: "", raw, errorCode: "INVALID_RESULT" };
  }
  return { successful: true, text: raw, raw };
}
