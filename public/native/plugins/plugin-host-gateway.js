const DEFAULT_TIMEOUT_MS = 5000;

export class PluginHostGateway {
  #fetch;
  #location;
  #timeoutMs;

  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    location = globalThis.location,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new Error("Plugin Host gateway requires fetch");
    }
    this.#fetch = fetchImpl;
    this.#location = location;
    this.#timeoutMs = timeoutMs;
  }

  async list(sceneId) {
    const url = this.#url("/v2/plugins");
    url.searchParams.set("sceneId", sceneId);
    url.searchParams.set("summary", "true");
    return this.#request(url);
  }

  setEnabled(sceneId, pluginId, enabled) {
    return this.#request(this.#url("/v2/plugins/enablement"), {
      method: "POST",
      body: JSON.stringify({ sceneId, pluginId, enabled }),
    });
  }

  setPermission(sceneId, pluginId, permission, granted) {
    return this.#request(this.#url("/v2/plugins/permission"), {
      method: "POST",
      body: JSON.stringify({ sceneId, pluginId, permission, granted }),
    });
  }

  reload() {
    return this.#request(this.#url("/v2/plugins/reload"), {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  uninstall(pluginId) {
    return this.#request(this.#url("/v2/plugins/uninstall"), {
      method: "POST",
      body: JSON.stringify({ pluginId }),
    });
  }

  viewSource(sceneId, pluginId, viewId) {
    const url = this.#url("/v2/plugin-views/source");
    url.searchParams.set("sceneId", sceneId);
    url.searchParams.set("pluginId", pluginId);
    url.searchParams.set("viewId", viewId);
    return this.#request(url);
  }

  invokeCommand(sceneId, commandId, args = {}) {
    return this.#request(this.#url("/v2/plugin-commands/invoke"), {
      method: "POST",
      body: JSON.stringify({ sceneId, commandId, args }),
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
        const message = body?.error?.message || body?.error?.code || `HTTP ${response.status}`;
        throw new Error(message);
      }
      return body;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Plugin Host request timed out");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
