import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MOBILE_TASK_NOTIFICATIONS_KEY,
  setupMobileTaskNotifications,
} from "./mobile-task-notifications.js";

function mount() {
  document.body.innerHTML = `
    <section id="mobile-task-notification-section" class="hidden">
      <button id="toggle-mobile-task-notifications" role="switch"></button>
      <p id="mobile-task-notification-status"></p>
    </section>
  `;
}

function fakeNotification(permission = "default") {
  return {
    permission,
    requestPermission: vi.fn(async function requestPermission() {
      this.permission = "granted";
      return "granted";
    }),
  };
}

describe("mobile task notifications", () => {
  beforeEach(() => {
    delete document.visibilityState;
    mount();
    localStorage.clear();
  });

  it("requests permission only after the remote user enables the setting", async () => {
    const notificationApi = fakeNotification();
    const view = setupMobileTaskNotifications({
      clientType: "remote",
      notificationApi,
      navigatorRef: { serviceWorker: {} },
    });
    const section = document.getElementById("mobile-task-notification-section");
    const toggle = document.getElementById("toggle-mobile-task-notifications");
    expect(section.classList.contains("hidden")).toBe(false);
    expect(notificationApi.requestPermission).not.toHaveBeenCalled();

    toggle.click();
    await vi.waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));

    expect(notificationApi.requestPermission).toHaveBeenCalledOnce();
    expect(localStorage.getItem(MOBILE_TASK_NOTIFICATIONS_KEY)).toBe("1");
    view.dispose();
  });

  it("notifies once when a tracked task finishes while the app is hidden", async () => {
    const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const showNotification = vi.fn(async () => {});
    localStorage.setItem(MOBILE_TASK_NOTIFICATIONS_KEY, "1");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    try {
      const view = setupMobileTaskNotifications({
        clientType: "remote",
        notificationApi: fakeNotification("granted"),
        navigatorRef: { serviceWorker: { ready: Promise.resolve({ showNotification }) } },
      });
      const target = { sessionId: "session-1", instanceId: "instance-1" };
      view.handleRuntimeEvent({ type: "agent_start" }, target);
      view.handleRuntimeEvent({ type: "agent_settled" }, target);
      view.handleRuntimeEvent({ type: "agent_end" }, target);

      await vi.waitFor(() => expect(showNotification).toHaveBeenCalledOnce());
      expect(showNotification).toHaveBeenCalledWith(
        expect.stringMatching(/Pi task finished|Pi 任务已完成/),
        expect.objectContaining({
          body: expect.stringMatching(/Open ZiCode|打开 ZiCode/),
          tag: "zicode-task-complete",
        }),
      );
      view.dispose();
    } finally {
      if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility);
      else delete document.visibilityState;
    }
  });

  it("ignores duplicate or out-of-order runtime completion events", async () => {
    const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const showNotification = vi.fn(async () => {});
    localStorage.setItem(MOBILE_TASK_NOTIFICATIONS_KEY, "1");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    try {
      const view = setupMobileTaskNotifications({
        clientType: "remote",
        notificationApi: fakeNotification("granted"),
        navigatorRef: { serviceWorker: { ready: Promise.resolve({ showNotification }) } },
      });
      const target = { sessionId: "session-1", instanceId: "instance-1" };
      view.handleRuntimeEvent({ type: "agent_start" }, target, 5);
      view.handleRuntimeEvent({ type: "agent_settled" }, target, 4);
      await Promise.resolve();
      expect(showNotification).not.toHaveBeenCalled();

      view.handleRuntimeEvent({ type: "agent_settled" }, target, 6);
      view.handleRuntimeEvent({ type: "agent_end" }, target, 6);
      await vi.waitFor(() => expect(showNotification).toHaveBeenCalledOnce());
      view.dispose();
    } finally {
      if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility);
      else delete document.visibilityState;
    }
  });

  it("does not interrupt the user when the app is already visible", async () => {
    const showNotification = vi.fn(async () => {});
    localStorage.setItem(MOBILE_TASK_NOTIFICATIONS_KEY, "1");
    const view = setupMobileTaskNotifications({
      clientType: "remote",
      notificationApi: fakeNotification("granted"),
      navigatorRef: { serviceWorker: { ready: Promise.resolve({ showNotification }) } },
    });
    const target = { sessionId: "session-1" };
    view.setTaskRunning(target, true);
    view.setTaskRunning(target, false);
    await Promise.resolve();

    expect(showNotification).not.toHaveBeenCalled();
    view.dispose();
  });

  it("cancels a delayed alert when the user returns before the worker is ready", async () => {
    const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const showNotification = vi.fn(async () => {});
    let releaseWorker;
    const ready = new Promise((resolve) => {
      releaseWorker = () => resolve({ showNotification });
    });
    localStorage.setItem(MOBILE_TASK_NOTIFICATIONS_KEY, "1");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    try {
      const view = setupMobileTaskNotifications({
        clientType: "remote",
        notificationApi: fakeNotification("granted"),
        navigatorRef: { serviceWorker: { ready } },
      });
      const target = { sessionId: "session-1" };
      view.setTaskRunning(target, true);
      view.setTaskRunning(target, false);
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      releaseWorker();
      await ready;
      await Promise.resolve();

      expect(showNotification).not.toHaveBeenCalled();
      view.dispose();
    } finally {
      if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility);
      else delete document.visibilityState;
    }
  });

  it("keeps the mobile-only setting hidden for the desktop client", () => {
    expect(setupMobileTaskNotifications({ clientType: "desktop" })).toBeNull();
    expect(document.getElementById("mobile-task-notification-section").classList).toContain(
      "hidden",
    );
  });
});
