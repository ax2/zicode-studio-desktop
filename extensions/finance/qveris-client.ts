import * as fs from "node:fs";
import * as path from "node:path";

export const QVERIS_CAPABILITY_BASE_URL = "https://qveris.ai/api/v1";

type FetchLike = typeof globalThis.fetch;

type QVerisClientOptions = {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  baseUrl?: string;
};

export class QVerisClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(options: QVerisClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.baseUrl = capabilityBaseUrl(options.baseUrl ?? QVERIS_CAPABILITY_BASE_URL);
  }

  credentialStatus(): { configured: boolean; source: string } {
    return {
      configured: Boolean(readQVerisApiKey()),
      source: qverisAuthPath() ?? "scene credential",
    };
  }

  discover(
    input: { query: string; limit?: number; sessionId?: string; lang?: "zh" | "en" },
    signal?: AbortSignal,
  ) {
    return this.request(
      "/search",
      {
        query: input.query,
        limit: clampInteger(input.limit ?? 8, 1, 10),
        session_id: input.sessionId || desktopSessionId(),
        view: "routing",
        lang: input.lang ?? "zh",
      },
      signal,
    );
  }

  inspect(
    input: { toolIds: string[]; searchId?: string; sessionId?: string },
    signal?: AbortSignal,
  ) {
    return this.request(
      "/tools/by-ids",
      {
        tool_ids: input.toolIds.slice(0, 10),
        search_id: input.searchId || undefined,
        session_id: input.sessionId || desktopSessionId(),
        view: "lean",
      },
      signal,
    );
  }

  call(
    input: {
      toolId: string;
      searchId: string;
      parameters: Record<string, unknown>;
      model?: string;
      sessionId?: string;
      respondWith?: string;
    },
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams({ tool_id: input.toolId });
    return this.request(
      `/tools/execute?${query}`,
      {
        search_id: input.searchId,
        session_id: input.sessionId || desktopSessionId(),
        model: input.model || undefined,
        parameters: input.parameters,
        max_response_size: 20_480,
        respond_with: input.respondWith || "full",
      },
      signal,
      "POST",
      30_000,
    );
  }

  usageAudit(
    input: {
      executionId?: string;
      startDate?: string;
      endDate?: string;
      kind?: "discover" | "call" | "model";
      summary?: boolean;
      limit?: number;
    } = {},
    signal?: AbortSignal,
  ) {
    const query = compactQuery({
      execution_id: input.executionId,
      start_date: input.startDate,
      end_date: input.endDate,
      kind: input.kind,
      summary: input.summary === undefined ? true : input.summary,
      limit: clampInteger(input.limit ?? 10, 1, 50),
    });
    return this.request(`/auth/usage/history/v2?${query}`, undefined, signal, "GET");
  }

  creditsLedger(
    input: {
      startDate?: string;
      endDate?: string;
      direction?: "consume" | "grant" | "any";
      summary?: boolean;
      limit?: number;
    } = {},
    signal?: AbortSignal,
  ) {
    const query = compactQuery({
      start_date: input.startDate,
      end_date: input.endDate,
      direction: input.direction || "any",
      summary: input.summary === undefined ? true : input.summary,
      limit: clampInteger(input.limit ?? 10, 1, 50),
    });
    return this.request(`/auth/credits/ledger?${query}`, undefined, signal, "GET");
  }

  private async request(
    endpoint: string,
    body?: Record<string, unknown>,
    externalSignal?: AbortSignal,
    method: "GET" | "POST" = "POST",
    timeoutMs = this.timeoutMs,
  ): Promise<Record<string, unknown>> {
    const apiKey = readQVerisApiKey();
    if (!apiKey) {
      throw new Error(
        "QVeris API Key is not configured for this scene. Open Settings → Configuration → API Keys and set the QVeris key.",
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("QVeris request timed out")),
      timeoutMs,
    );
    const abort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`QVeris request failed (${response.status})`);
      }
      const text = await readBoundedResponse(response);
      const payload = parseJsonResponse(text);
      return payload;
    } catch (error) {
      // Normalize transport failures into the stable QVeris error vocabulary
      // so the frontend can localize them instead of showing a raw "fetch failed".
      if (
        error instanceof Error &&
        (/^QVeris request failed \(\d{3}\)$/.test(error.message) ||
          error.message === "QVeris response exceeded the 2 MB safety limit" ||
          error.message === "QVeris returned an invalid JSON response")
      ) {
        throw error;
      }
      if (
        (error as { name?: string } | null)?.name === "AbortError" ||
        String((error as Error | null)?.message ?? "").includes("timed out")
      ) {
        throw new Error("QVeris request timed out");
      }
      throw new Error("QVeris request failed");
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abort);
    }
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2_000_000) {
        await reader.cancel().catch(() => undefined);
        throw new Error("QVeris response exceeded the 2 MB safety limit");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function capabilityBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid financial capability URL");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Financial capability URL requires HTTPS or loopback HTTP without URL credentials, query or fragment",
    );
  }
  return url.href.replace(/\/+$/, "");
}

function compactQuery(values: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return query.toString();
}

let runtimeApiKey: string | null = null;

export function setQVerisRuntimeApiKey(value: string | null): void {
  runtimeApiKey = typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readQVerisApiKey(): string | null {
  if (runtimeApiKey) return runtimeApiKey;
  const authPath = qverisAuthPath();
  if (!authPath) return null;
  try {
    const document = JSON.parse(fs.readFileSync(authPath, "utf8")) as Record<string, unknown>;
    const credential = document.qveris;
    if (typeof credential === "string" && credential.trim()) return credential.trim();
    if (credential && typeof credential === "object" && !Array.isArray(credential)) {
      const key = (credential as { key?: unknown }).key;
      if (typeof key === "string" && key.trim()) return key.trim();
    }
  } catch {
    // Missing or malformed auth is reported as an unconfigured credential.
  }
  return null;
}

function qverisAuthPath(): string | null {
  const agentRoot = process.env.PI_CODING_AGENT_DIR?.trim();
  return agentRoot ? path.join(path.resolve(agentRoot), "auth.json") : null;
}

function desktopSessionId(): string {
  const instance = process.env.PI_DESKTOP_INSTANCE_ID?.trim() || "desktop";
  return `zicode-${instance}`.slice(0, 120);
}

function parseJsonResponse(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("response is not a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("QVeris returned an invalid JSON response");
  }
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}
