import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import { setupBrowserApp } from "./browser-app.js";
let app;
afterEach(async () => { await app?.canDeactivate(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
const tab = n => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, url: `https://example.org/${n}`, title: `Page ${n}`, zoom: 1, muted: false });
async function mount({ tabs = [tab(1), tab(3)], closedTabs = [{ tab: tab(2), index: 1 }], reject = () => false } = {}) {
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  let session = { revision: 1, tabs, activeTab: tabs[0]?.id ?? null, closedTabs };
  const calls = [];
  const invoke = async (name, args) => {
    calls.push({ name, args });
    if (name === "browser_get_state") return { startupMode: "browser", session: structuredClone(session) };
    if (name === "browser_control" && args.request.kind === "status") return { surfaceRevision: 0, tabs: [] };
    if (name === "browser_save_session") {
      if (reject(args)) throw Error("Test storage unavailable");
      expect(args.expectedRevision).toBe(session.revision);
      const live = new Set(args.tabs.map(t => t.id));
      const closed = session.closedTabs.filter(e => !live.has(e.tab.id));
      session.tabs.forEach((t, index) => { if (!live.has(t.id)) closed.push({ tab: t, index }); });
      session = { revision: session.revision + 1, tabs: args.tabs, activeTab: args.activeTab, closedTabs: closed };
      return structuredClone(session);
    }
    return {};
  };
  app = setupBrowserApp({ invoke, listen: async () => {} });
  const root = document.createElement("main"); document.body.append(root); app.renderContent(root);
  await waitFor(() => expect(root.querySelectorAll('[role="tab"]').length).toBe(tabs.length));
  const reopen = async () => {
    const menu = root.querySelector(".browser-options"); menu.open = true;
    menu.dispatchEvent(new Event("toggle"));
    const button = root.querySelector(".browser-reopen"); expect(button.disabled).toBe(false); button.click();
  };
  return { root, reopen, calls, saved: () => session };
}
it("restores the latest closed tab at its original position and disables empty history", async () => {
  const h = await mount(); await h.reopen();
  await waitFor(() => expect(h.saved().tabs.map(t => t.id)).toEqual([tab(1).id, tab(2).id, tab(3).id]));
  expect(h.saved().activeTab).toBe(tab(2).id); expect(h.saved().closedTabs).toEqual([]);
  expect(h.root.querySelector('[aria-selected="true"]').textContent).toBe("Page 2");
  const menu = h.root.querySelector(".browser-options"); menu.open = true; menu.dispatchEvent(new Event("toggle"));
  expect(h.root.querySelector(".browser-reopen").disabled).toBe(true);
});
it("keeps recovery available after a failed save, closes its candidate view and permits retry", async () => {
  let reject = true; const h = await mount({ reject: () => reject }); await h.reopen();
  await waitFor(() => expect(h.root.querySelector('[role="status"]').textContent).toContain("Test storage unavailable"));
  expect(h.saved().closedTabs).toHaveLength(1);expect(h.saved().tabs).toHaveLength(2);
  expect(h.calls.some(c => c.args?.request?.kind === "close" && c.args.request.tab === tab(2).id)).toBe(true);
  reject = false;await h.reopen();await waitFor(() => expect(h.saved().closedTabs).toEqual([]));
  expect(h.saved().tabs).toHaveLength(3);
  expect(h.root.querySelector('[role="status"]').textContent).toBe("");
});
it("failed close persistence retains the visible tab and a later close can save", async () => {
  let reject = true;const h = await mount({ closedTabs: [], reject: args => reject && args.tabs.length === 1 });
  h.root.querySelector(".browser-tab button:last-child").click();
  await waitFor(() => expect(h.root.querySelector('[role="status"]').textContent).toContain("Test storage unavailable"));
  expect(h.root.querySelectorAll('[role="tab"]')).toHaveLength(2);expect(h.saved().closedTabs).toEqual([]);
  reject = false;h.root.querySelector(".browser-tab button:last-child").click();
  await waitFor(() => expect(h.saved().closedTabs).toHaveLength(1));
  expect(h.saved().closedTabs[0].tab).toEqual(tab(1));expect(h.saved().tabs).toHaveLength(1);
  expect(h.root.querySelector('[role="status"]').textContent).toBe("");
});
it("reopens into an empty window and clamps the former position", async () => {
  const h = await mount({ tabs: [], closedTabs: [{ tab: tab(2), index: 12 }] });
  await h.reopen();await waitFor(() => expect(h.saved().tabs).toEqual([tab(2)]));
  expect(h.saved().activeTab).toBe(tab(2).id);expect(h.saved().closedTabs).toEqual([]);
});

it("keyboard close of the last tab leaves Studio usable for restore and new tab", async () => {
  const h = await mount({ tabs: [tab(1)], closedTabs: [] }), address = h.root.querySelector(".browser-address");
  const key = (key, shiftKey = false) => address.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, shiftKey, bubbles: true, cancelable: true }));
  key("w"); await waitFor(() => expect(h.saved().tabs).toEqual([]));
  await waitFor(() => expect(document.activeElement).toBe(address));
  key("t", true); await waitFor(() => expect(h.saved().tabs).toEqual([tab(1)]));
  key("w"); await waitFor(() => expect(h.saved().tabs).toEqual([]));
  await waitFor(() => expect(document.activeElement).toBe(address));
  key("t"); await waitFor(() => expect(h.saved().tabs).toHaveLength(1));
  expect(h.saved().tabs[0].url).toBe("about:blank"); expect(h.saved().tabs[0].id).not.toBe(tab(1).id);
  await waitFor(() => expect(document.activeElement).toBe(address));
});


it("tab shortcuts replace the previous address draft with the selected page URL", async () => {
  const h = await mount({ closedTabs: [] }), address = h.root.querySelector(".browser-address");
  const key = async (key, shiftKey = false) => { address.focus(); address.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, shiftKey, bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 0)); };
  address.value = "unsent address draft"; await key("Tab");
  await waitFor(() => expect(h.saved().activeTab).toBe(tab(3).id)); expect(address.value).toBe(tab(3).url);
  await key("Tab", true); await waitFor(() => expect(h.saved().activeTab).toBe(tab(1).id)); expect(address.value).toBe(tab(1).url);
  await key("w"); await waitFor(() => expect(h.saved().tabs).toHaveLength(1)); expect(address.value).toBe(tab(3).url);
  await key("t", true); await waitFor(() => expect(h.saved().activeTab).toBe(tab(1).id)); expect(address.value).toBe(tab(1).url);
  await key("t"); await waitFor(() => expect(h.saved().tabs).toHaveLength(3)); expect(address.value).toBe("");
});
