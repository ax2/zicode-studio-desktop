export function modelUnitCost(model, { inputWeight = 0.7, outputWeight = 0.3 } = {}) {
  const input = finite(model?.cost?.input);
  const output = finite(model?.cost?.output);
  if (input == null || output == null) return null;
  return input * inputWeight + output * outputWeight;
}

export function findLowestCostModel(models, { minimumContextWindow = 0 } = {}) {
  return (Array.isArray(models) ? models : [])
    .filter((model) => Number(model?.contextWindow || 0) >= minimumContextWindow)
    .map((model) => ({ model, cost: modelUnitCost(model) }))
    .filter((entry) => entry.cost != null)
    .sort((left, right) => left.cost - right.cost)[0]?.model ?? null;
}

export function estimateRequestCost(
  model,
  { inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0 } = {},
) {
  if (!model?.cost) return null;
  const total =
    tokenCost(inputTokens, model.cost.input) +
    tokenCost(outputTokens, model.cost.output) +
    tokenCost(cacheReadTokens, model.cost.cacheRead) +
    tokenCost(cacheWriteTokens, model.cost.cacheWrite);
  return Number.isFinite(total) ? total : null;
}

export function formatModelPricing(model) {
  const input = finite(model?.cost?.input);
  const output = finite(model?.cost?.output);
  if (input == null || output == null) return "";
  return `$${compact(input)}/$${compact(output)} / 1M`;
}

function tokenCost(tokens, rate) {
  const numericRate = finite(rate);
  return numericRate == null ? 0 : (Math.max(0, Number(tokens) || 0) / 1_000_000) * numericRate;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function compact(value) {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1).replace(/\.0$/, "");
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
