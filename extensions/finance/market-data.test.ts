import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MarketDataStore } from "./market-data";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function store(maximumSnapshots = 500) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zicode-market-"));
  roots.push(root);
  let sequence = 0;
  return new MarketDataStore({
    filePath: path.join(root, "snapshots.json"),
    now: () => new Date("2026-07-31T02:00:00Z"),
    createId: () => `snapshot-${++sequence}`,
    maximumSnapshots,
  });
}

describe("market data snapshots", () => {
  it("preserves normalized provenance and returns the newest as-of snapshot", () => {
    const data = store();
    data.save({
      kind: "quote",
      symbol: "600519.sh",
      market: "cn",
      currency: "cny",
      asOf: "2026-07-31T01:00:00Z",
      source: { provider: "QVeris", executionId: "exec_old" },
      payload: { price: 1400 },
    });
    data.save({
      kind: "quote",
      symbol: "600519.SH",
      market: "CN",
      currency: "CNY",
      asOf: "2026-07-31T01:30:00Z",
      source: { provider: "QVeris", executionId: "exec_new" },
      payload: { price: 1405 },
    });

    expect(data.latest({ kind: "quote", symbol: "600519.sh" })).toMatchObject({
      symbol: "600519.SH",
      currency: "CNY",
      source: { provider: "QVeris", executionId: "exec_new" },
      payload: { price: 1405 },
    });
  });

  it("enforces bounded retention", () => {
    const data = store(2);
    for (let index = 0; index < 3; index += 1) {
      data.save({
        kind: "macro",
        asOf: `2026-07-${String(28 + index).padStart(2, "0")}`,
        source: { provider: "test" },
        payload: { value: index },
      });
    }
    expect(data.list()).toHaveLength(2);
    expect(data.list().map((snapshot) => snapshot.id)).toEqual(["snapshot-3", "snapshot-2"]);
  });
});
