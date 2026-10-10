const SUCCESS_LIMIT = 2 * 1024 * 1024;
const ERROR_LIMIT = 8 * 1024;

async function boundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("Model health response exceeded safety limit");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      throw new Error("Model health response exceeded safety limit");
    }
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("Model health response exceeded safety limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export async function qverisHealthFailure(response: Response): Promise<string> {
  if (response.status === 404) {
    try {
      const parsed = JSON.parse(await boundedText(response, ERROR_LIMIT));
      if (parsed?.error?.code === "model_not_found") return "QVeris model_not_found (404)";
    } catch {
      // The status remains usable when the optional error code is unavailable.
    }
  }
  return `QVeris request failed (${response.status})`;
}

export async function qverisHealthHasAssistantText(response: Response): Promise<boolean> {
  let payload: unknown;
  try {
    payload = JSON.parse(await boundedText(response, SUCCESS_LIMIT));
  } catch (error) {
    if (error instanceof Error && error.message === "Model health response exceeded safety limit") {
      throw error;
    }
    throw new Error("Model health response invalid");
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { choices?: unknown }).choices)
  ) {
    throw new Error("Model health response invalid");
  }
  return (payload as { choices: unknown[] }).choices.some((choice) => {
    if (!choice || typeof choice !== "object") return false;
    const message = (choice as { message?: unknown }).message;
    if (!message || typeof message !== "object") return false;
    const assistant = message as { role?: unknown; content?: unknown };
    return (
      assistant.role === "assistant" &&
      typeof assistant.content === "string" &&
      assistant.content.trim().length > 0
    );
  });
}

export function safeModelHealthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message === "QVeris API Key is not configured" ||
    message === "QVeris health check timed out" ||
    message === "Model health check timed out" ||
    message === "QVeris model_not_found (404)" ||
    message === "Model health response exceeded safety limit" ||
    message === "Model health response invalid" ||
    message === "No assistant text returned" ||
    /^QVeris request failed \(\d{3}\)$/.test(message)
  ) {
    return message;
  }
  return "Model health check failed";
}
