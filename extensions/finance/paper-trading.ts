import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type PaperFill = {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  executedAt: string;
  source: string;
  snapshotId?: string;
};

export type PaperOrder = {
  id: string;
  type: "market" | "limit";
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  status: "pending" | "filled" | "cancelled" | "rejected";
  createdAt: string;
  limitPrice?: number;
  feeBps: number;
  fillId?: string;
  filledAt?: string;
  cancelledAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
};

type PaperAccountRecord = {
  id: string;
  name: string;
  baseCurrency: string;
  initialCash: number;
  createdAt: string;
  fills: PaperFill[];
  orders?: PaperOrder[];
};

type PaperTradingFile = {
  version: 1;
  accounts: Record<string, PaperAccountRecord>;
};

export type MarketSnapshot = {
  price: number;
  asOf: string;
  source: string;
  currency?: string;
  snapshotId?: string;
};

export type PositionQuote = MarketSnapshot & { symbol: string };

type LedgerOptions = {
  filePath?: string;
  now?: () => Date;
  createId?: () => string;
};

export class PaperTradingLedger {
  readonly filePath: string;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(options: LedgerOptions = {}) {
    this.filePath = options.filePath || defaultLedgerPath();
    this.now = options.now || (() => new Date());
    this.createId = options.createId || randomUUID;
  }

  createAccount(input: {
    name: string;
    baseCurrency?: string;
    initialCash?: number;
  }) {
    const file = this.read();
    const id = this.createId();
    const account: PaperAccountRecord = {
      id,
      name: requiredText(input.name, "account name"),
      baseCurrency: normalizeCurrency(input.baseCurrency || "CNY"),
      initialCash: positive(input.initialCash ?? 1_000_000, "initialCash"),
      createdAt: this.now().toISOString(),
      fills: [],
      orders: [],
    };
    file.accounts[id] = account;
    this.write(file);
    return summarize(account);
  }

