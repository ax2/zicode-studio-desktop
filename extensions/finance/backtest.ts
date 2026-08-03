export type PriceBar = {
  date: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
};

export type BacktestStrategy =
  | { type: "buy_and_hold" }
  | { type: "sma_crossover"; fastPeriod: number; slowPeriod: number }
  | { type: "donchian_breakout"; entryPeriod: number; exitPeriod: number }
  | {
      type: "rsi_mean_reversion";
      period: number;
      oversold: number;
      overbought: number;
    };

export type BacktestInput = {
  bars: PriceBar[];
  strategy: BacktestStrategy;
  initialCapital?: number;
  feeBps?: number;
  slippageBps?: number;
};

type Trade = {
  side: "buy" | "sell";
  signalDate: string;
  executionDate: string;
  price: number;
  quantity: number;
  fee: number;
};

export function runBacktest(input: BacktestInput) {
  const bars = validateBars(input.bars);
  const initialCapital = positive(input.initialCapital ?? 100_000, "initialCapital");
  const feeRate = nonNegative(input.feeBps ?? 5, "feeBps") / 10_000;
  const slippageRate = nonNegative(input.slippageBps ?? 2, "slippageBps") / 10_000;
  const targetPositions = buildTargetPositions(bars, input.strategy);
  let cash = initialCapital;
  let shares = 0;
  const trades: Trade[] = [];
  const equityCurve: Array<{ date: string; equity: number; drawdown: number }> = [];
  let peak = initialCapital;

  // A signal observed at bar N closes is executed at bar N+1 open. This avoids look-ahead bias.
  for (let index = 0; index < bars.length; index += 1) {
    if (index > 0) {
      const desiredLong = targetPositions[index - 1] === 1;
      const executionPrice = finite(bars[index].open ?? bars[index].close, "execution price");
      if (desiredLong && shares === 0) {
        const price = executionPrice * (1 + slippageRate);
        const quantity = Math.floor(cash / (price * (1 + feeRate)));
        if (quantity > 0) {
          const fee = quantity * price * feeRate;
          cash -= quantity * price + fee;
          shares = quantity;
          trades.push({
            side: "buy",
            signalDate: bars[index - 1].date,
            executionDate: bars[index].date,
            price,
            quantity,
            fee,
          });
        }
      } else if (!desiredLong && shares > 0) {
        const price = executionPrice * (1 - slippageRate);
        const fee = shares * price * feeRate;
        cash += shares * price - fee;
        trades.push({
          side: "sell",
          signalDate: bars[index - 1].date,
          executionDate: bars[index].date,
          price,
          quantity: shares,
          fee,
        });
        shares = 0;
      }
    }
    const equity = cash + shares * bars[index].close;
    peak = Math.max(peak, equity);
    equityCurve.push({
      date: bars[index].date,
      equity: round(equity),
      drawdown: round(equity / peak - 1),
    });
  }

  const finalEquity = equityCurve.at(-1)?.equity ?? initialCapital;
  const dailyReturns = equityCurve.slice(1).map((point, index) => {
    const previous = equityCurve[index].equity;
    return previous === 0 ? 0 : point.equity / previous - 1;
  });
  const years = Math.max(daysBetween(bars[0].date, bars.at(-1)?.date || bars[0].date) / 365.25, 1 / 252);
  const roundTrips = pairRoundTrips(trades, shares, bars.at(-1)?.close ?? 0);

  return {
    assumptions: {
      signalTiming: "close signal, next-bar open execution",
      initialCapital,
      feeBps: input.feeBps ?? 5,
      slippageBps: input.slippageBps ?? 2,
      longOnly: true,
    },
    metrics: {
      finalEquity: round(finalEquity),
      totalReturn: round(finalEquity / initialCapital - 1),
      cagr: round((finalEquity / initialCapital) ** (1 / years) - 1),
      annualizedVolatility: round(standardDeviation(dailyReturns) * Math.sqrt(252)),
      sharpeRatio: round(sharpe(dailyReturns)),
      maxDrawdown: round(Math.min(...equityCurve.map((point) => point.drawdown))),
      completedTrades: roundTrips.length,
      winRate: round(
        roundTrips.length
          ? roundTrips.filter((trade) => trade.pnl > 0).length / roundTrips.length
          : 0,
      ),
    },
    trades,
    equityCurve,
  };
}

