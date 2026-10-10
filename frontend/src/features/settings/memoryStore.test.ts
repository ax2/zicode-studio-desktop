import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigGatewayLike, ConfigGatewayResult } from "./configStore";
import { createMemoryStore } from "./memoryStore";

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
});
