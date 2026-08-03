import { describe, expect, it } from "vitest";
import {
  estimateRequestCost,
  findLowestCostModel,
  formatModelPricing,
  modelUnitCost,
} from "./model-routing.js";

describe("model routing", () => {
  const cheap = { id: "cheap", contextWindow: 128000, cost: { input: 1, output: 3 } };
  const premium = { id: "premium", contextWindow: 200000, cost: { input: 5, output: 15 } };

  it("selects the lowest-cost model that meets the context requirement", () => {
    expect(findLowestCostModel([premium, cheap], { minimumContextWindow: 100000 })).toBe(cheap);
    expect(findLowestCostModel([cheap], { minimumContextWindow: 150000 })).toBeNull();
  });

  it("estimates token cost using per-million pricing", () => {
    expect(estimateRequestCost(cheap, { inputTokens: 500000, outputTokens: 100000 })).toBeCloseTo(0.8);
    expect(modelUnitCost(cheap)).toBeCloseTo(1.6);
    expect(formatModelPricing(cheap)).toBe("$1/$3 / 1M");
  });
});
