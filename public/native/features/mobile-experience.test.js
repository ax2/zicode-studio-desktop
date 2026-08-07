import { beforeEach, describe, expect, it, vi } from "vitest";
import { canUseRemotePwa, isIosDevice, setupMobileExperience } from "../react/mobile-experience.js";
import {
  MOBILE_INSTALL_POSTPONE_MS,
  MOBILE_INSTALL_POSTPONED_KEY,
} from "./mobile-pwa-lifecycle.js";
import { MOBILE_TASK_NOTIFICATIONS_KEY } from "../react/mobile-task-notifications.js";

function makeAdapter() {
  let listener;
  return {
    reconnectNow: vi.fn(),
    emit(value) {
      listener?.(value);
    },
    setConnectionListener(next) {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
  };
}

function makeP2pAdapter() {
  let connectionListener;
  let p2pListener;
  const adapter = {
    reconnectNow: vi.fn(),
    isP2pConnected: vi.fn(() => false),
    emit(value) {
      connectionListener?.(value);
    },
    emitP2p(value) {
      p2pListener?.(value);
    },
    setConnectionListener(next) {
      connectionListener = next;
      return () => {
        connectionListener = undefined;
      };
    },
    setP2pListener(next) {
      p2pListener = next;
      return () => {
        p2pListener = undefined;
      };
    },
  };
  return adapter;
}

describe("mobile experience", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
  });

  it("renders offline and reconnecting states until the remote host reconnects", () => {
    const adapter = makeAdapter();
    const navigatorRef = { onLine: true };
    const view = setupMobileExperience({
      adapter,
      clientType: "remote",
      navigatorRef,
      windowRef: window,
    });
    const status = document.querySelector(".mobile-connection-status");
    expect(status.textContent).toMatch(/Reconnecting|正在重新连接/);

    navigatorRef.onLine = false;
    window.dispatchEvent(new Event("offline"));
    expect(status.textContent).toMatch(/Network unavailable|网络不可用/);

    navigatorRef.onLine = true;
    window.dispatchEvent(new Event("online"));
    expect(adapter.reconnectNow).toHaveBeenCalledOnce();
    adapter.emit(true);
    expect(status.hidden).toBe(false);
    expect(status.dataset.state).toBe("connected");
    expect(status.textContent).toMatch(/Connected to your ZiCode|已连接到/);
    view.dispose();
  });

  it("shows the direct-connection badge only while P2P is active", () => {
    const adapter = makeP2pAdapter();
    const view = setupMobileExperience({
      adapter,
      clientType: "remote",
      navigatorRef: { onLine: true },
      windowRef: window,
    });
    const status = document.querySelector(".mobile-connection-status");
    const mode = document.querySelector(".mobile-connection-mode");
    expect(mode.hidden).toBe(true);

    adapter.emit(true); // WebSocket connected
    expect(status.dataset.state).toBe("connected");
    expect(mode.hidden).toBe(true);

    adapter.emitP2p(true);
    expect(mode.hidden).toBe(false);
    expect(mode.getAttribute("aria-label")).toMatch(/Direct connection|直连/);
    expect(mode.querySelector("svg")).not.toBeNull();

    adapter.emitP2p(false);
    expect(mode.hidden).toBe(true);
    view.dispose();
  });

  it("actively reconnects after foreground and BFCache resume events", () => {
    const adapter = makeAdapter();
    const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    try {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      const view = setupMobileExperience({
        adapter,
        clientType: "remote",
        navigatorRef: { onLine: true, userAgent: "Android", serviceWorker: null },
        windowRef: window,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      expect(adapter.reconnectNow).not.toHaveBeenCalled();

      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      expect(adapter.reconnectNow).toHaveBeenCalledTimes(1);

      const pageShow = new Event("pageshow");
      Object.defineProperty(pageShow, "persisted", { value: true });
      window.dispatchEvent(pageShow);
      expect(adapter.reconnectNow).toHaveBeenCalledTimes(2);
      view.dispose();
      document.dispatchEvent(new Event("visibilitychange"));
      expect(adapter.reconnectNow).toHaveBeenCalledTimes(2);
    } finally {
      if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility);
    }
  });

  it("escalates a slow reconnect into a clear manual recovery action", async () => {
    vi.useFakeTimers();
    const adapter = makeAdapter();
    let view;
    try {
      view = setupMobileExperience({
        adapter,
        clientType: "remote",
        navigatorRef: { onLine: true, userAgent: "Android", serviceWorker: null },
        windowRef: window,
        reconnectEscalationMs: 1_000,
      });
      const status = document.querySelector(".mobile-connection-status");
      const retry = document.querySelector(".mobile-connection-retry");
      expect(retry.hidden).toBe(true);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(status.dataset.state).toBe("stalled");
      expect(status.textContent).toMatch(/taking longer|连接耗时较长/);
      expect(retry.hidden).toBe(false);

      retry.click();
      expect(adapter.reconnectNow).toHaveBeenCalledOnce();
      expect(status.dataset.state).toBe("reconnecting");
      expect(retry.hidden).toBe(true);
    } finally {
      view?.dispose();
      vi.useRealTimers();
    }
  });

  it("offers the captured Android install prompt and can dismiss it", async () => {
    const prompt = vi.fn();
    const userChoice = Promise.resolve({ outcome: "accepted" });
    setupMobileExperience({
      adapter: makeAdapter(),
      clientType: "remote",
      navigatorRef: { onLine: true, userAgent: "Android", serviceWorker: null },
      windowRef: window,
    });
    const event = new Event("beforeinstallprompt");
    Object.assign(event, { prompt, userChoice });
    window.dispatchEvent(event);
    const card = document.querySelector(".mobile-install-card");
    expect(card.hidden).toBe(false);
    document.querySelector(".mobile-install-actions button").click();
    await userChoice;
    expect(prompt).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(card.hidden).toBe(true));
  });

  it("shows iOS Add to Home Screen guidance without waiting for a prompt event", () => {
    setupMobileExperience({
      adapter: makeAdapter(),
      clientType: "remote",
      navigatorRef: { onLine: true, userAgent: "iPhone", serviceWorker: null },
      windowRef: window,
    });
    expect(document.querySelector(".mobile-install-card").textContent).toMatch(
      /Add to Home Screen|添加到主屏幕/,
    );
    expect(isIosDevice({ userAgent: "iPhone" })).toBe(true);
  });

  it("reoffers iOS installation guidance after a seven-day not-now cooldown", () => {
    let current = 1_000_000;
    const options = {
      adapter: makeAdapter(),
      clientType: "remote",
      navigatorRef: { onLine: true, userAgent: "iPhone", serviceWorker: null },
      now: () => current,
      windowRef: window,
    };
    let view = setupMobileExperience(options);
    const installButton = document.querySelector(".mobile-install-actions button");
    installButton.click();
    expect(document.querySelector(".mobile-install-card").hidden).toBe(true);
    expect(Number(localStorage.getItem(MOBILE_INSTALL_POSTPONED_KEY))).toBe(current);
    view.dispose();

    document.body.replaceChildren();
    current += MOBILE_INSTALL_POSTPONE_MS - 1;
    view = setupMobileExperience(options);
    expect(document.querySelector(".mobile-install-card").hidden).toBe(true);
    view.dispose();

    document.body.replaceChildren();
    current += 2;
    view = setupMobileExperience(options);
    expect(document.querySelector(".mobile-install-card").hidden).toBe(false);
    view.dispose();
  });

  it("restores focus after dismissing installation guidance", () => {
    const returnButton = document.createElement("button");
    returnButton.textContent = "Current application";
    document.body.append(returnButton);
    returnButton.focus();
    const view = setupMobileExperience({
      adapter: makeAdapter(),
      clientType: "remote",
      navigatorRef: { onLine: true, userAgent: "iPhone", serviceWorker: null },
      windowRef: window,
    });

    const dismiss = [...document.querySelectorAll(".mobile-install-actions button")].at(-1);
    dismiss.click();

    expect(document.activeElement).toBe(returnButton);
    view.dispose();
  });

  it("registers the worker only for a secure non-loopback remote origin", () => {
    const register = vi.fn(async () => ({}));
    const windowRef = {
      ...window,
      location: { protocol: "https:", hostname: "192.168.1.8" },
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
      matchMedia: () => ({ matches: false }),
    };
    setupMobileExperience({
      adapter: makeAdapter(),
      clientType: "remote",
      navigatorRef: { onLine: true, userAgent: "Android", serviceWorker: { register } },
      windowRef,
    });
    expect(register).toHaveBeenCalledWith("/service-worker.js", { updateViaCache: "none" });
    expect(canUseRemotePwa({ protocol: "https:", hostname: "127.0.0.1" })).toBe(false);
  });

  it("checks for a fresh worker after returning to the foreground", async () => {
    const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const update = vi.fn(async () => {});
    const register = vi.fn(async () => ({ update }));
    let current = 0;
    const windowRef = {
      ...window,
      location: { protocol: "https:", hostname: "192.168.1.8" },
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
      matchMedia: () => ({ matches: false }),
    };
    let view;
    try {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      view = setupMobileExperience({
        adapter: makeAdapter(),
        clientType: "remote",
        documentRef: document,
        navigatorRef: {
          onLine: true,
          userAgent: "Android",
          serviceWorker: { register },
        },
        now: () => current,
        windowRef,
      });
      current = 60 * 60 * 1000 + 1;
      document.dispatchEvent(new Event("visibilitychange"));

      await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    } finally {
      view?.dispose();
      if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility);
    }
  });

  it("does nothing for the desktop client", () => {
    expect(setupMobileExperience({ clientType: "desktop" })).toBeNull();
    expect(document.querySelector(".mobile-connection-status")).toBeNull();
  });

  it("forwards runtime lifecycle events to background task alerts", async () => {
    const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const showNotification = vi.fn(async () => {});
    document.body.innerHTML = `
      <section id="mobile-task-notification-section" class="hidden">
        <button id="toggle-mobile-task-notifications" role="switch"></button>
        <p id="mobile-task-notification-status"></p>
      </section>
    `;
    localStorage.setItem(MOBILE_TASK_NOTIFICATIONS_KEY, "1");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    try {
      const windowRef = Object.create(window);
      windowRef.Notification = {
        permission: "granted",
        requestPermission: vi.fn(async () => "granted"),
      };
      const view = setupMobileExperience({
        adapter: makeAdapter(),
        clientType: "remote",
        documentRef: document,
        windowRef,
        navigatorRef: {
          onLine: true,
          userAgent: "Android",
          serviceWorker: { ready: Promise.resolve({ showNotification }) },
        },
      });
      const target = { instanceId: "instance-1", sessionId: "session-1" };
      view.handleRuntimeEvent({ type: "agent_start" }, target, 1);
      view.handleRuntimeEvent({ type: "agent_settled" }, target, 2);

      await vi.waitFor(() => expect(showNotification).toHaveBeenCalledOnce());
      view.dispose();
    } finally {
      if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility);
      else delete document.visibilityState;
    }
  });
});