  listAccounts() {
    return Object.values(this.read().accounts)
      .map(summarize)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getAccount(accountId: string) {
    return accountView(this.requireAccount(this.read(), accountId));
  }

  removeAccount(accountId: string) {
    const file = this.read();
    this.requireAccount(file, accountId);
    delete file.accounts[accountId];
    this.write(file);
    return { removed: true };
  }

  markToMarket(input: {
    accountId: string;
    quotes: PositionQuote[];
    maxAgeMinutes?: number;
  }) {
    const account = this.requireAccount(this.read(), input.accountId);
    const derived = deriveAccount(account);
    const maxAgeMinutes = positive(input.maxAgeMinutes ?? 60, "maxAgeMinutes");
    const quotes = new Map(
      input.quotes.map((quote) => {
        const symbol = normalizeSymbol(quote.symbol);
        const currency = quote.currency ? normalizeCurrency(quote.currency) : account.baseCurrency;
        if (currency !== account.baseCurrency) {
          throw new Error(`quote currency for ${symbol} requires FX conversion`);
        }
        return [
          symbol,
          {
            price: positive(quote.price, `quote price for ${symbol}`),
            asOf: validTimestamp(quote.asOf, `quote asOf for ${symbol}`),
            source: requiredText(quote.source, `quote source for ${symbol}`),
            snapshotId: optionalText(quote.snapshotId),
          },
        ] as const;
      }),
    );
    const missingSymbols: string[] = [];
    let marketValue = 0;
    let unrealizedPnl = 0;
    const positions = derived.positions.map((position) => {
      const quote = quotes.get(position.symbol);
      if (!quote) {
        missingSymbols.push(position.symbol);
        return { ...position, marketPrice: null, marketValue: null, unrealizedPnl: null, stale: null };
      }
      const value = position.quantity * quote.price;
      const pnl = value - position.quantity * position.averageCost;
      marketValue += value;
      unrealizedPnl += pnl;
      const ageMinutes = Math.max(0, (this.now().getTime() - new Date(quote.asOf).getTime()) / 60_000);
      return {
        ...position,
        marketPrice: round(quote.price),
        marketValue: round(value),
        unrealizedPnl: round(pnl),
        asOf: quote.asOf,
        source: quote.source,
        snapshotId: quote.snapshotId,
        stale: ageMinutes > maxAgeMinutes,
      };
    });
    const equity = derived.cash + marketValue;
    const valuedPositions = positions.filter((position) => position.marketValue != null);
    const positionWeights = valuedPositions.map((position) => ({
      symbol: position.symbol,
      weight: equity > 0 ? Number(position.marketValue) / equity : 0,
    }));
    const largestPosition = [...positionWeights].sort((left, right) => right.weight - left.weight)[0];
    return {
      accountId: account.id,
      baseCurrency: account.baseCurrency,
      cash: derived.cash,
      marketValue: round(marketValue),
      equity: round(equity),
      realizedPnl: derived.realizedPnl,
      unrealizedPnl: round(unrealizedPnl),
      missingSymbols,
      complete: missingSymbols.length === 0,
      positions,
      risk: {
        grossExposure: equity > 0 ? round(marketValue / equity) : null,
        cashWeight: equity > 0 ? round(derived.cash / equity) : null,
        concentrationHhi: round(
          positionWeights.reduce((total, position) => total + position.weight ** 2, 0),
        ),
        largestPosition: largestPosition
          ? { symbol: largestPosition.symbol, weight: round(largestPosition.weight) }
          : null,
        stalePositionCount: positions.filter((position) => position.stale === true).length,
        missingQuoteCount: missingSymbols.length,
      },
    };
  }

  placeLimitOrder(input: {
    accountId: string;
    symbol: string;
    side: "buy" | "sell";
    quantity: number;
    limitPrice: number;
    feeBps?: number;
    currency?: string;
  }) {
    const file = this.read();
    const account = this.requireAccount(file, input.accountId);
    const symbol = normalizeSymbol(input.symbol);
    if (input.side !== "buy" && input.side !== "sell") throw new Error("side must be buy or sell");
    const quantity = positiveInteger(input.quantity, "quantity");
    const limitPrice = positive(input.limitPrice, "limitPrice");
    const feeBps = nonNegative(input.feeBps ?? 5, "feeBps");
    const currency = input.currency ? normalizeCurrency(input.currency) : account.baseCurrency;
    if (currency !== account.baseCurrency) {
      throw new Error("limit orders require prices in the account base currency");
    }
    const available = availableAfterReservations(account);
    const reservedCost = quantity * limitPrice * (1 + feeBps / 10_000);
    if (input.side === "buy" && available.cash + 1e-8 < reservedCost) {
      throw new Error("insufficient simulated cash after pending-order reservations");
    }
    if (input.side === "sell" && (available.positions.get(symbol) || 0) < quantity) {
      throw new Error("insufficient simulated position after pending-order reservations");
    }
    const order: PaperOrder = {
      id: this.createId(),
      type: "limit",
      symbol,
      side: input.side,
      quantity,
      limitPrice: round(limitPrice),
      feeBps,
      status: "pending",
      createdAt: this.now().toISOString(),
    };
    account.orders ||= [];
    account.orders.push(order);
    this.write(file);
    return { order, account: accountView(account) };
  }

  cancelOrder(input: { accountId: string; orderId: string }) {
    const file = this.read();
    const account = this.requireAccount(file, input.accountId);
    const order = (account.orders || []).find(
      (candidate) => candidate.id === requiredText(input.orderId, "orderId"),
    );
    if (!order) throw new Error("paper order not found");
    if (order.status !== "pending") throw new Error("only pending paper orders can be cancelled");
    order.status = "cancelled";
    order.cancelledAt = this.now().toISOString();
    this.write(file);
    return { order, account: accountView(account) };
  }

  processLimitOrders(input: { accountId: string; quotes: PositionQuote[] }) {
    const file = this.read();
    const account = this.requireAccount(file, input.accountId);
    const quoteMap = new Map(
      input.quotes.map((quote) => {
        const symbol = normalizeSymbol(quote.symbol);
        const currency = quote.currency ? normalizeCurrency(quote.currency) : account.baseCurrency;
        if (currency !== account.baseCurrency) {
          throw new Error(`quote currency for ${symbol} requires FX conversion`);
        }
        return [
          symbol,
          {
            price: positive(quote.price, `quote price for ${symbol}`),
            asOf: validTimestamp(quote.asOf, `quote asOf for ${symbol}`),
            source: requiredText(quote.source, `quote source for ${symbol}`),
            snapshotId: optionalText(quote.snapshotId),
          },
        ] as const;
      }),
    );
    const processed: PaperOrder[] = [];
    for (const order of account.orders || []) {
      if (order.type !== "limit" || order.status !== "pending") continue;
      const quote = quoteMap.get(order.symbol);
      if (!quote) continue;
      const triggered =
        order.side === "buy"
          ? quote.price <= (order.limitPrice as number)
          : quote.price >= (order.limitPrice as number);
      if (!triggered) continue;
      const current = deriveAccount(account);
      const position = current.positions.find((candidate) => candidate.symbol === order.symbol);
      const fee = round(order.quantity * quote.price * order.feeBps / 10_000);
      const valid =
        order.side === "buy"
          ? current.cash + 1e-8 >= order.quantity * quote.price + fee
          : (position?.quantity || 0) >= order.quantity;
      if (!valid) {
        order.status = "rejected";
        order.rejectedAt = this.now().toISOString();
        order.rejectionReason =
          order.side === "buy" ? "insufficient simulated cash" : "insufficient simulated position";
        processed.push(order);
        continue;
      }
      const fill: PaperFill = {
        id: this.createId(),
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        price: round(quote.price),
        fee,
        executedAt: quote.asOf,
        source: quote.source,
        snapshotId: quote.snapshotId,
      };
      account.fills.push(fill);
      order.status = "filled";
      order.fillId = fill.id;
      order.filledAt = quote.asOf;
      processed.push(order);
    }
    this.write(file);
    return { processed, account: accountView(account) };
  }

  executeMarketOrder(input: {
    accountId: string;
    symbol: string;
    side: "buy" | "sell";
    quantity: number;
    snapshot: MarketSnapshot;
    feeBps?: number;
  }) {
    const file = this.read();
    const account = this.requireAccount(file, input.accountId);
    const symbol = normalizeSymbol(input.symbol);
    if (input.side !== "buy" && input.side !== "sell") throw new Error("side must be buy or sell");
    const quantity = positiveInteger(input.quantity, "quantity");
    const price = positive(input.snapshot?.price, "snapshot.price");
    const executedAt = validTimestamp(input.snapshot?.asOf, "snapshot.asOf");
    const source = requiredText(input.snapshot?.source, "snapshot.source");
    const currency = input.snapshot.currency
      ? normalizeCurrency(input.snapshot.currency)
      : account.baseCurrency;
    if (currency !== account.baseCurrency) {
      throw new Error("paper orders require prices in the account base currency");
    }
    const feeRate = nonNegative(input.feeBps ?? 5, "feeBps") / 10_000;
    const fee = round(price * quantity * feeRate);
    const current = deriveAccount(account);
    if (input.side === "buy" && current.cash + 1e-8 < price * quantity + fee) {
      throw new Error("insufficient simulated cash");
    }
    const currentPosition = current.positions.find((position) => position.symbol === symbol);
    if (input.side === "sell" && (currentPosition?.quantity || 0) < quantity) {
      throw new Error("insufficient simulated position");
    }
    const orderId = this.createId();
    const fillId = this.createId();
    const fill: PaperFill = {
      id: fillId,
      symbol,
      side: input.side,
      quantity,
      price: round(price),
      fee,
      executedAt,
      source,
      snapshotId: optionalText(input.snapshot.snapshotId),
    };
    account.fills.push(fill);
    const order: PaperOrder = {
      id: orderId,
      type: "market",
      symbol,
      side: input.side,
      quantity,
      status: "filled",
      createdAt: this.now().toISOString(),
      feeBps: input.feeBps ?? 5,
      fillId,
      filledAt: executedAt,
    };
    account.orders ||= [];
    account.orders.push(order);
    this.write(file);
    return { order, fill, account: accountView(account) };
  }

  private requireAccount(file: PaperTradingFile, accountId: string): PaperAccountRecord {
    const id = requiredText(accountId, "accountId");
    const account = file.accounts[id];
    if (!account) throw new Error("paper account not found");
    return account;
  }

  private read(): PaperTradingFile {
    if (!fs.existsSync(this.filePath)) return { version: 1, accounts: {} };
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<PaperTradingFile>;
    if (parsed.version !== 1 || !parsed.accounts || typeof parsed.accounts !== "object") {
      throw new Error("unsupported paper trading ledger format");
    }
    return parsed as PaperTradingFile;
  }

  private write(file: PaperTradingFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(file, null, 2), "utf8");
    fs.renameSync(temporary, this.filePath);
  }
}

