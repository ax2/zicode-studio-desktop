import { describe, expect, it, vi } from "vitest";
import {
  rememberMobileStartRoute,
  restoreMobileStartRoute,
  setupMobileStartRouteTracking,
} from "./mobile-start-route.js";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

describe("mobile PWA start route", () => {
  it("remembers a validated remote session path without query credentials", () => {
    const localStorage = storage();
    expect(
      rememberMobileStartRoute(
        {
          protocol: "https:",
          hostname: "192.168.1.8",
          pathname: "/app/workspaces/workspace-a/sessions/session-a",
          search: "?pairingToken=secret",
        },
        localStorage,
      ),
    ).toBe(true);
    const replace = vi.fn();
    expect(
      restoreMobileStartRoute({
        location: { protocol: "https:", hostname: "192.168.1.8", pathname: "/", replace },
        storage: localStorage,
      }),
    ).toBe(true);
    expect(replace).toHaveBeenCalledWith("/app/workspaces/workspace-a/sessions/session-a");
    expect(JSON.stringify(replace.mock.calls)).not.toContain("pairingToken");
  });

  it("does not redirect desktop, non-root, or malformed routes", () => {
    const localStorage = storage();
    localStorage.setItem("zicode-mobile-start-route", "https://attacker.example/");
    const replace = vi.fn();
    expect(
      restoreMobileStartRoute({
        location: { protocol: "https:", hostname: "192.168.1.8", pathname: "/", replace },
        storage: localStorage,
      }),
    ).toBe(false);
    expect(
      restoreMobileStartRoute({
        location: { protocol: "http:", hostname: "127.0.0.1", pathname: "/", replace },
        storage: localStorage,
      }),
    ).toBe(false);
    localStorage.setItem(
      "zicode-mobile-start-route",
      "/app/workspaces/workspace.a/sessions/session%2Fescape",
    );
    expect(
      restoreMobileStartRoute({
        location: { protocol: "https:", hostname: "192.168.1.8", pathname: "/", replace },
        storage: localStorage,
      }),
    ).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it("tracks session navigation and formal session route replacement", () => {
    const localStorage = storage();
    const listeners = new Map();
    const location = {
      protocol: "https:",
      hostname: "192.168.1.8",
      pathname: "/app/workspaces/workspace-a/sessions/session-a",
    };
    const updatePath = (_state, _unused, path) => {
      location.pathname = new URL(path, "https://192.168.1.8").pathname;
    };
    const history = { pushState: vi.fn(updatePath), replaceState: vi.fn(updatePath) };
    const windowRef = {
      addEventListener: (type, listener) => listeners.set(type, listener),
      history,
      location,
      removeEventListener: (type) => listeners.delete(type),
    };
    const documentRef = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      visibilityState: "visible",
    };
    const tracker = setupMobileStartRouteTracking({ documentRef, storage: localStorage, windowRef });

    history.pushState(null, "", "/app/workspaces/workspace-a/sessions/session-b?token=secret");
    expect(localStorage.getItem("zicode-mobile-start-route")).toBe(
      "/app/workspaces/workspace-a/sessions/session-b",
    );

    history.replaceState(null, "", "/app/workspaces/workspace-a/sessions/session-formal");
    expect(localStorage.getItem("zicode-mobile-start-route")).toBe(
      "/app/workspaces/workspace-a/sessions/session-formal",
    );

    history.pushState(null, "", "/app/settings");
    expect(localStorage.getItem("zicode-mobile-start-route")).toBe(
      "/app/workspaces/workspace-a/sessions/session-formal",
    );

    location.pathname = "/app/workspaces/workspace-a/sessions/session-back";
    listeners.get("popstate")();
    expect(localStorage.getItem("zicode-mobile-start-route")).toBe(
      "/app/workspaces/workspace-a/sessions/session-back",
    );
    tracker.dispose();
  });

  it("restores history methods and stops tracking when disposed", () => {
    const localStorage = storage();
    const originalPushState = vi.fn();
    const originalReplaceState = vi.fn();
    const listeners = new Map();
    const windowRef = {
      addEventListener: (type, listener) => listeners.set(type, listener),
      history: { pushState: originalPushState, replaceState: originalReplaceState },
      location: {
        protocol: "https:",
        hostname: "192.168.1.8",
        pathname: "/app/workspaces/workspace-a/sessions/session-a",
      },
      removeEventListener: (type) => listeners.delete(type),
    };
    const documentRef = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const tracker = setupMobileStartRouteTracking({ documentRef, storage: localStorage, windowRef });
    tracker.dispose();

    expect(windowRef.history.pushState).toBe(originalPushState);
    expect(windowRef.history.replaceState).toBe(originalReplaceState);
    expect(listeners.size).toBe(0);
    expect(documentRef.removeEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
  });

  it("does not install tracking outside a secure remote origin", () => {
    expect(
      setupMobileStartRouteTracking({
        windowRef: {
          history: { pushState: vi.fn(), replaceState: vi.fn() },
          location: { protocol: "http:", hostname: "127.0.0.1" },
        },
      }),
    ).toBeNull();
  });
});
