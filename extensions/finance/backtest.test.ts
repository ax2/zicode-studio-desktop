import { describe, expect, it } from "vitest";
import { runBacktest, type PriceBar } from "./backtest";

function bars(closes: number[]): PriceBar[] {
  return closes.map((close, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, "0")}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
  }));
}

describe("finance backtest", () => {
  it("executes close signals on the next bar and reports transaction assumptions", () => {
    const result = runBacktest({
      bars: bars([10, 11, 12, 13, 14]),
      strategy: { type: "buy_and_hold" },
      initialCapital: 1_000,
      feeBps: 0,
      slippageBps: 0,
    });

    expect(result.trades[0]).toMatchObject({
      side: "buy",
      signalDate: "2026-01-01",
      executionDate: "2026-01-02",
      price: 11,
    });
    expect(result.metrics.totalReturn).toBeGreaterThan(0);
    expect(result.assumptions.signalTiming).toContain("next-bar open");
  });

  it("does not trade an SMA crossover before both windows exist", () => {
    const result = runBacktest({
      bars: bars([10, 10, 10, 11, 12, 13, 12, 11]),
      strategy: { type: "sma_crossover", fastPeriod: 2, slowPeriod: 4 },
      feeBps: 0,
      slippageBps: 0,
    });

    expect(result.trades[0]?.signalDate).toBe("2026-01-04");
    expect(result.trades[0]?.executionDate).toBe("2026-01-05");
  });

  it("rejects unsorted data and invalid strategy parameters", () => {
    const unordered = bars([10, 11, 12]);
    unordered[2].date = "2025-12-01";
    expect(() =>
      runBacktest({ bars: unordered, strategy: { type: "buy_and_hold" } }),
    ).toThrow("strictly ordered");
    expect(() =>
      runBacktest({
        bars: bars([10, 11, 12, 13]),
        strategy: { type: "sma_crossover", fastPeriod: 5, slowPeriod: 3 },
      }),
    ).toThrow("fastPeriod");
  });

  it("runs a Donchian breakout from prior windows without same-bar look-ahead", () => {
    const result = runBacktest({
      bars: [
        { date: "2026-01-01", open: 10, high: 10, low: 9, close: 9.5 },
        { date: "2026-01-02", open: 10, high: 11, low: 9.5, close: 10.5 },
        { date: "2026-01-03", open: 11, high: 12, low: 10, close: 11 },
        { date: "2026-01-04", open: 12, high: 13, low: 11, close: 12.5 },
        { date: "2026-01-05", open: 13, high: 14, low: 12, close: 13.5 },
      ],
      strategy: { type: "donchian_breakout", entryPeriod: 2, exitPeriod: 2 },
      feeBps: 0,
      slippageBps: 0,
    });

    expect(result.trades[0]).toMatchObject({
      side: "buy",
      signalDate: "2026-01-04",
      executionDate: "2026-01-05",
      price: 13,
    });
  });
});
