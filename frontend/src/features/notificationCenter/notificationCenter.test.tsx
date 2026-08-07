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
});
