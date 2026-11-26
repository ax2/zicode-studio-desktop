import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigGatewayLike, ConfigGatewayResult } from "./configStore";
import { createMemoryStore, type MemorySnapshot } from "./memoryStore";

function makeGateway(overrides: Partial<ConfigGatewayLike> = {}) {
  const calls: Array<{ op: string; params?: unknown }> = [];
  const gateway = {
    call: vi.fn(
      async (op: string, params?: unknown): Promise<ConfigGatewayResult> => {
      calls.push({ op, params });
      if (op === "read_memory") {
        return {
          ok: true,
          data: {
            enabled: true,
            entries: [{ id: "m1", text: "prefer Chinese", updatedAt: "" }],
          },
        } as unknown as ConfigGatewayResult;
      }
      return { ok: true, data: { enabled: true, entries: [] } } as unknown as ConfigGatewayResult;
      },
    ),
    ...overrides,
  };
  return { gateway, calls };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("memory store", () => {
  it("loads entries and adds a new one through the gateway", async () => {
    const { gateway, calls } = makeGateway();
    const store = createMemoryStore(gateway);
    let events = 0;
    const onEvent = () => {
      events += 1;
    };
    window.addEventListener("zicode:memory-changed", onEvent);
    await store.getState().load();
    expect(store.getState().entries).toEqual([
      { id: "m1", text: "prefer Chinese", updatedAt: "" },
    ]);
    await store.getState().add("prefer concise replies");
    const write = calls.find((entry) => entry.op === "write_memory");
    const entries = (write?.params as { entries: Array<{ text: string }> }).entries;
    expect(entries.some((entry) => entry.text === "prefer concise replies")).toBe(true);
    expect(events).toBe(1);
    window.removeEventListener("zicode:memory-changed", onEvent);
  });

  it("toggles memory off and removes entries", async () => {
    const { gateway, calls } = makeGateway();
    const store = createMemoryStore(gateway);
    await store.getState().load();
    await store.getState().setEnabled(false);
    expect(
      (calls.find((entry) => entry.op === "write_memory")?.params as { enabled: boolean })
        .enabled,
    ).toBe(false);
    await store.getState().remove("m1");
    expect(
      (calls.filter((entry) => entry.op === "write_memory").at(-1)?.params as {
        entries: Array<{ id: string }>;
      }).entries.some((entry) => entry.id === "m1"),
    ).toBe(false);
  });

  it("imports entries with dedupe and persists through the gateway", async () => {
    const { gateway, calls } = makeGateway();
    const store = createMemoryStore(gateway);
    await store.getState().load();
    const added = await store.getState().importEntries([
      { text: "prefer Chinese" },
      { text: "   " },
      { text: "weekly PR review" },
      { text: "weekly PR review" },
      { text: "use concise replies" },
    ]);
    expect(added).toBe(2);
    const write = calls.find((entry) => entry.op === "write_memory");
    const params = write?.params as { entries: Array<{ text: string }> };
    expect(params.entries.map((entry) => entry.text)).toEqual([
      "prefer Chinese",
      "weekly PR review",
      "use concise replies",
    ]);
  });

  it("reports zero additions when every entry already exists", async () => {
    const { gateway } = makeGateway();
    const store = createMemoryStore(gateway);
    await store.getState().load();
    const added = await store.getState().importEntries([{ text: "prefer Chinese" }]);
    expect(added).toBe(0);
  });

  it("preserves entries and enablement when several settings changes overlap", async () => {
    const firstWrite = deferred();
    const initial = { enabled: true, entries: [{ id: "m1", text: "original" }] };
    let persisted = initial as MemorySnapshot;
    const writes: MemorySnapshot[] = [];
    const store = createMemoryStore({
      async call(op, params) {
        if (op === "read_memory") return { ok: true, data: persisted };
        const next = params as MemorySnapshot;
        writes.push(next);
        if (writes.length === 1) await firstWrite.promise;
        persisted = next;
        return { ok: true, data: next };
      },
    });
    await store.getState().load();
    const firstAdd = store.getState().add("first addition");
    await vi.waitFor(() => expect(writes.length).toBeGreaterThan(0));
    const disable = store.getState().setEnabled(false);
    const importNext = store.getState().importEntries([{ text: "first addition" }, { text: "imported" }]);
    const edit = store.getState().update("m1", "edited original");
    const refresh = store.getState().load();
    firstWrite.resolve();
    await Promise.all([firstAdd, disable, edit, refresh]);
    expect(await importNext).toBe(1);
    expect(writes).toHaveLength(4);
    expect(persisted.enabled).toBe(false);
    expect(persisted.entries.map(entry => entry.text)).toEqual(["edited original", "first addition", "imported"]);
    expect(store.getState()).toMatchObject(persisted);
  });

  it("requires a readable baseline before allowing a whole-file write", async () => {
    const original = { enabled: false, entries: [{ id: "m1", text: "preserved" }] };
    const writes: MemorySnapshot[] = [];
    let readable = false;
    const store = createMemoryStore({
      async call(op, params) {
        if (op === "read_memory") return readable
          ? { ok: true, data: original }
          : { ok: false, error: "Memory temporarily unavailable" };
        const next = params as MemorySnapshot;
        writes.push(next);
        return { ok: true, data: next };
      },
    });
    await store.getState().load();
    await store.getState().add("do not overwrite");
    expect(writes).toEqual([]);
    expect(store.getState()).toMatchObject({ loadedOnce: false, error: "Memory temporarily unavailable" });
    readable = true;
    await store.getState().add("retry");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.enabled).toBe(false);
    expect(writes[0]?.entries.map(entry => entry.text)).toEqual(["preserved", "retry"]);
  });

  it("continues after a rejected write using the last saved snapshot", async () => {
    const start = { enabled: true, entries: [{ id: "m1", text: "original" }] };
    const writes: MemorySnapshot[] = [];
    const store = createMemoryStore({
      async call(op, params) {
        if (op === "read_memory") return { ok: true, data: start };
        const next = params as MemorySnapshot;
        writes.push(next);
        if (writes.length === 1) return { ok: false, error: "Save rejected" };
        return { ok: true, data: next };
      },
    });
    await store.getState().load();
    const failed = store.getState().add("failed entry");
    const next = store.getState().add("next entry");
    await Promise.all([failed, next]);
    expect(writes[1]?.entries.map(entry => entry.text)).toEqual(["original", "next entry"]);
    expect(store.getState()).toMatchObject({ error: "", entries: writes[1]?.entries });
  });

});
