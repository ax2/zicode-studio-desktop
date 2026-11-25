import { afterEach, expect, it, vi } from "vitest";
import { setupTranslationShortcuts } from "./translation-shortcuts.js";
const handles = [];
const owner = { sceneId: "programming", workspaceId: "ws-1" };
const recent = { kind: "recentRecord", id: "com.zicode.translate:open" };
afterEach(() => { for (const handle of handles.splice(0)) handle.destroy(); });
function fixture(extra = {}) {
  let active = "notes";
  const activate = vi.fn(async id => { active = id; }), focusInput = vi.fn();
  const stageSelection = vi.fn(), recordRecent = vi.fn(), onError = vi.fn();
  const handle = setupTranslationShortcuts({
    activate, focusInput, stageSelection, recordRecent, onError,
    getActivePluginId: () => active, getTarget: () => owner, ...extra,
  });
  handles.push(handle); return { activate, focusInput, stageSelection, recordRecent, onError, handle };
}
it("opens translation with the app shortcut and focuses it without running a model", async () => {
  const { activate, focusInput, recordRecent } = fixture();
  const event = new KeyboardEvent("keydown", { key: "Y", ctrlKey: true, shiftKey: true, cancelable: true, bubbles: true });
  document.dispatchEvent(event);
  await vi.waitFor(() => expect(focusInput).toHaveBeenCalledTimes(1));
  expect(event.defaultPrevented).toBe(true);
  expect(activate).toHaveBeenCalledWith("com.zicode.translate", undefined);
  expect(recordRecent).toHaveBeenCalledExactlyOnceWith(owner, recent);
});
it("preserves a surface that refuses to deactivate and ignores IME input", async () => {
  const { activate, focusInput, recordRecent } = fixture({ getActivePluginId: () => "notes" });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true, shiftKey: true, isComposing: true }));
  expect(activate).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("zicode:open-translation"));
  await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(1));
  expect(focusInput).not.toHaveBeenCalled();
  expect(recordRecent).not.toHaveBeenCalled();
});
it("receives the native tray action and removes it when destroyed", async () => {
  let received; const stop = vi.fn();
  const listen = vi.fn(async (_name, handler) => { received = handler; return stop; });
  const { activate, handle, recordRecent } = fixture({ listen });
  expect(listen).toHaveBeenCalledWith("studio-open-translation", expect.any(Function));
  received(); await vi.waitFor(() => expect(recordRecent).toHaveBeenCalledExactlyOnceWith(owner, recent));
  handle.destroy(); received();
  expect(stop).toHaveBeenCalledTimes(1); expect(activate).toHaveBeenCalledTimes(1);
});

it("stages a browser selection after activation and records only the app identity", async () => {
  const { activate, handle, stageSelection, recordRecent } = fixture();
  await handle.open("Selected browser text", { historyMode: "push" });
  expect(activate).toHaveBeenCalledExactlyOnceWith("com.zicode.translate", { historyMode: "push" });
  expect(stageSelection).toHaveBeenCalledExactlyOnceWith("Selected browser text", undefined);
  expect(recordRecent).toHaveBeenCalledExactlyOnceWith(owner, recent);
});

it.each(["workspaceId", "sceneId"])("skips staging and history when %s changes during activation", async field => {
  const current = { ...owner };
  const { handle, stageSelection, recordRecent } = fixture({
    getTarget: () => current,
    getActivePluginId: () => "com.zicode.translate",
    activate: async () => {
      current[field] = "other";
      window.dispatchEvent(new Event("zicode:tool-target-changed"));
      current[field] = owner[field];
      window.dispatchEvent(new Event("zicode:tool-target-changed"));
    },
  });
  await handle.open("Selected browser text");
  expect(stageSelection).not.toHaveBeenCalled();
  expect(recordRecent).not.toHaveBeenCalled();
});

it("stages only the newer selection when activations finish out of order", async () => {
  let resolvePrevious;
  const activate = vi.fn()
    .mockImplementationOnce(() => new Promise(resolve => { resolvePrevious = resolve; }))
    .mockResolvedValue(true);
  const { handle, stageSelection, focusInput, recordRecent } = fixture({
    activate,
    getActivePluginId: () => "com.zicode.translate",
  });
  const older = handle.open("Previous webpage text");
  await handle.open("New webpage text");
  resolvePrevious(true);
  await older;
  expect(stageSelection).toHaveBeenCalledExactlyOnceWith("New webpage text", undefined);
  expect(focusInput).toHaveBeenCalledOnce();
  expect(recordRecent).toHaveBeenCalledExactlyOnceWith(owner, recent);
});

it("reports activation failure without recording history", async () => {
  const error = new Error("activation failed");
  const { onError, focusInput, recordRecent } = fixture({ activate: vi.fn().mockRejectedValue(error) });
  window.dispatchEvent(new Event("zicode:open-translation"));
  await vi.waitFor(() => expect(onError).toHaveBeenCalledExactlyOnceWith(error));
  expect(focusInput).not.toHaveBeenCalled();
  expect(recordRecent).not.toHaveBeenCalled();
});

it("keeps successful navigation when recording fails", async () => {
  const recordRecent = vi.fn().mockRejectedValue(new Error("history unavailable"));
  const { handle, focusInput, onError } = fixture({ recordRecent });
  await expect(handle.open()).resolves.toBeUndefined();
  expect(focusInput).toHaveBeenCalledTimes(1);
  expect(recordRecent).toHaveBeenCalledExactlyOnceWith(owner, recent);
  expect(onError).not.toHaveBeenCalled();
});
