export type ScreeningSecurity = {
  symbol: string;
  name?: string;
  sector?: string;
  metrics: Record<string, number | null | undefined>;
};

export type ScreeningFactor = {
  field: string;
  label?: string;
  direction: "high" | "low";
  weight: number;
};

export type ScreeningInput = {
  securities: ScreeningSecurity[];
  factors: ScreeningFactor[];
  top?: number;
  winsorizePercentile?: number;
};

type PreparedFactor = ScreeningFactor & {
  weight: number;
  lower: number;
  upper: number;
  mean: number;
  deviation: number;
};

export function runScreening(input: ScreeningInput) {
  if (!Array.isArray(input.securities) || input.securities.length < 2) {
    throw new Error("securities must contain at least two candidates");
  }
  if (!Array.isArray(input.factors) || input.factors.length === 0) {
    throw new Error("factors must contain at least one factor");
  }
  const symbols = new Set<string>();
  const securities = input.securities.map((security) => {
    const symbol = requiredText(security.symbol, "security symbol").toUpperCase();
    if (symbols.has(symbol)) throw new Error(`duplicate security symbol: ${symbol}`);
    symbols.add(symbol);
    if (!security.metrics || typeof security.metrics !== "object") {
      throw new Error(`metrics are required for ${symbol}`);
    }
    return { ...security, symbol };
  });
  const weightTotal = input.factors.reduce((sum, factor) => {
    requiredText(factor.field, "factor field");
    if (factor.direction !== "high" && factor.direction !== "low") {
      throw new Error(`invalid direction for ${factor.field}`);
    }
    if (!Number.isFinite(factor.weight) || factor.weight <= 0) {
      throw new Error(`weight must be positive for ${factor.field}`);
    }
    return sum + factor.weight;
  }, 0);
  const percentile = bounded(input.winsorizePercentile ?? 0.05, 0, 0.25, "winsorizePercentile");
  const prepared: PreparedFactor[] = input.factors.map((factor) => {
    const values = securities
      .map((security) => security.metrics[factor.field])
      .filter((value): value is number => Number.isFinite(value));
    if (values.length < 2) {
      throw new Error(`factor ${factor.field} needs at least two numeric values`);
    }
    const sorted = [...values].sort((a, b) => a - b);
    const lower = quantile(sorted, percentile);
    const upper = quantile(sorted, 1 - percentile);
    const clipped = values.map((value) => Math.min(upper, Math.max(lower, value)));
    const mean = clipped.reduce((sum, value) => sum + value, 0) / clipped.length;
    const deviation =
      Math.sqrt(
        clipped.reduce((sum, value) => sum + (value - mean) ** 2, 0) / clipped.length,
      ) || 1;
    return {
      ...factor,
      weight: factor.weight / weightTotal,
      lower,
      upper,
      mean,
      deviation,
    };
  });

  const ranked = securities
    .map((security) => {
      const contributions: Record<
        string,
        { raw: number | null; zScore: number; contribution: number; missing: boolean }
      > = {};
      let score = 0;
      let coverage = 0;
      for (const factor of prepared) {
        const raw = security.metrics[factor.field];
        const missing = !Number.isFinite(raw);
        const clipped = missing
          ? factor.mean
          : Math.min(factor.upper, Math.max(factor.lower, raw as number));
        const direction = factor.direction === "high" ? 1 : -1;
        const zScore = ((clipped - factor.mean) / factor.deviation) * direction;
        const contribution = zScore * factor.weight;
        if (!missing) coverage += factor.weight;
        score += contribution;
        contributions[factor.field] = {
          raw: missing ? null : (raw as number),
          zScore: round(zScore),
          contribution: round(contribution),
          missing,
        };
      }
      return {
        symbol: security.symbol,
        name: security.name,
        sector: security.sector,
        score: round(score),
        coverage: round(coverage),
        contributions,
      };
    })
    .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))
    .map((security, index) => ({ rank: index + 1, ...security }));

  const top = Math.max(1, Math.min(ranked.length, Math.trunc(input.top ?? ranked.length)));
  return {
    methodology: {
      normalization: "cross-sectional winsorized z-score",
      missingValues: "neutral z-score with explicit coverage penalty",
      winsorizePercentile: percentile,
      factors: prepared.map((factor) => ({
        field: factor.field,
        label: factor.label,
        direction: factor.direction,
        normalizedWeight: round(factor.weight),
      })),
    },
    universeSize: ranked.length,
    results: ranked.slice(0, top),
  };
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function bounded(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function quantile(sorted: number[], percentile: number): number {
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
