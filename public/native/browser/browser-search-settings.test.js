import { expect, it, vi } from "vitest";
import { createBrowserSearchSettings } from "./browser-search-settings.js";
it("waits for loading and saves only after a deliberate selection", async () => {
  const save = vi.fn(async id => id); const settings = createBrowserSearchSettings({ save, report: vi.fn() });
  const select = settings.element.querySelector("select"); expect(select.disabled).toBe(true);
  settings.initialize("baidu"); expect(select.value).toBe("baidu"); expect(save).not.toHaveBeenCalled();
  select.value = "google"; select.dispatchEvent(new Event("change")); expect(select.disabled).toBe(true);
  await vi.waitFor(() => expect(select.disabled).toBe(false)); expect(settings.value()).toBe("google"); expect(save).toHaveBeenCalledWith("google");
});
it("restores the previous provider when saving fails", async () => {
  const report = vi.fn(); const settings = createBrowserSearchSettings({ save: async () => { throw new Error("disk error"); }, report });
  settings.initialize("duckDuckGo"); const select = settings.element.querySelector("select"); select.value = "bing"; select.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(select.disabled).toBe(false)); expect(select.value).toBe("duckDuckGo"); expect(settings.value()).toBe("duckDuckGo"); expect(report).toHaveBeenCalledOnce();
});
