import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("bootstrap entry", () => {
  it("renders the startup failure surface when the app bundle fails to load", async () => {
    const renderFailure = vi.fn();
    const initializeI18n = vi.fn();
    vi.doMock("./native/features/mobile-start-route.js", () => ({
      restoreMobileStartRoute: () => false,
    }));
    vi.doMock("./native/features/startup-failure.js", () => ({
      renderStartupFailure: renderFailure,
    }));
    vi.doMock("./i18n.js", () => ({ initializeI18n }));
    vi.doMock("./native/app.js", () => {
      throw new Error("bundle exploded");
    });

    await import("./bootstrap-entry.js");
    await vi.waitFor(() => {
      expect(renderFailure).toHaveBeenCalledOnce();
    });
    expect(initializeI18n).toHaveBeenCalledOnce();
    expect(renderFailure.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("defers the app bundle when a saved mobile session route is restored", async () => {
    const renderFailure = vi.fn();
    const initializeI18n = vi.fn();
    vi.doMock("./native/features/mobile-start-route.js", () => ({
      restoreMobileStartRoute: () => true,
    }));
    vi.doMock("./native/features/startup-failure.js", () => ({
      renderStartupFailure: renderFailure,
    }));
    vi.doMock("./i18n.js", () => ({ initializeI18n }));

    await import("./bootstrap-entry.js");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(renderFailure).not.toHaveBeenCalled();
    expect(initializeI18n).toHaveBeenCalledOnce();
  });
});
