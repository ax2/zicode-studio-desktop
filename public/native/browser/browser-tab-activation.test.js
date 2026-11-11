import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import { setupBrowserApp } from "./browser-app.js";

let app;
afterEach(async () => { await app?.canDeactivate(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const tab = id => ({ id, url: `https://example.org/${id}`, title: `Page ${id}`, zoom: 1, muted: false });
async function mount(closedTabs = []) {
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 50, y: 80, width: 900, height: 600 });
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  let session = { revision: 1, tabs: [tab("a"), tab("b")], activeTab: "a", closedTabs };
  let visible = null;
  const views = new Set(), requests = [];
  const hooks = { save: async () => {}, create: async () => {}, present: async () => {} };
  const invoke = async (name, args) => {
    if (name === "browser_get_state") return { startupMode: "browser", session: structuredClone(session) };
    if (name === "browser_save_session") {
      await hooks.save(); expect(args.expectedRevision).toBe(session.revision);
      session = { ...session, revision: session.revision + 1, tabs: args.tabs, activeTab: args.activeTab };
      return structuredClone(session);
    }
    if (name === "browser_control") {
      const r = args.request; requests.push(r);
      if (r.kind === "status") return { surfaceRevision: 0, tabs: [] };
      if (r.kind === "create") { await hooks.create(); views.add(r.tabId); }
      if (r.kind === "close") views.delete(r.tab);
      if (r.kind === "hide") visible = null;
      if (r.kind === "present") { await hooks.present(); visible = r.tab; }
    }
    return {};
  };
  const root = document.createElement("main"); document.body.append(root);
  app = setupBrowserApp({ invoke }); app.renderContent(root);
  await waitFor(() => expect(visible).toBe("a"));
  return { root, hooks, requests, views, saved: () => structuredClone(session), visible: () => visible,
    selected: () => root.querySelector('[aria-selected="true"]').closest("[data-browser-tab-id]").dataset.browserTabId,
    select: id => root.querySelector(`[data-browser-tab-id="${id}"] [role=tab]`).click(),
    add: () => root.querySelector(".browser-tab-strip > button").click(),
    status: () => root.querySelector('.browser-footer > [role="status"]').textContent };
}
it("keeps the current document and page search during a delayed or failed selection, then retries", async () => {
  const h = await mount(); let fail;
  h.root.querySelector(".browser-address").dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }));
  expect(h.root.querySelector(".browser-find").hidden).toBe(false);
  const before = h.saved(); h.requests.length = 0;
  h.hooks.save = () => new Promise((_, reject) => { fail = reject; });
  h.select("b"); await waitFor(() => expect(fail).toBeTypeOf("function"));
  expect(h.visible()).toBe("a"); expect(h.selected()).toBe("a"); expect(h.saved()).toEqual(before);
  fail(Error("Storage busy")); await waitFor(() => expect(h.status()).toBe("Storage busy"));
  expect(h.selected()).toBe("a"); expect(h.visible()).toBe("a");
  expect(h.root.querySelector(".browser-find").hidden).toBe(false);
  expect(h.requests.filter(r => ["hide", "present", "close"].includes(r.kind))).toEqual([]);
  h.hooks.save = async () => {}; h.select("b");
  await waitFor(() => expect(h.visible()).toBe("b"));
  expect(h.selected()).toBe("b"); expect(h.saved().activeTab).toBe("b"); expect(h.status()).toBe("");
  expect(h.root.querySelector(".browser-find").hidden).toBe(true);
});
it("discards only the unsaved new view and retries without phantom tabs or closed history", async () => {
  const h = await mount(), before = h.saved(); h.requests.length = 0;
  h.hooks.save = async () => { throw Error("Storage busy"); }; h.add();
  await waitFor(() => expect(h.status()).toBe("Storage busy"));
  expect(h.saved()).toEqual(before); expect(h.selected()).toBe("a"); expect(h.visible()).toBe("a");
  expect(h.root.querySelectorAll('[role="tab"]')).toHaveLength(2); expect([...h.views]).toEqual(["a"]);
  const candidate = h.requests.find(r => r.kind === "create").tabId;
  expect(h.requests.filter(r => r.kind === "close").map(r => r.tab)).toEqual([candidate]);
  expect(h.requests.filter(r => ["hide", "present"].includes(r.kind))).toEqual([]);
  h.hooks.save = async () => {}; h.add();
  await waitFor(() => expect(h.saved().tabs).toHaveLength(3));
  await waitFor(() => expect(h.visible()).toBe(h.saved().activeTab));
  expect(h.saved().activeTab).not.toBe(candidate); expect(h.saved().closedTabs).toEqual([]);
  expect(document.activeElement).toBe(h.root.querySelector(".browser-address")); expect(h.status()).toBe("");
});
it("does not persist or expose a tab whose native creation failed", async () => {
  const h = await mount(), before = h.saved();
  h.hooks.create = async () => { throw Error("Native creation unavailable"); }; h.add();
  await waitFor(() => expect(h.status()).toBe("Native creation unavailable"));
  expect(h.saved()).toEqual(before); expect(h.selected()).toBe("a"); expect(h.visible()).toBe("a");
  expect([...h.views]).toEqual(["a"]);
});
it("retains a durably saved new tab if native presentation subsequently fails", async () => {
  const h = await mount();
  h.hooks.present = async () => { throw Error("Native presentation unavailable"); }; h.add();
  await waitFor(() => expect(h.status()).toBe("Native presentation unavailable"));
  expect(h.saved().tabs).toHaveLength(3); expect(h.selected()).toBe(h.saved().activeTab);
  expect(h.views.has(h.saved().activeTab)).toBe(true);
  expect(h.requests.some(r => r.kind === "close")).toBe(false);
  const committed = h.saved();
  h.hooks.present = async () => {}; h.select(committed.activeTab);
  await waitFor(() => expect(h.visible()).toBe(committed.activeTab));
  expect(h.saved()).toEqual(committed); expect(h.status()).toBe("");
});

