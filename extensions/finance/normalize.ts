import type { PriceBar } from "./backtest";

export type OhlcvMapping = {
  date: string;
  open?: string;
  high?: string;
  low?: string;
  close: string;
  volume?: string;
};

export type NormalizeOhlcvInput = {
  rows: Array<Record<string, unknown>>;
  mapping: OhlcvMapping;
  instrument: {
    symbol: string;
    market: string;
    currency: string;
    interval: string;
    adjustment: "raw" | "split" | "total_return" | "provider_adjusted";
  };
  source: {
    provider: string;
    toolId?: string;
    searchId?: string;
    executionId?: string;
  };
};

export function normalizeOhlcv(input: NormalizeOhlcvInput) {
  if (!Array.isArray(input.rows) || input.rows.length < 2 || input.rows.length > 10_000) {
    throw new Error("rows must contain between 2 and 10,000 observations");
  }
  const mapping = validateMapping(input.mapping);
  const instrument = {
    symbol: required(input.instrument?.symbol, "instrument.symbol").toUpperCase(),
    market: required(input.instrument?.market, "instrument.market").toUpperCase(),
    currency: currency(input.instrument?.currency),
    interval: required(input.instrument?.interval, "instrument.interval"),
    adjustment: input.instrument?.adjustment,
  };
  if (!["raw", "split", "total_return", "provider_adjusted"].includes(instrument.adjustment)) {
    throw new Error("instrument.adjustment is required");
  }
  const source = {
    provider: required(input.source?.provider, "source.provider"),
    toolId: optional(input.source?.toolId),
    searchId: optional(input.source?.searchId),
    executionId: optional(input.source?.executionId),
  };
  const bars = input.rows
    .map((row, index) => normalizeRow(row, mapping, index))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (let index = 1; index < bars.length; index += 1) {
    if (bars[index - 1].date === bars[index].date) {
      throw new Error(`duplicate OHLCV timestamp: ${bars[index].date}`);
    }
  }
  return {
    instrument,
    source,
    range: { start: bars[0].date, end: bars.at(-1)?.date, observations: bars.length },
    bars,
  };
}

function normalizeRow(
  row: Record<string, unknown>,
  mapping: OhlcvMapping,
  index: number,
): PriceBar {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`row ${index} must be an object`);
  }
  const date = timestamp(row[mapping.date], `row ${index} date`);
  const close = price(row[mapping.close], `row ${index} close`);
  const open = mapping.open ? price(row[mapping.open], `row ${index} open`) : undefined;
  const high = mapping.high ? price(row[mapping.high], `row ${index} high`) : undefined;
  const low = mapping.low ? price(row[mapping.low], `row ${index} low`) : undefined;
  const volume = mapping.volume
    ? nonNegativeNumber(row[mapping.volume], `row ${index} volume`)
    : undefined;
  const observed = [open, high, low, close].filter((value): value is number => value !== undefined);
  if (high !== undefined && high < Math.max(...observed)) {
    throw new Error(`row ${index} high is below another price`);
  }
  if (low !== undefined && low > Math.min(...observed)) {
    throw new Error(`row ${index} low is above another price`);
  }
  return { date, open, high, low, close, volume };
}

function validateMapping(mapping: OhlcvMapping): OhlcvMapping {
  return {
    date: required(mapping?.date, "mapping.date"),
    close: required(mapping?.close, "mapping.close"),
    open: optional(mapping?.open),
    high: optional(mapping?.high),
    low: optional(mapping?.low),
    volume: optional(mapping?.volume),
  };
}

function required(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function currency(value: unknown): string {
  const normalized = required(value, "instrument.currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error("instrument.currency is invalid");
  return normalized;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${label} is invalid`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is invalid`);
  return date.toISOString();
}

function price(value: unknown, label: string): number {
  const normalized = numeric(value, label);
  if (normalized <= 0) throw new Error(`${label} must be positive`);
  return normalized;
}

function nonNegativeNumber(value: unknown, label: string): number {
  const normalized = numeric(value, label);
  if (normalized < 0) throw new Error(`${label} must be non-negative`);
  return normalized;
}

function numeric(value: unknown, label: string): number {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(normalized)) throw new Error(`${label} must be numeric`);
  return normalized;
}