function deriveAccount(account: PaperAccountRecord) {
  let cash = account.initialCash;
  let realizedPnl = 0;
  const positions = new Map<string, { quantity: number; averageCost: number }>();
  for (const fill of account.fills) {
    const position = positions.get(fill.symbol) || { quantity: 0, averageCost: 0 };
    if (fill.side === "buy") {
      const priorCost = position.quantity * position.averageCost;
      const nextQuantity = position.quantity + fill.quantity;
      position.averageCost = (priorCost + fill.quantity * fill.price + fill.fee) / nextQuantity;
      position.quantity = nextQuantity;
      cash -= fill.quantity * fill.price + fill.fee;
    } else {
      realizedPnl += fill.quantity * (fill.price - position.averageCost) - fill.fee;
      position.quantity -= fill.quantity;
      cash += fill.quantity * fill.price - fill.fee;
      if (position.quantity === 0) position.averageCost = 0;
    }
    positions.set(fill.symbol, position);
  }
  return {
    cash: round(cash),
    realizedPnl: round(realizedPnl),
    positions: Array.from(positions.entries())
      .filter(([, position]) => position.quantity > 0)
      .map(([symbol, position]) => ({
        symbol,
        quantity: position.quantity,
        averageCost: round(position.averageCost),
      }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol)),
  };
}

