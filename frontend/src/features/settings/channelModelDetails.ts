type ModelDetails = {
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
};

const DETAIL_KEYS = new Set(["name", "contextWindow", "maxTokens", "cost"]);
const COST_KEYS = new Set(["input", "output", "cacheRead", "cacheWrite"]);

export function channelModelDetailsJson(models: Array<{ id: string } & ModelDetails>): string {
  const details = Object.create(null) as Record<string, ModelDetails>;
  for (const model of models) {
    if (!model?.id) continue;
    const entry: ModelDetails = {};
    if (typeof model.name === "string" && Array.from(model.name).length <= 100) entry.name = model.name;
    if (Number.isSafeInteger(model.contextWindow) && (model.contextWindow ?? 0) > 0) entry.contextWindow = model.contextWindow;
    if (Number.isSafeInteger(model.maxTokens) && (model.maxTokens ?? 0) > 0) entry.maxTokens = model.maxTokens;
    if (model.cost && typeof model.cost === "object") {
      const cost: NonNullable<ModelDetails["cost"]> = {};
      for (const key of COST_KEYS) {
        const value = model.cost[key as keyof NonNullable<ModelDetails["cost"]>];
        if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000) {
          cost[key as keyof NonNullable<ModelDetails["cost"]>] = value;
        }
      }
      if (typeof cost.input === "number" && typeof cost.output === "number") entry.cost = cost;
    }
    if (Object.keys(entry).length) details[model.id] = entry;
  }
  return JSON.stringify(details, null, 2);
}

export function channelModelsFromDetails(ids: string[], source: string): Array<{ id: string } & ModelDetails> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source || "{}");
  } catch {
    throw new Error("Model details must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Model details must be a JSON object keyed by model ID.");
  }
  const records = parsed as Record<string, unknown>;
  const allowedIds = new Set(ids);
  for (const [id, value] of Object.entries(records)) {
    if (!allowedIds.has(id)) throw new Error("Model details contain an ID not listed above.");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Each model's details must be an object.");
    }
    const details = value as Record<string, unknown>;
    if (Object.keys(details).some((key) => !DETAIL_KEYS.has(key))) {
      throw new Error("Model details contain unsupported fields.");
    }
    if (details.name !== undefined && (typeof details.name !== "string" || details.name.length > 100)) {
      throw new Error("Model names must be at most 100 characters.");
    }
    for (const key of ["contextWindow", "maxTokens"]) {
      const number = details[key];
      if (number !== undefined && (!Number.isSafeInteger(number) || (number as number) <= 0)) {
        throw new Error("Context window and maximum output must be positive integers.");
      }
    }
    if (details.cost !== undefined) {
      if (!details.cost || typeof details.cost !== "object" || Array.isArray(details.cost)) {
        throw new Error("Model cost must be an object.");
      }
      const cost = details.cost as Record<string, unknown>;
      if (typeof cost.input !== "number" || typeof cost.output !== "number") {
        throw new Error("Model cost needs both input and output prices.");
      }
      if (Object.entries(cost).some(([key, value]) => !COST_KEYS.has(key) || typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000)) {
        throw new Error("Model cost must contain nonnegative per-million-token prices.");
      }
    }
  }
  return ids.map((id) => ({
    id,
    ...(Object.hasOwn(records, id) ? records[id] as ModelDetails : {}),
  }));
}
