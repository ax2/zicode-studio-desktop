const MAX_BYTES = 32 * 1024 * 1024;
export function createSavedOutputGateway({ fetchImpl, location, timeoutMs = 30000 }) {
  function url(path, sceneId, workspaceId) {
    const result = new URL(path, location?.origin ?? globalThis.location?.origin);
    for (const [key, value] of Object.entries({ schemaVersion: 1, sceneId, workspaceId })) result.searchParams.set(key, value);
    return result;
  }
  async function request(target, binary, signal, expectedLength = 0) {
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await fetchImpl(target, { signal: controller.signal, headers: { accept: binary ? "application/octet-stream" : "application/json" } });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const error = new Error("Saved output unavailable"); error.code = body?.error?.code; throw error;
      }
      if (!binary) return await response.json();
      if (response.headers.get("content-type") !== "application/octet-stream") throw new Error("Saved output unavailable");
      if (!Number.isSafeInteger(expectedLength) || expectedLength < 0 || expectedLength > MAX_BYTES) throw new Error("Saved output unavailable");
      const reader = response.body.getReader(), bytes = new Uint8Array(expectedLength); let size = 0;
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break;
          if (size + value.length > bytes.length) throw new Error("Saved output unavailable"); bytes.set(value, size); size += value.length; }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (size !== bytes.length) throw new Error("Saved output unavailable");
      return bytes.buffer;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }
  return {
    list(sceneId, workspaceId, { query = "", offset = 0, signal } = {}) {
      const target = url("/v2/plugin-resources/saved-outputs", sceneId, workspaceId);
      target.searchParams.set("query", query); target.searchParams.set("offset", offset);
      return request(target, false, signal);
    },
    read(sceneId, workspaceId, item, signal) {
      const target = url("/v2/plugin-resources/saved-output", sceneId, workspaceId);
      target.searchParams.set("saveId", item.receipt.saveId); target.searchParams.set("receiptVersion", item.receiptVersion);
      return request(target, true, signal, item.receipt.byteLength);
    },
  };
}
