import { afterEach, expect, it, vi } from "vitest";
import { setupTranslationShortcuts } from "./translation-shortcuts.js";
const handles = [];
afterEach(() => { for (const handle of handles.splice(0)) handle.destroy(); });
function fixture(extra = {}) {
  let active = "notes";
  const activate = vi.fn(async id => { active = id; }), focusInput = vi.fn();
  const handle = setupTranslationShortcuts({ activate, focusInput, getActivePluginId: () => active, ...extra });
  handles.push(handle); return { activate, focusInput, handle };
}
it("opens translation with the app shortcut and focuses it without running a model", async () => {
  const { activate, focusInput } = fixture();
  const event = new KeyboardEvent("keydown", { key: "Y", ctrlKey: true, shiftKey: true, cancelable: true, bubbles: true });
  document.dispatchEvent(event);
  await vi.waitFor(() => expect(focusInput).toHaveBeenCalledTimes(1));
  expect(event.defaultPrevented).toBe(true);
  expect(activate).toHaveBeenCalledWith("com.zicode.translate");
});
it("preserves a surface that refuses to deactivate and ignores IME input", async () => {
  const { activate, focusInput } = fixture({ getActivePluginId: () => "notes" });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true, shiftKey: true, isComposing: true }));
  expect(activate).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("zicode:open-translation"));
  await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(1));
  expect(focusInput).not.toHaveBeenCalled();
});
it("receives the native tray action and removes it when destroyed", async () => {
  let received; const stop = vi.fn();
  const listen = vi.fn(async (_name, handler) => { received = handler; return stop; });
  const { activate, handle } = fixture({ listen });
  expect(listen).toHaveBeenCalledWith("studio-open-translation", expect.any(Function));
  received(); await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(1));
  handle.destroy(); received();
  expect(stop).toHaveBeenCalledTimes(1); expect(activate).toHaveBeenCalledTimes(1);
});
