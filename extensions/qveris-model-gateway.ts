export const QVERIS_MODEL_GATEWAY_BASE_URL = "https://aigateway.qveris.ai/v1";

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
    fetchImpl = globalThis.fetch,
    timeoutMs = 20_000,
    baseUrl = QVERIS_MODEL_GATEWAY_BASE_URL,
  }: { fetchImpl?: FetchLike; timeoutMs?: number; baseUrl?: string } = {},
): Promise<PiGatewayModel[]> {
  const credential = apiKey.trim();
  if (!credential) throw new Error("QVeris API Key is not configured");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("QVeris model catalog request timed out")),
    timeoutMs,
  );
  try {
    const endpoint = `${normalizeGatewayBaseUrl(baseUrl)}/models`;
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${credential}`,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (text.length > 2_000_000) {
      throw new Error("QVeris model catalog exceeded the 2 MB safety limit");
    }
    const payload = parsePayload(text);
    if (!response.ok) {
      throw new Error(
        `QVeris model catalog request failed (${response.status}): ${safeGatewayError(payload, response.statusText)}`,
      );
    }
    if (!Array.isArray(payload.data)) {
      throw new Error("QVeris model catalog response is missing data");
    }
    return payload.data
      .map(normalizeGatewayModel)
      .filter((model): model is PiGatewayModel => model !== null)
      .sort((left, right) => left.id.localeCompare(right.id));
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeGatewayBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!normalized) throw new Error("QVeris Model Gateway base URL is not configured");
  const parsed = new URL(normalized);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("QVeris Model Gateway base URL must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new Error("QVeris Model Gateway base URL must not contain credentials");
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
  if (!minimum || input === undefined || output === undefined || cacheRead === undefined) return null;
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

function safeGatewayError(payload: Record<string, unknown>, fallback: string): string {
  const error = payload.error;
  if (typeof error === "string" && error.trim()) return error.trim().slice(0, 300);
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const message = asString((error as Record<string, unknown>).message);
    if (message) return message.slice(0, 300);
  }
  const message = asString(payload.message);
  return (message || fallback || "request rejected").slice(0, 300);
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
