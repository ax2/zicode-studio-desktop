const DEFAULT_TIMEOUT_MS = 30_000;

export class PluginCapabilityGateway {
  #fetch;
  #location;
  #timeoutMs;

  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    location = globalThis.location,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new Error("Plugin capability gateway requires fetch");
    }
    this.#fetch = fetchImpl;
    this.#location = location;
    this.#timeoutMs = timeoutMs;
  }

  list(sceneId) {
    const url = this.#url("/v2/plugin-capabilities");
    url.searchParams.set("sceneId", sceneId);
    return this.#request(url);
  }

  invoke(sceneId, pluginId, capabilityId, input = {}) {
    return this.#request(this.#url("/v2/plugin-capabilities/invoke"), {
      method: "POST",
      body: JSON.stringify({ sceneId, pluginId, capabilityId, input }),
    });
  }

  #url(path) {
    return new URL(path, this.#location?.origin ?? globalThis.location?.origin);
  }

  async #request(url, options = {}) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(url, {
        ...options,
        headers: {
          accept: "application/json",
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...options.headers,
        },
        signal: controller?.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(
          body?.error?.message || body?.error?.code || `HTTP ${response.status}`,
        );
        error.code = body?.error?.code;
        throw error;
      }
      return body;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Plugin capability request timed out");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
