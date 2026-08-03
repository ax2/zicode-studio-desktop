import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOBILE_HISTORY_LAYER_KEY, setupMobileHistoryLayer } from "./mobile-history-layer.js";

describe("mobile history layer", () => {
  beforeEach(() => {
    history.replaceState({ route: "chat" }, "", "/app/chat");
  });

  it("adds a same-route history entry and closes when Back reveals the previous state", () => {
    let active = true;
    const onBack = vi.fn(() => {
      active = false;
    });
    const layer = setupMobileHistoryLayer({ id: "more", isActive: () => active, onBack });
    expect(layer.enter()).toBe(true);
    expect(history.state).toMatchObject({ route: "chat", [MOBILE_HISTORY_LAYER_KEY]: "more" });

    window.dispatchEvent(new PopStateEvent("popstate", { state: { route: "chat" } }));
    expect(onBack).toHaveBeenCalledOnce();
    layer.dispose();
  });

  it("can discard a programmatically closed layer without navigating", () => {
    const back = vi.spyOn(history, "back");
    const layer = setupMobileHistoryLayer({ id: "drawer", isActive: () => true, onBack: vi.fn() });
    layer.enter();
    expect(layer.leave({ replace: true })).toBe(true);
    expect(back).not.toHaveBeenCalled();
    expect(history.state).toEqual({ route: "chat" });
    layer.dispose();
    back.mockRestore();
  });
});