it("preserves the active native document when the final close save fails, then records the close on retry", async () => {
  const h = await mount();
  const close = () => h.root.querySelector('[data-browser-tab-id="a"] .browser-tab-close').click();
  let writes = 0;
  h.requests.length = 0;
  h.hooks.save = async () => {
    if (++writes === 2) throw Error("Removal could not be saved");
  };
  close();
  await waitFor(() => expect(h.status()).toBe("Removal could not be saved"));
  expect(h.saved().revision).toBe(2);
  expect(h.saved().tabs).toEqual([tab("a"), tab("b")]);
  expect(h.selected()).toBe("a");
  expect(h.visible()).toBe("a");
  expect(h.requests.filter(r => ["close", "hide", "create", "present"].includes(r.kind))).toEqual([]);
  close();
  await waitFor(() => expect(h.visible()).toBe("b"));
  expect(h.saved().tabs).toEqual([tab("b")]);
  expect(h.selected()).toBe("b");
  expect(h.views.has("a")).toBe(false);
  expect(h.status()).toBe("");
});

it("keeps the live page and its find bar while a recently closed tab fails to restore", async () => {
  const h = await mount([{ tab: tab("c"), index: 1 }]);
  const address = h.root.querySelector(".browser-address");
  const shortcut = (key, shiftKey = false) => address.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, shiftKey, bubbles: true, cancelable: true }));
  shortcut("f");
  const before = h.saved();
  h.requests.length = 0;
  h.hooks.save = async () => { throw Error("Restore save rejected"); };
  shortcut("t", true);
  await waitFor(() => expect(h.status()).toBe("Restore save rejected"));
  expect(h.saved()).toEqual(before);
  expect(h.selected()).toBe("a");
  expect(h.visible()).toBe("a");
  expect(h.root.querySelector(".browser-find").hidden).toBe(false);
  expect(h.requests.filter(r => ["hide", "present"].includes(r.kind))).toEqual([]);
  expect([...h.views]).toEqual(["a"]);
  h.hooks.save = async () => {};
  shortcut("t", true);
  await waitFor(() => expect(h.visible()).toBe("c"));
  expect(h.saved().tabs.map(t => t.id)).toEqual(["a", "c", "b"]);
  expect(h.root.querySelector(".browser-find").hidden).toBe(true);
});
