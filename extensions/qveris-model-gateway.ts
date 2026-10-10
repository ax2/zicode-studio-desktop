type FetchLike = typeof fetch;

type QVerisPricingTier = {
  min_input_tokens?: unknown;
  prompt_usd_per_million?: unknown;
  completion_usd_per_million?: unknown;
  cached_usd_per_million?: unknown;
};

type QVerisGatewayModel = {
  id?: unknown;
  context_window?: unknown;
  capabilities?: unknown;
  pricing?: {
    prompt_usd_per_million_tokens?: unknown;
    completion_usd_per_million_tokens?: unknown;
    cached_input_usd_per_million_tokens?: unknown;
    tiers?: unknown;
  };
};

export type PiGatewayModel = {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  contextWindow?: number;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    tiers?: Array<{
      inputTokensAbove: number;
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    }>;
  };
};

export async function fetchQVerisModelCatalog(
  apiKey: string,
  {
    baseUrl,
    fetchImpl = globalThis.fetch,
    timeoutMs = 20_000,
  }: { baseUrl: string; fetchImpl?: FetchLike; timeoutMs?: number },
): Promise<PiGatewayModel[]> {
  const credential = apiKey.trim();
  if (!credential) throw new Error("QVeris API Key is not configured");
  const endpoint = `${normalizeGatewayBaseUrl(baseUrl)}/models`;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("QVeris model catalog request timed out")),
    timeoutMs,
  );
  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${credential}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`QVeris model catalog request failed (${response.status})`);
    }
    const text = await readBoundedCatalog(response);
    const payload = parsePayload(text);
    if (!Array.isArray(payload.data)) {
      throw new Error("QVeris model catalog response is missing data");
    }
    return payload.data
      .map(normalizeGatewayModel)
      .filter((model): model is PiGatewayModel => model !== null)
      .sort((left, right) => left.id.localeCompare(right.id));
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("QVeris model catalog request timed out");
    }
    if (
      error instanceof Error &&
      (/^QVeris model catalog request failed \(\d{3}\)$/.test(error.message) ||
        error.message === "QVeris model catalog exceeded the 2 MB safety limit" ||
        error.message === "QVeris model catalog returned invalid JSON" ||
        error.message === "QVeris model catalog response is missing data")
    ) {
      throw error;
    }
    throw new Error("QVeris model catalog request failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedCatalog(response: Response): Promise<string> {
  const tooLarge = () => new Error("QVeris model catalog exceeded the 2 MB safety limit");
  if (!response.body) {
    // A real bodyless Response is empty; this also supports simple injected
    // fetch implementations used by integrations that only expose text().
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > 2_000_000) throw tooLarge();
    return text;
  }
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
        throw tooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function normalizeGatewayBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!normalized) throw new Error("QVeris Model Gateway base URL is not configured");
  const parsed = new URL(normalized);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("QVeris Model Gateway base URL must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("QVeris Model Gateway base URL must not contain credentials, query or fragment");
  }
  return normalized;
}

function normalizeGatewayModel(value: unknown): PiGatewayModel | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const model = value as QVerisGatewayModel;
  const id = asString(model.id);
  const capabilities = Array.isArray(model.capabilities)
    ? model.capabilities.map(asString).filter(Boolean)
    : [];
  if (!id || !capabilities.includes("chat")) return null;

  const normalized: PiGatewayModel = {
    id,
    name: id,
    reasoning: capabilities.includes("reasoning"),
    input: capabilities.includes("vision") ? ["text", "image"] : ["text"],
  };
  const contextWindow = asPositiveNumber(model.context_window);
  if (contextWindow) normalized.contextWindow = Math.trunc(contextWindow);
  const cost = normalizePricing(model.pricing);
  if (cost) normalized.cost = cost;
  return normalized;
}

function normalizePricing(pricing: QVerisGatewayModel["pricing"]): PiGatewayModel["cost"] {
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) return undefined;
  const input = asNonNegativeNumber(pricing.prompt_usd_per_million_tokens);
  const output = asNonNegativeNumber(pricing.completion_usd_per_million_tokens);
  const cacheRead = asNonNegativeNumber(pricing.cached_input_usd_per_million_tokens);
  if (input === undefined || output === undefined || cacheRead === undefined) return undefined;

  const cost: NonNullable<PiGatewayModel["cost"]> = {
    input,
    output,
    cacheRead,
    cacheWrite: 0,
  };
  if (Array.isArray(pricing.tiers)) {
    const tiers = pricing.tiers
      .map(normalizePricingTier)
      .filter((tier): tier is NonNullable<ReturnType<typeof normalizePricingTier>> => tier !== null)
      .sort((left, right) => left.inputTokensAbove - right.inputTokensAbove);
    if (tiers.length) cost.tiers = tiers;
  }
  return cost;
}

function normalizePricingTier(tier: unknown) {
  if (!tier || typeof tier !== "object" || Array.isArray(tier)) return null;
  const value = tier as QVerisPricingTier;
  const minimum = asPositiveNumber(value.min_input_tokens);
  const input = asNonNegativeNumber(value.prompt_usd_per_million);
  const output = asNonNegativeNumber(value.completion_usd_per_million);
  const cacheRead = asNonNegativeNumber(value.cached_usd_per_million);
  if (!minimum || input === undefined || output === undefined || cacheRead === undefined)
    return null;
  return {
    // QVeris applies a tier at >= min_input_tokens; Pi applies it at
    // > inputTokensAbove.
    inputTokensAbove: Math.max(0, Math.trunc(minimum) - 1),
    input,
    output,
    cacheRead,
    cacheWrite: 0,
  };
}

function parsePayload(text: string): Record<string, unknown> {
  try {
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("response is not an object");
    }
    return payload as Record<string, unknown>;
  } catch {
    throw new Error("QVeris model catalog returned invalid JSON");
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function asNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
