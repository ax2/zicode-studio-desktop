const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_MODELS = 300;

class CatalogError extends Error {}

/** Discover IDs only; provider-specific capabilities must be edited by the user. */
export async function fetchOpenAIModelIds(
  baseUrl: string,
  apiKey?: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<string[]> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Model channel URL is invalid.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    baseUrl.includes("?") ||
    baseUrl.includes("#")
  ) {
    throw new Error("Model channel URL must be HTTP(S) without credentials, query, or fragment.");
  }
  const endpoint = `${url.href.replace(/\/+$/, "")}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (!response.ok) throw new CatalogError(`Model catalog request failed (${response.status}).`);
    const length = Number(response.headers?.get("content-length"));
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
      throw new CatalogError("Model catalog response exceeds the 2 MB limit.");
    }
    const body = await readBoundedBody(response);
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new CatalogError("Model catalog returned invalid JSON.");
    }
    const data = (payload as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) throw new CatalogError("Model catalog response is missing data.");
    if (data.length > MAX_MODELS) throw new CatalogError("Model catalog contains too many models.");
    const ids = new Set<string>();
    for (const entry of data) {
      const id: string = typeof entry?.id === "string" ? entry.id.trim() : "";
      if (
        !id ||
        id.length > 256 ||
        Array.from(id).some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      )
        continue;
      ids.add(id);
    }
    if (ids.size === 0) throw new CatalogError("Model catalog has no usable model IDs.");
    return [...ids].sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Model catalog request timed out.");
    if (error instanceof CatalogError) throw error;
    throw new Error("Model catalog request failed.");
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedBody(response: Response): Promise<string> {
  if (!response.body) {
    // A usable catalog must contain JSON. A text-only injected response cannot
    // be checked before text() allocates the entire body, so fail closed.
    throw new CatalogError("Model catalog returned invalid JSON.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = "";
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES)
        throw new CatalogError("Model catalog response exceeds the 2 MB limit.");
      result += decoder.decode(next.value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    if (bytes > MAX_RESPONSE_BYTES) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