function buildTargetPositions(bars: PriceBar[], strategy: BacktestStrategy): number[] {
  if (strategy.type === "buy_and_hold") return bars.map(() => 1);
  if (strategy.type === "sma_crossover") {
    const fast = integerInRange(strategy.fastPeriod, 2, 500, "fastPeriod");
    const slow = integerInRange(strategy.slowPeriod, 3, 1000, "slowPeriod");
    if (fast >= slow) throw new Error("fastPeriod must be smaller than slowPeriod");
    return bars.map((_bar, index) => {
      const fastAverage = averageWindow(bars, index, fast);
      const slowAverage = averageWindow(bars, index, slow);
      return fastAverage !== null && slowAverage !== null && fastAverage > slowAverage ? 1 : 0;
    });
  }
  if (strategy.type === "donchian_breakout") {
    const entryPeriod = integerInRange(strategy.entryPeriod, 2, 500, "entryPeriod");
    const exitPeriod = integerInRange(strategy.exitPeriod, 2, 500, "exitPeriod");
    let position = 0;
    return bars.map((bar, index) => {
      const priorHigh = channelExtreme(bars, index, entryPeriod, "high");
      const priorLow = channelExtreme(bars, index, exitPeriod, "low");
      if (position === 0 && priorHigh !== null && bar.close > priorHigh) position = 1;
      else if (position === 1 && priorLow !== null && bar.close < priorLow) position = 0;
      return position;
    });
  }
  const period = integerInRange(strategy.period, 2, 100, "period");
  const oversold = finite(strategy.oversold, "oversold");
  const overbought = finite(strategy.overbought, "overbought");
  if (!(oversold > 0 && oversold < overbought && overbought < 100)) {
    throw new Error("RSI thresholds must satisfy 0 < oversold < overbought < 100");
  }
  let position = 0;
  return bars.map((_bar, index) => {
    const value = rsiAt(bars, index, period);
    if (value !== null && value <= oversold) position = 1;
    if (value !== null && value >= overbought) position = 0;
    return position;
  });
}

function validateBars(input: PriceBar[]): PriceBar[] {
  if (!Array.isArray(input) || input.length < 3 || input.length > 10_000) {
    throw new Error("bars must contain between 3 and 10,000 price bars");
  }
  const bars = input.map((bar) => ({
    ...bar,
    date: String(bar.date),
    close: positive(bar.close, "bar close"),
    open: bar.open === undefined ? undefined : positive(bar.open, "bar open"),
    high: bar.high === undefined ? undefined : positive(bar.high, "bar high"),
    low: bar.low === undefined ? undefined : positive(bar.low, "bar low"),
    volume: bar.volume === undefined ? undefined : nonNegative(bar.volume, "bar volume"),
  }));
  for (const bar of bars) {
    const observed = [bar.open, bar.high, bar.low, bar.close].filter(
      (value): value is number => value !== undefined,
    );
    if (bar.high !== undefined && bar.high < Math.max(...observed)) {
      throw new Error("bar high is below another price");
    }
    if (bar.low !== undefined && bar.low > Math.min(...observed)) {
      throw new Error("bar low is above another price");
    }
  }
  for (let index = 1; index < bars.length; index += 1) {
    if (Date.parse(bars[index].date) <= Date.parse(bars[index - 1].date)) {
      throw new Error("bars must be strictly ordered by date");
    }
  }
  return bars;
}

function channelExtreme(
  bars: PriceBar[],
  index: number,
  period: number,
  side: "high" | "low",
): number | null {
  if (index < period) return null;
  const values = bars.slice(index - period, index).map((bar) =>
    side === "high" ? (bar.high ?? bar.close) : (bar.low ?? bar.close),
  );
  return side === "high" ? Math.max(...values) : Math.min(...values);
}

function averageWindow(bars: PriceBar[], index: number, period: number): number | null {
  if (index + 1 < period) return null;
  let total = 0;
  for (let offset = index - period + 1; offset <= index; offset += 1) total += bars[offset].close;
  return total / period;
}

function rsiAt(bars: PriceBar[], index: number, period: number): number | null {
  if (index < period) return null;
  let gains = 0;
  let losses = 0;
  for (let offset = index - period + 1; offset <= index; offset += 1) {
    const change = bars[offset].close - bars[offset - 1].close;
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  const relativeStrength = gains / losses;
  return 100 - 100 / (1 + relativeStrength);
}

function pairRoundTrips(trades: Trade[], openShares: number, lastClose: number) {
  const results: Array<{ entryDate: string; exitDate: string; pnl: number }> = [];
  let entry: Trade | undefined;
  for (const trade of trades) {
    if (trade.side === "buy") entry = trade;
    if (trade.side === "sell" && entry) {
      results.push({
        entryDate: entry.executionDate,
        exitDate: trade.executionDate,
        pnl: round(
          trade.quantity * trade.price -
            trade.fee -
            (entry.quantity * entry.price + entry.fee),
        ),
      });
      entry = undefined;
    }
  }
  if (entry && openShares > 0) {
    results.push({
      entryDate: entry.executionDate,
      exitDate: "open",
      pnl: round(openShares * lastClose - (entry.quantity * entry.price + entry.fee)),
    });
  }
  return results;
}

function sharpe(returns: number[]): number {
  const deviation = standardDeviation(returns);
  if (!returns.length || deviation === 0) return 0;
  return (average(returns) / deviation) * Math.sqrt(252);
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function average(values: number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function daysBetween(start: string, end: string): number {
  return Math.max(1, (Date.parse(end) - Date.parse(start)) / 86_400_000);
}

function integerInRange(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function positive(value: number, name: string): number {
  const parsed = finite(value, name);
  if (parsed <= 0) throw new Error(`${name} must be positive`);
  return parsed;
}

function nonNegative(value: number, name: string): number {
  const parsed = finite(value, name);
  if (parsed < 0) throw new Error(`${name} must be non-negative`);
  return parsed;
}

function finite(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
