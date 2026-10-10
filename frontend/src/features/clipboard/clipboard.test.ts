import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { type ClipboardGateway, createClipboardStore } from "./clipboardStore";

const ITEM = {
  id: "id-1",
  text: "https://example.com",
  kind: "url",
  source: "manual",
  createdAt: "2026-08-13T10:00:00Z",
};

function stubGateway(overrides: Partial<ClipboardGateway> = {}): ClipboardGateway {
  return {
    list: vi.fn(async () => ({ items: [ITEM] })),
    add: vi.fn(async () => ({ item: ITEM })),
    remove: vi.fn(async () => ({ removed: true })),
    clear: vi.fn(async () => ({ removed: 1 })),
    ...overrides,
  };
}

function createStore(gateway: ClipboardGateway, saveToNote = vi.fn(async () => {})) {
  const notify = vi.fn();
  const store = createClipboardStore({
    gateway,
    getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
    notify,
    saveToNote,
  });
  return { store, notify, saveToNote };
}

describe("clipboard store", () => {
  beforeEach(() => setLocale("en"));

  it("loads items from the gateway", async () => {
    const gateway = stubGateway();
    const { store } = createStore(gateway);
    await store.getState().load();
    expect(store.getState().items).toEqual([ITEM]);
  });

  it("adds a draft item and reloads", async () => {
    const gateway = stubGateway();
    const { store, notify } = createStore(gateway);
    store.getState().setDraft("  hello  ");
    await store.getState().add();
    expect(gateway.add).toHaveBeenCalledWith(
      { sceneId: "programming", workspaceId: "ws-1" },
      "  hello  ",
      "manual",
    );
    expect(store.getState().draft).toBe("");
    expect(notify).toHaveBeenCalledWith("Added to inbox");
  });

  it("removes an item and reloads", async () => {
    const gateway = stubGateway();
    const { store, notify } = createStore(gateway);
    await store.getState().remove("id-1");
    expect(gateway.remove).toHaveBeenCalledWith(
      { sceneId: "programming", workspaceId: "ws-1" },
      "id-1",
    );
    expect(notify).toHaveBeenCalledWith("Item removed");
  });

  it("clears the inbox", async () => {
    const gateway = stubGateway();
    const { store, notify } = createStore(gateway);
    await store.getState().clear();
    expect(gateway.clear).toHaveBeenCalledWith({ sceneId: "programming", workspaceId: "ws-1" });
    expect(store.getState().items).toEqual([]);
    expect(notify).toHaveBeenCalledWith("Inbox cleared");
  });

  it("sends an item to notes", async () => {
    const gateway = stubGateway();
    const saveToNote = vi.fn(async () => {});
    const { store, notify } = createStore(gateway, saveToNote);
    await store.getState().sendToNote("https://example.com");
    expect(saveToNote).toHaveBeenCalledWith("https://example.com");
    expect(notify).toHaveBeenCalledWith("Sent to notes");
  });
});
