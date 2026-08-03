const DEFAULT_TIMEOUT_MS = 30_000;

export class ArtifactGateway {
  #fetch;
  #location;
  #timeoutMs;

  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    location = globalThis.location,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("Artifacts gateway requires fetch");
    this.#fetch = fetchImpl;
    this.#location = location;
    this.#timeoutMs = timeoutMs;
  }

  list(sceneId, filters = {}) {
    const url = this.#url("/v2/artifacts");
    url.searchParams.set("sceneId", sceneId);
    if (filters.kind) url.searchParams.set("kind", filters.kind);
    if (filters.pluginId) url.searchParams.set("pluginId", filters.pluginId);
    if (filters.query) url.searchParams.set("query", filters.query);
    return this.#request(url);
  }

  get(sceneId, artifactId) {
    const url = this.#url("/v2/artifacts/item");
    url.searchParams.set("sceneId", sceneId);
    url.searchParams.set("artifactId", artifactId);
    return this.#request(url);
  }

  create(sceneId, artifact) {
    return this.#post("/v2/artifacts/create", {
      sceneId,
      pluginId: artifact.pluginId,
      kind: artifact.kind,
      title: artifact.title,
      summary: artifact.summary ?? "",
      mimeType: artifact.mimeType ?? "application/json",
      provenance: artifact.provenance ?? {},
      content: artifact.content ?? null,
    });
  }

  delete(sceneId, artifact) {
    return this.#post("/v2/artifacts/delete", {
      sceneId,
      artifactId: artifact.id,
      expectedVersion: artifact.version,
    });
  }

  #post(path, body) {
    return this.#request(this.#url(path), {
      method: "POST",
      body: JSON.stringify(body),
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
      if (error?.name === "AbortError") throw new Error("Artifacts request timed out");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
