import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStoragePersistenceStore } from "./storagePersistenceStore";

describe("storage persistence store", () => {
  beforeEach(() => {
    getStoragePersistenceStore().setState({
      hidden: true,
      state: "checking",
      requesting: false,
      supported: false,
      estimate: null,
      buttonKey: "Protect drafts",
      buttonDisabled: false,
      statusText: "",
      navigatorRef: undefined,
      documentRef: undefined,
      windowRef: undefined,
    });
  });

  it("reveals protection after the user activates the button", async () => {
    const persist = vi.fn(async () => true);
    const store = getStoragePersistenceStore();
    store.getState().configure({
      clientType: "remote",
      navigatorRef: {
        storage: {
          estimate: vi.fn(async () => ({
            quota: 100 * 1024 * 1024,
            usage: 0,
          })),
          persist,
          persisted: vi.fn(async () => false),
        },
      },
    });

    expect(store.getState().hidden).toBe(false);
    expect(persist).not.toHaveBeenCalled();

    await store.getState().requestProtection();

    expect(persist).toHaveBeenCalledOnce();
    expect(store.getState().state).toBe("protected");
    expect(store.getState().buttonDisabled).toBe(true);
  });

  it("keeps the row hidden for the desktop client", () => {
    const store = getStoragePersistenceStore();
    store.getState().configure({ clientType: "desktop" });
    expect(store.getState().hidden).toBe(true);
  });
});
