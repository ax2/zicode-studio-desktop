import { describe, expect, it, vi } from "vitest";
import {
  createInstallPromptPolicy,
  MOBILE_INSTALL_POSTPONE_MS,
  MOBILE_INSTALL_POSTPONED_KEY,
  setupMobileServiceWorker,
} from "./mobile-pwa-lifecycle.js";

describe("mobile PWA lifecycle", () => {
  it("postpones install guidance for seven days instead of forever", () => {
    const storage = new Map();
    const storageRef = {
      getItem: (key) => storage.get(key) ?? null,
      removeItem: (key) => storage.delete(key),
      setItem: (key, value) => storage.set(key, value),
    };
    let current = 1_000_000;
    const policy = createInstallPromptPolicy({ storage: storageRef, now: () => current });

    policy.postpone();
    expect(policy.isPostponed()).toBe(true);
    current += MOBILE_INSTALL_POSTPONE_MS + 1;
    expect(policy.isPostponed()).toBe(false);
    expect(storage.has(MOBILE_INSTALL_POSTPONED_KEY)).toBe(false);
  });

  it("expires the old permanent dismissal marker", () => {
    const removeItem = vi.fn();
    const policy = createInstallPromptPolicy({
      storage: { getItem: () => null, removeItem, setItem: vi.fn() },
    });

    expect(policy.isPostponed()).toBe(false);
    expect(removeItem).toHaveBeenCalledWith("zicode-mobile-install-dismissed");
  });

  it("registers without HTTP cache reuse and throttles foreground update checks", async () => {
    const update = vi.fn(async () => {});
    const register = vi.fn(async () => ({ update }));
    let current = 10_000;
    const lifecycle = setupMobileServiceWorker({
      enabled: true,
      navigatorRef: { serviceWorker: { register } },
      now: () => current,
      updateIntervalMs: 1_000,
    });

    expect(register).toHaveBeenCalledWith("/service-worker.js", { updateViaCache: "none" });
    expect(await lifecycle.checkForUpdate()).toBe(false);
    current += 1_001;
    expect(await lifecycle.checkForUpdate()).toBe(true);
    expect(update).toHaveBeenCalledOnce();
    expect(await lifecycle.checkForUpdate()).toBe(false);
  });

  it("stops pending update work after disposal", async () => {
    let resolveRegistration;
    const register = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveRegistration = resolve;
        }),
    );
    const update = vi.fn();
    let current = 0;
    const lifecycle = setupMobileServiceWorker({
      enabled: true,
      navigatorRef: { serviceWorker: { register } },
      now: () => current,
      updateIntervalMs: 1,
    });
    current = 2;
    const pending = lifecycle.checkForUpdate();
    lifecycle.dispose();
    resolveRegistration({ update });

    expect(await pending).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
