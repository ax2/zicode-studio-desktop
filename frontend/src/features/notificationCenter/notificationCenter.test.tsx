import { afterEach, describe, expect, it, vi } from "vitest";
import { createNotificationCenter } from "./index";

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("notification center (React)", () => {
  it("renders dismissible error notifications with the legacy DOM contract", () => {
    const center = createNotificationCenter({ duration: 0 });
    const notification = center.notify({
      type: "error",
      title: "Uninstall failed",
      message: "could not remove this extension package.",
      detail: "Permission denied",
    });

    expect(document.querySelector(".native-notification-stack")).not.toBeNull();
    expect(notification.element.getAttribute("role")).toBe("alert");
    expect(notification.element.textContent).toContain("Uninstall failed");
    expect(notification.element.textContent).toContain("Permission denied");

    notification.element.querySelector("button")?.click();

    expect(document.querySelector(".native-notification-stack")).toBeNull();
  });

  it("auto dismisses notifications after the configured duration", () => {
    vi.useFakeTimers();
    const center = createNotificationCenter({ duration: 100 });

    center.notify("Saved");
    expect(document.querySelector(".native-notification")).not.toBeNull();

    vi.advanceTimersByTime(100);

    expect(document.querySelector(".native-notification")).toBeNull();
  });

  it("localizes the fallback title for notifications without one", () => {
    const center = createNotificationCenter({ duration: 0 });
    const notification = center.notify({ type: "info" });
    expect(notification.element.textContent).toContain("通知");
  });

  it("localizes the fallback title for malformed notification input", () => {
    const center = createNotificationCenter({ duration: 0 });
    const notification = center.notify(null as unknown as string);
    expect(notification.element.textContent).toContain("通知");
    expect(notification.element.textContent).not.toContain("Notification");
  });

  it("renders an action button that runs and dismisses the notification", () => {
    const center = createNotificationCenter({ duration: 0 });
    const run = vi.fn();
    const notification = center.notify({
      type: "warning",
      title: "Plugin not enabled",
      message: "This plugin is disabled.",
      action: { label: "Open Plugin Manager", run },
    });

    const actionButton = notification.element.querySelector(
      ".native-notification-action",
    );
    expect(actionButton).not.toBeNull();
    expect(actionButton?.textContent).toContain("Open Plugin Manager");

    actionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(run).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".native-notification")).toBeNull();
  });
});
