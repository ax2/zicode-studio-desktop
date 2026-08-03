import { describe, expect, it } from "vitest";
import { runScreening } from "./screener";

describe("finance screener", () => {
  it("ranks candidates with explainable weighted contributions", () => {
    const result = runScreening({
      securities: [
        { symbol: "VALUE", metrics: { roe: 0.14, pe: 8 } },
        { symbol: "GROWTH", metrics: { roe: 0.3, pe: 35 } },
        { symbol: "BALANCED", metrics: { roe: 0.22, pe: 15 } },
      ],
      factors: [
        { field: "roe", direction: "high", weight: 0.6 },
        { field: "pe", direction: "low", weight: 0.4 },
      ],
    });

    expect(result.results).toHaveLength(3);
    expect(result.results[0].rank).toBe(1);
    expect(result.results[0].contributions.roe).toMatchObject({
      raw: expect.any(Number),
      contribution: expect.any(Number),
    });
  });

  it("marks missing values and reduces factor coverage", () => {
    const result = runScreening({
      securities: [
        { symbol: "A", metrics: { roe: 0.2, pe: 10 } },
        { symbol: "B", metrics: { roe: 0.1, pe: null } },
        { symbol: "C", metrics: { roe: 0.15, pe: 20 } },
      ],
      factors: [
        { field: "roe", direction: "high", weight: 1 },
        { field: "pe", direction: "low", weight: 1 },
      ],
    });

    const missing = result.results.find((candidate) => candidate.symbol === "B");
    expect(missing?.coverage).toBe(0.5);
    expect(missing?.contributions.pe.missing).toBe(true);
  });

  it("rejects factors without enough comparable observations", () => {
    expect(() =>
      runScreening({
        securities: [
          { symbol: "A", metrics: { roe: 0.2 } },
          { symbol: "B", metrics: { roe: null } },
        ],
        factors: [{ field: "roe", direction: "high", weight: 1 }],
      }),
    ).toThrow("at least two numeric values");
  });
});
