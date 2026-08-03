import { describe, expect, it } from "vitest";
import { normalizeOhlcv } from "./normalize";

describe("OHLCV normalization", () => {
  it("maps provider-specific fields, sorts rows, and preserves provenance", () => {
    const result = normalizeOhlcv({
      rows: [
        { trade_date: "2026-07-31", o: "11", h: "12", l: "10", c: "11.5", vol: "1000" },
        { trade_date: "2026-07-30", o: "10", h: "11", l: "9", c: "10.5", vol: "900" },
      ],
      mapping: {
        date: "trade_date",
        open: "o",
        high: "h",
        low: "l",
        close: "c",
        volume: "vol",
      },
      instrument: {
        symbol: "600000.sh",
        market: "cn",
        currency: "cny",
        interval: "1d",
        adjustment: "provider_adjusted",
      },
      source: { provider: "QVeris", executionId: "exec_test" },
    });

    expect(result).toMatchObject({
      instrument: { symbol: "600000.SH", market: "CN", currency: "CNY" },
      source: { executionId: "exec_test" },
      range: { observations: 2 },
      bars: [
        { open: 10, close: 10.5, volume: 900 },
        { open: 11, close: 11.5, volume: 1000 },
      ],
    });
  });

  it("rejects impossible high-low relationships and duplicate timestamps", () => {
    const base = {
      mapping: { date: "date", high: "high", low: "low", close: "close" },
      instrument: {
        symbol: "AAPL",
        market: "US",
        currency: "USD",
        interval: "1d",
        adjustment: "raw" as const,
      },
      source: { provider: "test" },
    };
    expect(() =>
      normalizeOhlcv({
        ...base,
        rows: [
          { date: "2026-01-01", high: 9, low: 8, close: 10 },
          { date: "2026-01-02", high: 11, low: 9, close: 10 },
        ],
      }),
    ).toThrow("high is below");
    expect(() =>
      normalizeOhlcv({
        ...base,
        rows: [
          { date: "2026-01-01", high: 11, low: 9, close: 10 },
          { date: "2026-01-01", high: 12, low: 10, close: 11 },
        ],
      }),
    ).toThrow("duplicate OHLCV timestamp");
  });
});
