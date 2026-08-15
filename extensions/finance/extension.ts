import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { runBacktest, type BacktestInput } from "./backtest";
import { MarketDataStore, type MarketDataSnapshotInput } from "./market-data";
import { normalizeOhlcv, type NormalizeOhlcvInput } from "./normalize";
import { PaperTradingLedger } from "./paper-trading";
import { QVerisClient } from "./qveris-client";
import { runScreening, type ScreeningInput } from "./screener";

const jsonObject = Type.Record(Type.String(), Type.Any());
const priceBar = Type.Object({
  date: Type.String({ description: "ISO date or datetime" }),
  open: Type.Optional(Type.Number()),
  high: Type.Optional(Type.Number()),
  low: Type.Optional(Type.Number()),
  close: Type.Number(),
  volume: Type.Optional(Type.Number()),
});

export function setupFinanceTools(pi: ExtensionAPI, client = new QVerisClient()): void {
  if (process.env.PI_DESKTOP_SCENE_ID !== "finance") return;
  const paperLedger = new PaperTradingLedger();
  const marketData = new MarketDataStore();

  pi.registerCommand("finance-status", {
    description: "Show the built-in finance workbench and QVeris connection status",
    handler: async (_arguments, ctx) => {
      const status = client.credentialStatus();
      ctx.ui.notify(
        status.configured
          ? "Finance workbench ready. QVeris data credential is configured."
          : "Finance workbench ready. Configure the QVeris API Key to enable external data.",
        status.configured ? "info" : "warning",
      );
    },
  });

  pi.registerTool({
    name: "qveris_status",
    label: "QVeris Status",
    description:
      "Check whether this finance scene has a QVeris API Key configured. Never returns the credential.",
    promptSnippet: "Check whether the finance data connection is configured.",
    parameters: Type.Object({}),
    async execute() {
      return toolResult(client.credentialStatus());
    },
  });

  pi.registerTool({
    name: "qveris_discover",
    label: "Discover Financial Data",
    description:
      "Discover current QVeris capabilities for live or historical market data, fundamentals, filings, news, macro data, or other investment research. Discovery is free.",
    promptSnippet:
      "Discover a financial data capability before requesting live external market information.",
    promptGuidelines: [
      "Describe the capability needed, not the ticker values or parameter names.",
      "Prefer compact routing results, then inspect the best candidates before a paid call.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description:
          "Capability-level description, for example: historical daily adjusted equity prices",
      }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
      lang: Type.Optional(Type.Union([Type.Literal("zh"), Type.Literal("en")])),
    }),
    async execute(_id, params, signal) {
      return toolResult(
        await client.discover(
          {
            query: params.query,
            limit: params.limit,
            lang: params.lang,
          },
          signal,
        ),
      );
    },
  });

  pi.registerTool({
    name: "qveris_inspect",
    label: "Inspect Financial Capability",
    description:
      "Inspect QVeris capability schemas, examples, reliability, latency, and billing before calling.",
    promptSnippet: "Inspect a discovered financial capability before using it.",
    parameters: Type.Object({
      tool_ids: Type.Array(Type.String(), { minItems: 1, maxItems: 10 }),
      search_id: Type.Optional(Type.String()),
    }),
    async execute(_id, params, signal) {
      return toolResult(
        await client.inspect(
          {
            toolIds: params.tool_ids,
            searchId: params.search_id,
          },
          signal,
        ),
      );
    },
  });

  pi.registerTool({
    name: "qveris_call",
    label: "Call Financial Capability",
    description:
      "Call a capability selected from the current QVeris Discover/Inspect result. Calls may consume credits and require explicit cost confirmation.",
    promptSnippet:
      "Call a discovered financial capability only after checking its current schema and cost.",
    promptGuidelines: [
      "Use the exact tool_id, search_id, and parameter schema returned by the current discovery.",
      "Before calling, show the user the expected cost or billing rule and obtain confirmation.",
      "Preserve execution_id, cost, billing, and as-of fields in the result for auditability.",
    ],
    parameters: Type.Object({
      tool_id: Type.String(),
      search_id: Type.String(),
      parameters: jsonObject,
      model: Type.Optional(Type.String()),
      respond_with: Type.Optional(Type.String({ description: "full, summary, or fields:<JSONPath>" })),
      user_confirmed_cost: Type.Boolean({
        description: "True only after the user has approved the disclosed expected cost",
      }),
    }),
    async execute(_id, params, signal) {
      if (params.user_confirmed_cost !== true) {
        throw new Error(
          "QVeris Call was not executed because the expected credit cost has not been confirmed.",
        );
      }
      return toolResult(
        await client.call(
          {
            toolId: params.tool_id,
            searchId: params.search_id,
            parameters: params.parameters,
            model: params.model,
            respondWith: params.respond_with,
          },
          signal,
        ),
      );
    },
  });

  pi.registerTool({
    name: "qveris_usage",
    label: "QVeris Usage Audit",
    description:
      "Read final QVeris request charge outcomes or credit movements with context-safe filters.",
    promptSnippet:
      "Audit a QVeris execution after Call instead of inferring final billing from success alone.",
    parameters: Type.Union([
      Type.Object({
        view: Type.Literal("usage"),
        executionId: Type.Optional(Type.String()),
        startDate: Type.Optional(Type.String()),
        endDate: Type.Optional(Type.String()),
        kind: Type.Optional(
          Type.Union([Type.Literal("discover"), Type.Literal("call"), Type.Literal("model")]),
        ),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
      }),
      Type.Object({
        view: Type.Literal("ledger"),
        startDate: Type.Optional(Type.String()),
        endDate: Type.Optional(Type.String()),
        direction: Type.Optional(
          Type.Union([Type.Literal("consume"), Type.Literal("grant"), Type.Literal("any")]),
        ),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
      }),
    ]),
    async execute(_id, params, signal) {
      if (params.view === "usage") {
        return toolResult(await client.usageAudit({ ...params, summary: true }, signal));
      }
      return toolResult(await client.creditsLedger({ ...params, summary: true }, signal));
    },
  });

  pi.registerTool({
    name: "finance_backtest",
    label: "Finance Backtest",
    description:
      "Run a deterministic long-only backtest on validated OHLCV bars. Signals use close data and execute on the next bar to avoid look-ahead bias.",
    promptSnippet:
      "Backtest a strategy locally after obtaining ordered historical bars from a reliable data capability.",
    promptGuidelines: [
      "State the instrument, market, currency, bar interval, date range, adjustment method, and data source.",
      "Do not describe a backtest as predictive; report costs, drawdown, sample period, and limitations.",
    ],
    parameters: Type.Object({
      bars: Type.Array(priceBar, { minItems: 3, maxItems: 10_000 }),
      strategy: Type.Union([
        Type.Object({ type: Type.Literal("buy_and_hold") }),
        Type.Object({
          type: Type.Literal("sma_crossover"),
          fastPeriod: Type.Number({ minimum: 2, maximum: 500 }),
          slowPeriod: Type.Number({ minimum: 3, maximum: 1000 }),
        }),
        Type.Object({
          type: Type.Literal("donchian_breakout"),
          entryPeriod: Type.Number({ minimum: 2, maximum: 500 }),
          exitPeriod: Type.Number({ minimum: 2, maximum: 500 }),
        }),
        Type.Object({
          type: Type.Literal("rsi_mean_reversion"),
          period: Type.Number({ minimum: 2, maximum: 100 }),
          oversold: Type.Number({ exclusiveMinimum: 0, maximum: 99 }),
          overbought: Type.Number({ minimum: 1, exclusiveMaximum: 100 }),
        }),
      ]),
      initialCapital: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
      feeBps: Type.Optional(Type.Number({ minimum: 0 })),
      slippageBps: Type.Optional(Type.Number({ minimum: 0 })),
    }),
    async execute(_id, params) {
      return toolResult(runBacktest(params as BacktestInput));
    },
  });

  pi.registerTool({
    name: "finance_normalize_ohlcv",
    label: "Normalize OHLCV",
    description:
      "Map provider-specific tabular fields into validated, ordered OHLCV bars while preserving instrument metadata and provenance.",
    promptSnippet:
      "Normalize QVeris historical price rows with an explicit mapping derived from the inspected capability schema.",
    promptGuidelines: [
      "Never guess field names; derive the mapping from the current Inspect schema and returned rows.",
      "State adjustment method explicitly and preserve QVeris tool, search, and execution identifiers.",
    ],
    parameters: Type.Object({
      rows: Type.Array(Type.Record(Type.String(), Type.Any()), { minItems: 2, maxItems: 10_000 }),
      mapping: Type.Object({
        date: Type.String(),
        open: Type.Optional(Type.String()),
        high: Type.Optional(Type.String()),
        low: Type.Optional(Type.String()),
        close: Type.String(),
        volume: Type.Optional(Type.String()),
      }),
      instrument: Type.Object({
        symbol: Type.String(),
        market: Type.String(),
        currency: Type.String(),
        interval: Type.String(),
        adjustment: Type.Union([
          Type.Literal("raw"),
          Type.Literal("split"),
          Type.Literal("total_return"),
          Type.Literal("provider_adjusted"),
        ]),
      }),
      source: Type.Object({
        provider: Type.String(),
        toolId: Type.Optional(Type.String()),
        searchId: Type.Optional(Type.String()),
        executionId: Type.Optional(Type.String()),
      }),
    }),
    async execute(_id, params) {
      return toolResult(normalizeOhlcv(params as NormalizeOhlcvInput));
    },
  });

  pi.registerTool({
    name: "finance_screen",
    label: "Finance Screener",
    description:
      "Rank a supplied stock universe with transparent, local multi-factor scoring. Missing data is neutralized and reported as reduced coverage.",
    promptSnippet:
      "Screen a consistently dated stock universe locally and explain every factor contribution.",
    promptGuidelines: [
      "Use metrics from the same as-of date and disclose universe, exclusions, currency, and source.",
      "Treat rankings as research candidates, not predictions or personalized investment advice.",
    ],
    parameters: Type.Object({
      securities: Type.Array(
        Type.Object({
          symbol: Type.String(),
          name: Type.Optional(Type.String()),
          sector: Type.Optional(Type.String()),
          metrics: Type.Record(Type.String(), Type.Union([Type.Number(), Type.Null()])),
        }),
        { minItems: 2, maxItems: 5_000 },
      ),
      factors: Type.Array(
        Type.Object({
          field: Type.String(),
          label: Type.Optional(Type.String()),
          direction: Type.Union([Type.Literal("high"), Type.Literal("low")]),
          weight: Type.Number({ exclusiveMinimum: 0 }),
        }),
        { minItems: 1, maxItems: 30 },
      ),
      top: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
      winsorizePercentile: Type.Optional(Type.Number({ minimum: 0, maximum: 0.25 })),
    }),
    async execute(_id, params) {
      return toolResult(runScreening(params as ScreeningInput));
    },
  });

  pi.registerTool({
    name: "finance_market_data",
    label: "Finance Market Data",
    description:
      "Persist or retrieve bounded scene-local financial data snapshots with as-of time and QVeris provenance.",
    promptSnippet:
      "Save external financial results as sourced snapshots before using them in screening, backtests, or paper trading.",
    parameters: Type.Union([
      Type.Object({
        action: Type.Literal("save"),
        snapshot: Type.Object({
          kind: Type.Union([
            Type.Literal("quote"),
            Type.Literal("ohlcv"),
            Type.Literal("fundamentals"),
            Type.Literal("news"),
            Type.Literal("macro"),
          ]),
          symbol: Type.Optional(Type.String()),
          market: Type.Optional(Type.String()),
          currency: Type.Optional(Type.String()),
          asOf: Type.String(),
          source: Type.Object({
            provider: Type.String(),
            toolId: Type.Optional(Type.String()),
            searchId: Type.Optional(Type.String()),
            executionId: Type.Optional(Type.String()),
          }),
          payload: Type.Any(),
        }),
      }),
      Type.Object({
        action: Type.Literal("latest"),
        kind: Type.Union([
          Type.Literal("quote"),
          Type.Literal("ohlcv"),
          Type.Literal("fundamentals"),
          Type.Literal("news"),
          Type.Literal("macro"),
        ]),
        symbol: Type.Optional(Type.String()),
        market: Type.Optional(Type.String()),
      }),
      Type.Object({
        action: Type.Literal("list"),
        kind: Type.Optional(
          Type.Union([
            Type.Literal("quote"),
            Type.Literal("ohlcv"),
            Type.Literal("fundamentals"),
            Type.Literal("news"),
            Type.Literal("macro"),
          ]),
        ),
        symbol: Type.Optional(Type.String()),
        market: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
      }),
    ]),
    async execute(_id, params) {
      if (params.action === "save") {
        return toolResult(marketData.save(params.snapshot as MarketDataSnapshotInput));
      }
      if (params.action === "latest") return toolResult(marketData.latest(params));
      return toolResult({ snapshots: marketData.list(params) });
    },
  });

  pi.registerTool({
    name: "finance_paper_account",
    label: "Paper Trading Account",
    description:
      "Create, list, or inspect isolated paper-trading accounts. Accounts never connect to a real broker.",
    promptSnippet: "Manage a simulated account whose balances are derived from its fill ledger.",
    parameters: Type.Union([
      Type.Object({ action: Type.Literal("list") }),
      Type.Object({ action: Type.Literal("get"), accountId: Type.String() }),
      Type.Object({
        action: Type.Literal("mark"),
        accountId: Type.String(),
        quotes: Type.Array(
          Type.Object({
            symbol: Type.String(),
            price: Type.Number({ exclusiveMinimum: 0 }),
            asOf: Type.String(),
            source: Type.String(),
            currency: Type.Optional(Type.String()),
            snapshotId: Type.Optional(Type.String()),
          }),
        ),
        maxAgeMinutes: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
      }),
      Type.Object({
        action: Type.Literal("create"),
        name: Type.String(),
        baseCurrency: Type.Optional(Type.String()),
        initialCash: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
      }),
      Type.Object({
        action: Type.Literal("remove"),
        accountId: Type.String(),
      }),
    ]),
    async execute(_id, params) {
      if (params.action === "list") return toolResult({ accounts: paperLedger.listAccounts() });
      if (params.action === "get") return toolResult(paperLedger.getAccount(params.accountId));
      if (params.action === "mark") {
        return toolResult(
          paperLedger.markToMarket({
            accountId: params.accountId,
            quotes: params.quotes,
            maxAgeMinutes: params.maxAgeMinutes,
          }),
        );
      }
      if (params.action === "remove") {
        return toolResult(paperLedger.removeAccount(params.accountId));
      }
      return toolResult(
        paperLedger.createAccount({
          name: params.name,
          baseCurrency: params.baseCurrency,
          initialCash: params.initialCash,
        }),
      );
    },
  });

  pi.registerTool({
    name: "finance_paper_order",
    label: "Paper Market Order",
    description:
      "Record an immediately filled simulated market order using an explicit external-data snapshot. This never submits a real order.",
    promptSnippet:
      "Record a simulated fill only when symbol, quantity, price, source, and as-of timestamp are explicit.",
    promptGuidelines: [
      "Always call this a simulation and never imply that a real broker order was placed.",
      "Use a current sourced market snapshot; preserve its timestamp and source in the ledger.",
    ],
    parameters: Type.Object({
      accountId: Type.String(),
      symbol: Type.String(),
      side: Type.Union([Type.Literal("buy"), Type.Literal("sell")]),
      quantity: Type.Number({ minimum: 1 }),
      snapshot: Type.Object({
        price: Type.Number({ exclusiveMinimum: 0 }),
        asOf: Type.String(),
        source: Type.String(),
        snapshotId: Type.Optional(Type.String()),
      }),
      feeBps: Type.Optional(Type.Number({ minimum: 0 })),
    }),
    async execute(_id, params) {
      return toolResult(paperLedger.executeMarketOrder(params));
    },
  });

  pi.registerTool({
    name: "finance_paper_limit_order",
    label: "Paper Limit Orders",
    description:
      "Place, cancel, or process isolated simulated limit orders. Pending orders reserve simulated cash or positions and never reach a broker.",
    promptSnippet:
      "Manage pending simulated limit orders and process them only against explicit sourced quote snapshots.",
    parameters: Type.Union([
      Type.Object({
        action: Type.Literal("place"),
        accountId: Type.String(),
        symbol: Type.String(),
        side: Type.Union([Type.Literal("buy"), Type.Literal("sell")]),
        quantity: Type.Number({ minimum: 1 }),
        limitPrice: Type.Number({ exclusiveMinimum: 0 }),
        feeBps: Type.Optional(Type.Number({ minimum: 0 })),
        currency: Type.Optional(Type.String()),
      }),
      Type.Object({
        action: Type.Literal("cancel"),
        accountId: Type.String(),
        orderId: Type.String(),
      }),
      Type.Object({
        action: Type.Literal("process"),
        accountId: Type.String(),
        quotes: Type.Array(
          Type.Object({
            symbol: Type.String(),
            price: Type.Number({ exclusiveMinimum: 0 }),
            asOf: Type.String(),
            source: Type.String(),
            currency: Type.Optional(Type.String()),
            snapshotId: Type.Optional(Type.String()),
          }),
        ),
      }),
    ]),
    async execute(_id, params) {
      if (params.action === "place") return toolResult(paperLedger.placeLimitOrder(params));
      if (params.action === "cancel") return toolResult(paperLedger.cancelOrder(params));
      return toolResult(paperLedger.processLimitOrders(params));
    },
  });
}

function toolResult(details: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details) }],
    details,
  };
}
