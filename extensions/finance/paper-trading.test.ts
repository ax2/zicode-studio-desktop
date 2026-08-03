import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PaperTradingLedger } from "./paper-trading";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function ledger() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zicode-paper-"));
  temporaryDirectories.push(directory);
  let sequence = 0;
  return new PaperTradingLedger({
    filePath: path.join(directory, "accounts.json"),
    now: () => new Date("2026-07-30T10:00:00Z"),
    createId: () => `test-${++sequence}`,
  });
}

describe("paper trading ledger", () => {
  it("persists accounts and derives cash, positions, and realized PnL from fills", () => {
    const store = ledger();
    const account = store.createAccount({ name: "A股模拟盘", initialCash: 100_000 });
    store.executeMarketOrder({
      accountId: account.id,
      symbol: "600519.SH",
      side: "buy",
      quantity: 10,
      snapshot: { price: 1_000, asOf: "2026-07-30T01:30:00Z", source: "QVeris/test" },
      feeBps: 0,
    });
    const sold = store.executeMarketOrder({
      accountId: account.id,
      symbol: "600519.SH",
      side: "sell",
      quantity: 4,
      snapshot: { price: 1_100, asOf: "2026-07-31T01:30:00Z", source: "QVeris/test" },
      feeBps: 0,
    });

    expect(sold.account).toMatchObject({
      cash: 94_400,
      realizedPnl: 400,
      positions: [{ symbol: "600519.SH", quantity: 6, averageCost: 1_000 }],
    });
    expect(sold.order).toMatchObject({ type: "market", status: "filled", fillId: sold.fill.id });
    expect(store.listAccounts()).toMatchObject([
      { orderCount: 2, fillCount: 2, positionCount: 1 },
    ]);
  });

  it("rejects orders that exceed simulated cash or positions", () => {
    const store = ledger();
    const account = store.createAccount({ name: "test", initialCash: 100 });

    expect(() =>
      store.executeMarketOrder({
        accountId: account.id,
        symbol: "AAPL",
        side: "buy",
        quantity: 2,
        snapshot: { price: 100, asOf: "2026-07-30", source: "test" },
      }),
    ).toThrow("insufficient simulated cash");

    expect(() =>
      store.executeMarketOrder({
        accountId: account.id,
        symbol: "AAPL",
        side: "sell",
        quantity: 1,
        snapshot: { price: 100, asOf: "2026-07-30", source: "test" },
      }),
    ).toThrow("insufficient simulated position");
  });

  it("marks open positions to sourced quotes and reports portfolio equity", () => {
    const store = ledger();
    const account = store.createAccount({ name: "mark", initialCash: 10_000 });
    store.executeMarketOrder({
      accountId: account.id,
      symbol: "AAPL",
      side: "buy",
      quantity: 10,
      snapshot: {
        price: 100,
        asOf: "2026-07-30T09:00:00Z",
        source: "QVeris/exec_buy",
        currency: "CNY",
      },
      feeBps: 0,
    });

    expect(
      store.markToMarket({
        accountId: account.id,
        quotes: [
          {
            symbol: "AAPL",
            price: 110,
            asOf: "2026-07-30T09:45:00Z",
            source: "QVeris/exec_quote",
            currency: "CNY",
          },
        ],
      }),
    ).toMatchObject({
      complete: true,
      cash: 9_000,
      marketValue: 1_100,
      equity: 10_100,
      unrealizedPnl: 100,
      positions: [{ symbol: "AAPL", stale: false, source: "QVeris/exec_quote" }],
      risk: {
        largestPosition: { symbol: "AAPL" },
        stalePositionCount: 0,
        missingQuoteCount: 0,
      },
    });
  });

  it("reserves limit-order resources, fills on matching quotes, and supports cancellation", () => {
    const store = ledger();
    const account = store.createAccount({ name: "limits", initialCash: 10_000 });
    const pending = store.placeLimitOrder({
      accountId: account.id,
      symbol: "AAPL",
      side: "buy",
      quantity: 50,
      limitPrice: 100,
      feeBps: 0,
    });
    expect(pending.order).toMatchObject({ type: "limit", status: "pending", limitPrice: 100 });
    expect(() =>
      store.placeLimitOrder({
        accountId: account.id,
        symbol: "MSFT",
        side: "buy",
        quantity: 60,
        limitPrice: 100,
        feeBps: 0,
      }),
    ).toThrow("after pending-order reservations");

    const notTriggered = store.processLimitOrders({
      accountId: account.id,
      quotes: [{ symbol: "AAPL", price: 101, asOf: "2026-07-30T09:30:00Z", source: "test" }],
    });
    expect(notTriggered.processed).toHaveLength(0);

    const filled = store.processLimitOrders({
      accountId: account.id,
      quotes: [{ symbol: "AAPL", price: 99, asOf: "2026-07-30T09:31:00Z", source: "test" }],
    });
    expect(filled).toMatchObject({
      processed: [{ status: "filled", fillId: expect.any(String) }],
      account: { cash: 5_050, positions: [{ symbol: "AAPL", quantity: 50 }] },
    });

    const sell = store.placeLimitOrder({
      accountId: account.id,
      symbol: "AAPL",
      side: "sell",
      quantity: 20,
      limitPrice: 110,
    });
    const cancelled = store.cancelOrder({ accountId: account.id, orderId: sell.order.id });
    expect(cancelled.order.status).toBe("cancelled");
  });
});
