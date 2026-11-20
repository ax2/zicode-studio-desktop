import { afterEach, expect, it, vi } from "vitest";
import { getByRole, waitFor } from "@testing-library/dom";
import { t } from "../../i18n.js";
import { applyBrowserPageSetting, createBrowserPageControls, nextPageZoom } from "./browser-page-controls.js";
afterEach(() => document.body.replaceChildren());
it("uses standard zoom stops and bounded endpoints, including an intermediate native zoom", () => {
  expect(nextPageZoom(1, 1)).toBe(1.1);expect(nextPageZoom(1.1, 1)).toBe(1.25);expect(nextPageZoom(1.2, -1)).toBe(1.1);
  expect(nextPageZoom(0.25, -1)).toBe(0.25);expect(nextPageZoom(5, 1)).toBe(5);
});
it("persists measured native settings and rolls back the affected native property if storage rejects them", async () => {
  const write = vi.fn(async change => ({ zoom: change.value, muted: true }));const persist = vi.fn().mockRejectedValueOnce(Error("Storage failed"));
  await expect(applyBrowserPageSetting({ change: { kind: "zoom", value: 1.5 }, read: async () => ({ zoom: 1.1, muted: true }), write, persist })).rejects.toThrow("Storage failed");
  expect(persist).toHaveBeenCalledWith({ zoom: 1.5, muted: true });expect(write.mock.calls).toEqual([[{ kind: "zoom", value: 1.5 }], [{ kind: "zoom", value: 1.1 }]]);
  persist.mockResolvedValueOnce();await expect(applyBrowserPageSetting({ change: { kind: "zoom", value: 1.5 }, read: async () => ({ zoom: 1.1, muted: true }), write, persist })).resolves.toEqual({ zoom: 1.5, muted: true });
});
it("reports failed rollback without falsely marking a setting saved", async () => {
  const persist = vi.fn().mockRejectedValue(Error("Storage failed"));const write = vi.fn().mockResolvedValueOnce({ zoom: 1, muted: true }).mockRejectedValueOnce(Error("Renderer unavailable"));
  await expect(applyBrowserPageSetting({ change: { kind: "muted", value: true }, read: async () => ({ zoom: 1, muted: false }), write, persist })).rejects.toThrow(t("Page setting could not be saved or restored. Reopen the menu to check it."));
});
it("refreshes from the native tab, applies reset/mute and disables bounds", async () => {
  let live = { zoom: 1.5, muted: true };const changes = [];
  const panel = createBrowserPageControls({ getTab: () => ({ id: "current" }), read: async () => live, change: async (id, change) => { changes.push({ id, ...change });live = { ...live, [change.kind]: change.value }; } });
  document.body.append(panel.element);await panel.refresh();expect(getByRole(panel.element, "button", { name: t("Reset page zoom") }).textContent).toBe("150%");
  getByRole(panel.element, "button", { name: t("Reset page zoom") }).click();await waitFor(() => expect(panel.element.disabled).toBe(false));expect(live.zoom).toBe(1);
  getByRole(panel.element, "button", { name: t("Unmute tab") }).click();await waitFor(() => expect(live.muted).toBe(false));await waitFor(() => expect(panel.element.disabled).toBe(false));
  expect(changes).toEqual([{ id: "current", kind: "zoom", value: 1 }, { id: "current", kind: "muted", value: false }]);
  live.zoom = 5;await panel.refresh();expect(getByRole(panel.element, "button", { name: t("Zoom in") }).disabled).toBe(true);
  live.zoom = 0.25;await panel.refresh();expect(getByRole(panel.element, "button", { name: t("Zoom out") }).disabled).toBe(true);
});
it("rejects stale reads after a tab switch and disables missing tabs", async () => {
  let id = "old", resolveOld;const change = vi.fn();
  const panel = createBrowserPageControls({ getTab: () => id ? { id } : null, read: tab => tab === "old" ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ zoom: 1.25, muted: false }), change });document.body.append(panel.element);
  const old = panel.refresh();id = "new";await panel.refresh();resolveOld({ zoom: 5, muted: true });await old;
  expect(getByRole(panel.element, "button", { name: t("Reset page zoom") }).textContent).toBe("125%");expect(panel.element.disabled).toBe(false);
  id = null;await panel.refresh();expect(panel.element.disabled).toBe(true);expect(change).not.toHaveBeenCalled();
});
