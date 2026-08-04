import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

  it("redirects a paired remote client from a bare relay URL to the latest session", async () => {
    const renderFailure = vi.fn();
    const replace = vi.fn();
    vi.stubGlobal("location", {
      protocol: "https:",
      hostname: "relay.zicode.com",
      pathname: "/d/dev-1/app/",
      search: "?pairingToken=x",
      replace,
    });
    vi.doMock("./native/features/remote-auth.js", () => ({
      resolveRemoteAuth: async () => ({ clientType: "remote", deviceToken: "tok" }),
    }));
    vi.doMock("./native/features/mobile-start-route.js", () => ({
      restoreMobileStartRoute: () => false,
    }));
    vi.doMock("./native/features/startup-failure.js", () => ({
      renderStartupFailure: renderFailure,
    }));
    vi.doMock("./i18n.js", () => ({ initializeI18n: vi.fn() }));
    vi.doMock("./native/app.js", () => ({}));
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ sessions: [{ workspaceId: "ws-1", id: "s-1" }] }),
    }));

    await import("./bootstrap-entry.js");
    await vi.waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/app/workspaces/ws-1/sessions/s-1?pairingToken=x"),
    );
    expect(renderFailure).not.toHaveBeenCalled();
  });

  it("renders an offline screen when the desktop is unreachable from a bare URL", async () => {
    const renderFailure = vi.fn();
    vi.stubGlobal("location", {
      protocol: "https:",
      hostname: "relay.zicode.com",
      pathname: "/d/dev-1/app/",
      search: "",
      replace: vi.fn(),
    });
    vi.doMock("./native/features/remote-auth.js", () => ({
      resolveRemoteAuth: async () => ({ clientType: "remote", deviceToken: "tok" }),
    }));
    vi.doMock("./native/features/mobile-start-route.js", () => ({
      restoreMobileStartRoute: () => false,
    }));
    vi.doMock("./native/features/startup-failure.js", () => ({
      renderStartupFailure: renderFailure,
    }));
    vi.doMock("./i18n.js", () => ({ initializeI18n: vi.fn() }));
    vi.doMock("./native/app.js", () => ({}));
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 }));

    await import("./bootstrap-entry.js");
    await vi.waitFor(() =>
      expect(renderFailure).toHaveBeenCalledWith(
        expect.objectContaining({ code: "desktop_offline" }),
      ),
    );
  });
});
