import { isPluginToolSnapshot, type PluginToolSnapshot } from "./plugin-tool-snapshot";
import { awaitPluginRequest } from "./plugin-request-wait";

export type BrokerBinding = { origin: string; token: string; runtimeId: string; sessionId: string };
export type CatalogPage = {
  schemaVersion: 1;
  revision: string;
  items: Array<{ toolId: string; name: string; title: string; description: string }>;
  nextCursor: string | null;
  total: number;
};
export type CatalogLoaded = {
  schemaVersion: 1;
  revision: string;
  toolId: string;
  tool: PluginToolSnapshot;
};

function invalid(): never {
  throw new Error("[catalog_response_invalid] Refresh the plugin catalog and retry");
}

export function createCatalogClient(binding: BrokerBinding, request: typeof fetch) {
  const post = async (
    operation: "search" | "load",
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> => {
    const timeout = AbortSignal.timeout(15_000);
    const bound = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const interrupted = () => new Error(
      signal?.aborted
        ? "[catalog_request_cancelled] Plugin catalog request cancelled"
        : "[catalog_request_timeout] Plugin catalog request timed out",
    );
    const wait = async <T>(pending: Promise<T>): Promise<T> => {
      try {
        return await awaitPluginRequest(pending, bound);
      } catch (error) {
        if (bound.aborted) throw interrupted();
        throw error;
      }
    };
    if (bound.aborted) throw interrupted();
    const response = await wait(
      request(`${binding.origin}/v2/plugin-tools/catalog/${operation}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${binding.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          schemaVersion: 1,
          runtimeId: binding.runtimeId,
          sessionId: binding.sessionId,
        }),
        signal: bound,
      }),
    );
    const limit = operation === "search" ? 32 * 1024 : 256 * 1024;
    const reader = response.body?.getReader();
    if (!reader) invalid();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const result = await wait(reader.read());
        if (result.done) break;
        bytes += result.value.byteLength;
        if (bytes > limit)
          throw new Error(
            "[catalog_response_too_large] Host catalog response exceeds its byte limit",
          );
        chunks.push(result.value);
      }
    } catch (error) {
      void reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      );
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) invalid();
      payload = parsed as Record<string, unknown>;
    } catch {
      invalid();
    }
    if (!response.ok) {
      const code = (payload.error as { code?: unknown } | undefined)?.code;
      throw new Error(
        `[${typeof code === "string" && /^[a-z_]{1,64}$/.test(code) ? code : `http_${response.status}`}] Plugin catalog request failed; refresh or check current authorization`,
      );
    }
    if (
      payload.schemaVersion !== 1 ||
      typeof payload.revision !== "string" ||
      !/^[a-f0-9]{64}$/.test(payload.revision)
    )
      invalid();
    return payload;
  };
  return {
    async search(
      query: string,
      cursor: string | undefined,
      signal?: AbortSignal,
    ): Promise<CatalogPage> {
      if (Buffer.byteLength(query, "utf8") > 256 || (cursor?.length ?? 0) > 1024)
        throw new Error("[catalog_request_invalid] Query or cursor exceeds its limit");
      const payload = await post("search", { query, cursor }, signal);
      if (
        !Array.isArray(payload.items) ||
        payload.items.length > 20 ||
        !Number.isSafeInteger(payload.total) ||
        Number(payload.total) < payload.items.length ||
        !(
          payload.nextCursor === null ||
          (typeof payload.nextCursor === "string" && payload.nextCursor.length <= 1024)
        ) ||
        !payload.items.every(
          (item) =>
            item &&
            typeof item === "object" &&
            ["toolId", "name", "title", "description"].every(
              (key) => typeof item[key] === "string",
            ),
        )
      )
        invalid();
      return payload as unknown as CatalogPage;
    },
    async load(toolId: string, revision: string, signal?: AbortSignal): Promise<CatalogLoaded> {
      if (toolId.length > 1024 || !/^[a-f0-9]{64}$/.test(revision))
        throw new Error("[catalog_request_invalid] Search the catalog before loading a tool");
      const payload = await post("load", { toolId, revision }, signal);
      if (
        payload.toolId !== toolId ||
        payload.revision !== revision ||
        !isPluginToolSnapshot(payload.tool) ||
        JSON.stringify([payload.tool.pluginId, payload.tool.capability]) !== toolId
      )
        invalid();
      return payload as unknown as CatalogLoaded;
    },
  };
}
