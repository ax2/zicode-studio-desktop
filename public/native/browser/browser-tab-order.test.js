import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/dom";
import { setupBrowserApp } from "./browser-app.js";
import { moveBrowserTab, setupBrowserTabOrdering } from "./browser-tab-order.js";
const tab = n => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, url: `https://example.org/${n}`, title: `Page ${n}`, zoom: 1, muted: false });
let app;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} }); vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, right: 100, width: 100, height: 32, top: 0, bottom: 32 }); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(async () => { await app?.canDeactivate(); app = null; document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete Element.prototype.scrollIntoView; });
const dataTransfer = () => ({ setData: vi.fn(), effectAllowed: "", dropEffect: "" });
function drag(node, type, transfer, x = 75) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { dataTransfer: transfer, clientX: x, clientY: 16 }); node.dispatchEvent(event); return event;
}
async function mount({ reject = () => false } = {}) {
  let session = { revision: 1, tabs: [tab(1), tab(2), tab(3)], activeTab: tab(2).id, closedTabs: [{ tab: tab(4), index: 0 }] }, receive;
  const calls = [];
  const invoke = async (name, args) => {
    calls.push({ name, args });
    if (name === "browser_get_state") return { startupMode: "browser", session: structuredClone(session) };
    if (name === "browser_control" && args.request.kind === "status") return { surfaceRevision: 0, tabs: [] };
    if (name === "browser_save_session") {
      if (reject()) throw Error("Order storage unavailable");
      expect(args.expectedRevision).toBe(session.revision);
      session = { ...session, revision: session.revision + 1, tabs: args.tabs, activeTab: args.activeTab };return structuredClone(session);
    }
    return {};
  };
  app = setupBrowserApp({ invoke, listen: async (_name, callback) => { receive = callback; } });
  const root = document.createElement("main");document.body.append(root);app.renderContent(root);
  await waitFor(() => expect(root.querySelectorAll('[role="tab"]')).toHaveLength(3));
  await waitFor(() => expect(calls.some(c => c.args?.request?.kind === "present")).toBe(true));
  const title = n => root.querySelector(`[data-browser-tab-id="${tab(n).id}"] [role="tab"]`);
  return { root, title, calls, saved: () => session, receive: payload => receive({ payload }) };
}
it("moves both directions and ignores absent targets, out-of-range steps and adjacent no-ops", () => {
  const tabs = [tab(1), tab(2), tab(3)];
  expect(moveBrowserTab(tabs, { id: tab(1).id, target: tab(3).id, after: true })).toEqual([tabs[1], tabs[2], tabs[0]]);
  expect(moveBrowserTab(tabs, { id: tab(3).id, step: -1 })).toEqual([tabs[0], tabs[2], tabs[1]]);
  for (const change of [{ id: "missing", step: 1 }, { id: tab(1).id, step: -1 }, { id: tab(1).id, target: tab(2).id }, { id: tab(1).id, target: "missing" }, { id: tab(1).id, target: tab(1).id }]) expect(moveBrowserTab(tabs, change)).toBe(tabs);
});
it("persists a drop without reloading native pages or changing selection, and keeps the drag node during title events", async () => {
  const h = await mount(), original = h.title(1), transfer = dataTransfer(), callsBefore = h.calls.length;
  drag(original, "dragstart", transfer);h.receive({ kind: "title", tab: tab(1).id, title: "Updated while dragging" });
  expect(h.title(1)).toBe(original);drag(h.title(3), "drop", transfer);
  await waitFor(() => expect(h.saved().tabs.map(t => t.id)).toEqual([tab(2).id, tab(3).id, tab(1).id]));
  expect(h.saved().tabs[2].title).toBe("Updated while dragging");expect(h.saved().activeTab).toBe(tab(2).id);expect(h.saved().closedTabs).toHaveLength(1);
  expect(h.calls.slice(callsBefore).every(c => c.name === "browser_save_session")).toBe(true);
  expect(document.activeElement).toBe(h.title(1));expect(h.root.querySelector('[aria-selected="true"]')).toBe(h.title(2));
});
it("does not change order when persistence fails and allows a keyboard retry with focus retained", async () => {
  let reject = true; const h = await mount({ reject: () => reject });
  fireEvent.keyDown(h.title(1), { key: "ArrowRight", altKey: true, shiftKey: true });
  await waitFor(() => expect(h.root.querySelector('[role="status"]').textContent).toContain("Order storage unavailable"));
  expect(h.saved().tabs).toEqual([tab(1), tab(2), tab(3)]);expect([...h.root.querySelectorAll('[role="tab"]')].map(t => t.textContent)).toEqual(["Page 1", "Page 2", "Page 3"]);
  reject = false;fireEvent.keyDown(h.title(1), { key: "ArrowRight", altKey: true, shiftKey: true });await waitFor(() => expect(h.saved().tabs[1].id).toBe(tab(1).id));
  expect(document.activeElement).toBe(h.title(1));expect(h.saved().activeTab).toBe(tab(2).id);
});
it("ignores external drops and composition, and cancels drags without saving", async () => {
  const h = await mount(), transfer = dataTransfer();drag(h.title(3), "drop", transfer);
  fireEvent.keyDown(h.title(1), { key: "ArrowRight", altKey: true, shiftKey: true, isComposing: true });
  const close = h.title(1).parentElement.querySelector('button:last-child');expect(drag(close, "dragstart", transfer).defaultPrevented).toBe(true);
  drag(h.title(1), "dragstart", transfer);fireEvent.keyDown(h.title(1), { key: "Escape" });drag(h.title(3), "drop", transfer);
  expect(h.calls.filter(c => c.name === "browser_save_session")).toEqual([]);expect(h.root.querySelector('.browser-tabs--dragging')).toBeNull();
});
it("scrolls an overflowing strip while dragging near its edge, then stops on cancellation", () => {
  const host = document.createElement("div"), row = document.createElement("div"), title = document.createElement("button");title.setAttribute("role", "tab");row.append(title);host.append(row);document.body.append(host);
  let frame;vi.stubGlobal("requestAnimationFrame", vi.fn(callback => { frame = callback;return 7; }));vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const ordering = setupBrowserTabOrdering(host, { onMove: vi.fn() });ordering.decorate(row, title, "source");
  const original = document.elementFromPoint;document.elementFromPoint = () => title;
  const transfer = dataTransfer();drag(title, "dragstart", transfer);drag(title, "dragover", transfer, 99);frame(16);
  expect(host.scrollLeft).toBeGreaterThan(0);ordering.cancel();expect(cancelAnimationFrame).toHaveBeenCalledWith(7);expect(ordering.dragging).toBe(false);
  if (original) document.elementFromPoint = original;else delete document.elementFromPoint;
});
