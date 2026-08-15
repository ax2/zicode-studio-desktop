import { t } from "../../shared/i18n";

export interface FinanceResponse {
  ok?: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

function toFiniteNumber(value: unknown): number {
  if (value === null || value === undefined) return Number.NaN;
  if (typeof value === "string" && value.trim() === "") return Number.NaN;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

export function percent(value: unknown): string {
  const numeric = toFiniteNumber(value);
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(2)}%` : "—";
}

export function number(value: unknown): string {
  const numeric = toFiniteNumber(value);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat().format(numeric)
    : "—";
}

export function shortTimestamp(): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

export function sampleBacktest(): Record<string, unknown> {
  const closes = [100, 101, 102, 101, 103, 105, 104, 106, 108, 107, 110, 112];
  return {
    bars: closes.map((close, index) => ({
      date: `2026-01-${String(index + 1).padStart(2, "0")}`,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1_000_000,
    })),
    strategy: { type: "sma_crossover", fastPeriod: 3, slowPeriod: 5 },
    initialCapital: 100000,
    feeBps: 5,
    slippageBps: 2,
  };
}

export function sampleScreening(): Record<string, unknown> {
  return {
    securities: [
      { symbol: "AAA", name: "Quality Co", metrics: { roe: 0.24, pe: 16, momentum12m: 0.18 } },
      { symbol: "BBB", name: "Value Co", metrics: { roe: 0.15, pe: 8, momentum12m: 0.04 } },
      { symbol: "CCC", name: "Growth Co", metrics: { roe: 0.3, pe: 35, momentum12m: 0.28 } },
    ],
    factors: [
      { field: "roe", label: "ROE", direction: "high", weight: 0.4 },
      { field: "pe", label: "P/E", direction: "low", weight: 0.3 },
      { field: "momentum12m", label: "12M momentum", direction: "high", weight: 0.3 },
    ],
    top: 3,
  };
}

export function sampleSnapshot(): Record<string, unknown> {
  return {
    kind: "quote",
    symbol: "600519.SH",
    market: "CN",
    currency: "CNY",
    asOf: new Date().toISOString(),
    source: {
      provider: "QVeris",
      toolId: "replace-with-discovered-tool-id",
      searchId: "replace-with-search-id",
      executionId: "replace-with-execution-id",
    },
    payload: { price: 1400 },
  };
}

export function samplePaperOrder(): Record<string, unknown> {
  return {
    accountId: "paper-account-id",
    symbol: "600519.SH",
    side: "buy",
    quantity: 100,
    snapshot: {
      price: 1400,
      asOf: new Date().toISOString(),
      source: "QVeris execution id",
    },
  };
}

export function samplePaperLimit(): Record<string, unknown> {
  return {
    action: "place",
    accountId: "paper-account-id",
    symbol: "600519.SH",
    side: "buy",
    quantity: 100,
    limitPrice: 1380,
    currency: "CNY",
  };
}

export function samplePaperMark(): Record<string, unknown> {
  return {
    accountId: "paper-account-id",
    quotes: [
      {
        symbol: "600519.SH",
        price: 1410,
        asOf: new Date().toISOString(),
        source: "QVeris exec_...",
        currency: "CNY",
      },
    ],
  };
}

export interface FinanceViewDefinition {
  id: string;
  labelKey: string;
  group: string;
}

export const FINANCE_VIEWS: FinanceViewDefinition[] = [
  { id: "overview", labelKey: "Overview", group: "Data" },
  { id: "discovery", labelKey: "Capability discovery", group: "Data" },
  { id: "snapshots", labelKey: "Market data snapshots", group: "Data" },
  { id: "backtest", labelKey: "Strategy backtest", group: "Analysis" },
  { id: "screening", labelKey: "Multi-factor screener", group: "Analysis" },
  { id: "research", labelKey: "Research workspace", group: "Research" },
  { id: "paper", labelKey: "Paper trading", group: "Accounts" },
];

export function financeGroupLabel(group: string): string {
  return t(group);
}

export function financeViewLabel(view: FinanceViewDefinition): string {
  return t(view.labelKey);
}

export function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value : [];
}