function accountView(account: PaperAccountRecord) {
  return {
    ...summarize(account),
    ...deriveAccount(account),
    orders: [...(account.orders || [])],
    fills: [...account.fills],
  };
}

function summarize(account: PaperAccountRecord) {
  const derived = deriveAccount(account);
  return {
    id: account.id,
    name: account.name,
    baseCurrency: account.baseCurrency,
    initialCash: account.initialCash,
    createdAt: account.createdAt,
    cash: derived.cash,
    realizedPnl: derived.realizedPnl,
    positionCount: derived.positions.length,
    orderCount: account.orders?.length || 0,
    fillCount: account.fills.length,
  };
}

function availableAfterReservations(account: PaperAccountRecord) {
  const derived = deriveAccount(account);
  let cash = derived.cash;
  const positions = new Map(derived.positions.map((position) => [position.symbol, position.quantity]));
  for (const order of account.orders || []) {
    if (order.status !== "pending" || order.type !== "limit") continue;
    if (order.side === "buy") {
      cash -=
        order.quantity *
        (order.limitPrice as number) *
        (1 + order.feeBps / 10_000);
    } else {
      positions.set(order.symbol, (positions.get(order.symbol) || 0) - order.quantity);
    }
  }
  return { cash, positions };
}

function defaultLedgerPath(): string {
  const configured = process.env.PI_CODING_AGENT_DIR;
  if (configured?.trim()) return path.join(path.resolve(configured.trim()), "finance", "paper-accounts.json");
  const desktopRoot = process.env.PI_DESKTOP_DATA_DIR;
  if (desktopRoot?.trim()) {
    return path.join(path.resolve(desktopRoot.trim()), "agent", "finance", "paper-accounts.json");
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "zicode", "agent", "finance", "paper-accounts.json");
  }
  const dataRoot =
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support")
      : process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(dataRoot, "zicode", "agent", "finance", "paper-accounts.json");
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeSymbol(value: unknown): string {
  const symbol = requiredText(value, "symbol").toUpperCase();
  if (!/^[A-Z0-9._:-]{1,32}$/.test(symbol)) throw new Error("invalid symbol");
  return symbol;
}

function normalizeCurrency(value: string): string {
  const currency = requiredText(value, "baseCurrency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("baseCurrency must be a three-letter code");
  return currency;
}

function positive(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const number = positive(value, label);
  if (!Number.isInteger(number)) throw new Error(`${label} must be an integer`);
  return number;
}

function nonNegative(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be non-negative`);
  }
  return value;
}

function validTimestamp(value: unknown, label: string): string {
  const text = requiredText(value, label);
  const timestamp = new Date(text);
  if (Number.isNaN(timestamp.getTime())) throw new Error(`${label} must be a valid timestamp`);
  return timestamp.toISOString();
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
