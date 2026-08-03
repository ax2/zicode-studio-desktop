import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type MarketDataKind = "quote" | "ohlcv" | "fundamentals" | "news" | "macro";

export type MarketDataSource = {
  provider: string;
  toolId?: string;
  searchId?: string;
  executionId?: string;
};

export type MarketDataSnapshotInput = {
  kind: MarketDataKind;
  symbol?: string;
  market?: string;
  currency?: string;
  asOf: string;
  source: MarketDataSource;
  payload: unknown;
};

export type MarketDataSnapshot = MarketDataSnapshotInput & {
  id: string;
  createdAt: string;
};

type SnapshotFile = {
  version: 1;
  snapshots: MarketDataSnapshot[];
};

type StoreOptions = {
  filePath?: string;
  now?: () => Date;
  createId?: () => string;
  maximumSnapshots?: number;
};

export class MarketDataStore {
  readonly filePath: string;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly maximumSnapshots: number;

  constructor(options: StoreOptions = {}) {
    this.filePath = options.filePath || defaultSnapshotPath();
    this.now = options.now || (() => new Date());
    this.createId = options.createId || randomUUID;
    this.maximumSnapshots = options.maximumSnapshots || 500;
  }

  save(input: MarketDataSnapshotInput): MarketDataSnapshot {
    const normalized = normalizeSnapshot(input);
    const encodedPayload = JSON.stringify(normalized.payload);
    if (encodedPayload.length > 1_000_000) {
      throw new Error("market data payload exceeds the 1 MB snapshot limit");
    }
    const file = this.read();
    const snapshot: MarketDataSnapshot = {
      ...normalized,
      id: this.createId(),
      createdAt: this.now().toISOString(),
    };
    file.snapshots.push(snapshot);
    if (file.snapshots.length > this.maximumSnapshots) {
      file.snapshots.splice(0, file.snapshots.length - this.maximumSnapshots);
    }
    this.write(file);
    return snapshot;
  }

  latest(query: { kind: MarketDataKind; symbol?: string; market?: string }) {
    const symbol = optionalSymbol(query.symbol);
    const market = optionalText(query.market)?.toUpperCase();
    return this.read()
      .snapshots.filter(
        (snapshot) =>
          snapshot.kind === query.kind &&
          (!symbol || snapshot.symbol === symbol) &&
          (!market || snapshot.market === market),
      )
      .sort((a, b) => b.asOf.localeCompare(a.asOf) || b.createdAt.localeCompare(a.createdAt))[0];
  }

  list(query: {
    kind?: MarketDataKind;
    symbol?: string;
    market?: string;
    limit?: number;
  } = {}) {
    const symbol = optionalSymbol(query.symbol);
    const market = optionalText(query.market)?.toUpperCase();
    const limit = Math.max(1, Math.min(100, Math.trunc(query.limit ?? 20)));
    return this.read()
      .snapshots.filter(
        (snapshot) =>
          (!query.kind || snapshot.kind === query.kind) &&
          (!symbol || snapshot.symbol === symbol) &&
          (!market || snapshot.market === market),
      )
      .sort((a, b) => b.asOf.localeCompare(a.asOf) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  private read(): SnapshotFile {
    if (!fs.existsSync(this.filePath)) return { version: 1, snapshots: [] };
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<SnapshotFile>;
    if (parsed.version !== 1 || !Array.isArray(parsed.snapshots)) {
      throw new Error("unsupported market data snapshot format");
    }
    return parsed as SnapshotFile;
  }

  private write(file: SnapshotFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(file, null, 2), "utf8");
    fs.renameSync(temporary, this.filePath);
  }
}

function normalizeSnapshot(input: MarketDataSnapshotInput): MarketDataSnapshotInput {
  const kinds: MarketDataKind[] = ["quote", "ohlcv", "fundamentals", "news", "macro"];
  if (!kinds.includes(input.kind)) throw new Error("unsupported market data kind");
  const asOf = timestamp(input.asOf, "asOf");
  const provider = requiredText(input.source?.provider, "source.provider");
  if (input.payload === undefined) throw new Error("payload is required");
  return {
    kind: input.kind,
    symbol: optionalSymbol(input.symbol),
    market: optionalText(input.market)?.toUpperCase(),
    currency: optionalCurrency(input.currency),
    asOf,
    source: {
      provider,
      toolId: optionalText(input.source.toolId),
      searchId: optionalText(input.source.searchId),
      executionId: optionalText(input.source.executionId),
    },
    payload: input.payload,
  };
}

function defaultSnapshotPath(): string {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  if (configured) return path.join(path.resolve(configured), "finance", "market-snapshots.json");
  const desktopRoot = process.env.PI_DESKTOP_DATA_DIR?.trim();
  if (desktopRoot) {
    return path.join(path.resolve(desktopRoot), "agent", "finance", "market-snapshots.json");
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "zicode", "agent", "finance", "market-snapshots.json");
  }
  const dataRoot =
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support")
      : process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(dataRoot, "zicode", "agent", "finance", "market-snapshots.json");
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalSymbol(value: unknown): string | undefined {
  const symbol = optionalText(value)?.toUpperCase();
  if (symbol && !/^[A-Z0-9._:-]{1,32}$/.test(symbol)) throw new Error("invalid symbol");
  return symbol;
}

function optionalCurrency(value: unknown): string | undefined {
  const currency = optionalText(value)?.toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    throw new Error("currency must be a three-letter code");
  }
  return currency;
}

function timestamp(value: unknown, label: string): string {
  const text = requiredText(value, label);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid timestamp`);
  return date.toISOString();
}
