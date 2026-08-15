import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { createWatchStore, type WatchGateway } from "./watchStore";
import { normalizeUrl } from "./watchLogic";

const ITEM = {
  id: "w1",
  name: "Example",
  url: "https://example.com/",
  changeCount: 0,
  createdAt: "2026-08-13T10:00:00Z",
};

function stubGateway(overrides: Partial<WatchGateway> = {}): WatchGateway {
  return {
    list: vi.fn(async () => ({ items: [ITEM] })),
    add: vi.fn(async () => ({ item: ITEM })),
    update: vi.fn(async () => ({ item: ITEM })),
    check: vi.fn(async () => ({ id: "w1", changed: true, hash: "abc", contentLength: 10, checkedAt: "x" })),
    remove: vi.fn(async () => ({ removed: true })),
    ...overrides,
  };
}

function createStore(gateway: WatchGateway) {
  const notify = vi.fn();
  const store = createWatchStore({
    gateway,
    getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
    notify,
  });
  return { store, notify };
}

describe("watch store", () => {
  beforeEach(() => setLocale("en"));

  it("normalizes URLs without a scheme", () => {
    expect(normalizeUrl("example.com/page")).toBe("https://example.com/page");
    expect(normalizeUrl("https://example.com")).toBe("https://example.com");
    expect(normalizeUrl("ftp://example.com")).toBe("ftp://example.com");
    expect(normalizeUrl("  ")).toBe("");
  });

  it("loads watchers", async () => {
    const gateway = stubGateway();
    const { store } = createStore(gateway);
    await store.getState().load();
    expect(store.getState().items).toEqual([ITEM]);
  });

  it("adds a watcher and reloads", async () => {
    const gateway = stubGateway();
    const { store, notify } = createStore(gateway);
    store.getState().setDraft({ draftName: "  Example  ", draftUrl: "https://example.com/" });
    await store.getState().add();
    expect(gateway.add).toHaveBeenCalledWith(
      { sceneId: "programming", workspaceId: "ws-1" },
      "  Example  ",
      "https://example.com/",
    );
    expect(notify).toHaveBeenCalledWith("Watcher added");
    // The new watcher is checked immediately to establish its baseline.
    expect(gateway.check).toHaveBeenCalledWith(
      { sceneId: "programming", workspaceId: "ws-1" },
      "w1",
    );
  });

  it("edits an existing watcher", async () => {
    const gateway = stubGateway();
    const { store, notify } = createStore(gateway);
    store.getState().startEdit(ITEM);
    store.getState().setDraft({ draftName: "Renamed", draftUrl: "https://example.org/" });
    await store.getState().saveEdit();
    expect(gateway.update).toHaveBeenCalledWith(
      { sceneId: "programming", workspaceId: "ws-1" },
      { id: "w1", name: "Renamed", url: "https://example.org/" },
    );
    expect(notify).toHaveBeenCalledWith("Watcher updated");
  });

  it("checks a watcher and records the result", async () => {
    const gateway = stubGateway();
    const { store } = createStore(gateway);
    await store.getState().check("w1");
    expect(gateway.check).toHaveBeenCalledWith(
      { sceneId: "programming", workspaceId: "ws-1" },
      "w1",
    );
    expect(store.getState().results.w1?.changed).toBe(true);
  });

  it("checks every watcher at once", async () => {
    const gateway = stubGateway({
      list: vi.fn(async () => ({
        items: [ITEM, { ...ITEM, id: "w2", name: "Second" }],
      })),
    });
    const { store } = createStore(gateway);
    await store.getState().load();
    await store.getState().checkAll();
    expect(gateway.check).toHaveBeenCalledTimes(2);
  });

  it("keeps successful check results when one watcher fails", async () => {
    setLocale("zh-CN");
    const gateway = stubGateway({
      list: vi.fn(async () => ({
        items: [ITEM, { ...ITEM, id: "w2", name: "Second" }],
      })),
      check: vi.fn(async (_scope, id) => {
        if (id === "w2") throw new Error("Page is unreachable: timeout");
        return { id: "w1", changed: true, hash: "abc", contentLength: 10, checkedAt: "x" };
      }),
    });
    const { store } = createStore(gateway);
    await store.getState().load();
    await store.getState().checkAll();
    expect(store.getState().results.w1?.changed).toBe(true);
    expect(store.getState().error).toContain("无法访问");
  });

  it("removes a watcher", async () => {
    const gateway = stubGateway();
    const { store, notify } = createStore(gateway);
    await store.getState().remove("w1");
    expect(gateway.remove).toHaveBeenCalledWith(
      { sceneId: "programming", workspaceId: "ws-1" },
      "w1",
    );
    expect(notify).toHaveBeenCalledWith("Watcher removed");
  });

  it("localizes backend URL errors", async () => {
    setLocale("zh-CN");
    const gateway = stubGateway({
      add: vi.fn(async () => {
        throw new Error("URL host resolves to a private address 127.0.0.1");
      }),
    });
    const { store } = createStore(gateway);
    store.getState().setDraft({ draftName: "Bad", draftUrl: "http://127.0.0.1" });
    await store.getState().add();
    expect(store.getState().error).toBe("该网址无效或无法访问。");
  });
});
