import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import { setupBrowserApp } from "./browser-app.js";
import { t } from "../../i18n.js";

let app;
afterEach(async () => { await app?.canDeactivate(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const tab = id => ({ id, url: `https://example.org/${id}`, title: `Page ${id}`, zoom: 1, muted: false });
async function mount(closedTabs = [], restoredDocument = null) {
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 50, y: 80, width: 900, height: 600 });
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  let session = { revision: 1, tabs: [tab("a"), tab("b")], activeTab: "a", closedTabs };
  let visible = null, emit;
  const views = new Set(), requests = [];
  const hooks = { save: async () => {}, create: async () => {}, present: async () => {}, savePdf: async () => ({}), navigate: async () => {} };
  const invoke = async (name, args) => {
    if (name === "browser_get_state") return { startupMode: "browser", session: structuredClone(session) };
    if (name === "browser_save_session") {
      await hooks.save(); expect(args.expectedRevision).toBe(session.revision);
      session = { ...session, revision: session.revision + 1, tabs: args.tabs, activeTab: args.activeTab };
      return structuredClone(session);
    }
    if (name === "browser_control") {
      const r = args.request; requests.push(r);
      if (r.kind === "status") {
        if (!restoredDocument) return { surfaceRevision: 0, tabs: [] };
        views.add("a");
        // The existing view can finish loading while its startup snapshot is in flight.
        emit({ kind: "navigationFinished", tab: "a", success: true, documentRevision: restoredDocument });
        return { surfaceRevision: 0, tabs: [tab("a")] };
      }
      if (r.kind === "create") {
        await hooks.create();
        views.add(r.tabId);
        emit({ kind: "navigationFinished", tab: r.tabId, success: true, documentRevision: `${r.tabId}:1` });
      }
      if (r.kind === "close") views.delete(r.tab);
      if (r.kind === "savePdf") return hooks.savePdf();
      if (r.kind === "navigate") return hooks.navigate();
      if (r.kind === "hide") visible = null;
      if (r.kind === "present") { await hooks.present(); visible = r.tab; }
    }
    return {};
  };
  const root = document.createElement("main"); document.body.append(root);
  const listen = async (_name, callback) => { emit = payload => callback({ payload }); };
  app = setupBrowserApp({ invoke, listen }); app.renderContent(root);
  await waitFor(() => expect(visible).toBe("a"));
  return { root, hooks, requests, views, emit, saved: () => structuredClone(session), visible: () => visible,
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
it("routes only a currently confirmed PDF to its reader and keeps regular search on the next document", async () => {
  const h = await mount();
  const menu = h.root.querySelector(".browser-options");
  const findEntry = menu.querySelector(".browser-find-open");
  h.emit({ kind: "pdfDocument", tab: "a", documentRevision: "a:1" });
  menu.open = true;
  findEntry.click();
  await waitFor(() => expect(h.requests).toContainEqual({ kind: "focusPage", tab: "a" }));
  expect(h.status()).toBe(t("Use the PDF toolbar for search and zoom."));
  expect(h.root.querySelector(".browser-find").hidden).toBe(true);
  expect(h.requests.some(request => request.kind === "findStart")).toBe(false);

  h.emit({ kind: "navigationStarted", tab: "a" });
  h.emit({ kind: "navigationFinished", tab: "a", success: true, documentRevision: "a:2" });
  h.emit({ kind: "pdfDocument", tab: "a", documentRevision: "a:1" });
  expect(h.status()).toBe("");
  h.root.querySelector(".browser-address").dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }));
  expect(h.root.querySelector(".browser-find").hidden).toBe(false);
});

it("settles the export status layout before printing and keeps tab activation responsive", async () => {
  const h = await mount();
  const preparing = t("Preparing page PDF…");
  HTMLElement.prototype.getBoundingClientRect.mockImplementation(() => ({
    x: 50, y: 80, width: 399, height: h.status() === preparing ? 576 : 600,
  }));
  const menu = h.root.querySelector(".browser-options");
  const save = [...menu.querySelectorAll("button")].find(button => button.textContent === t("Save page PDF to Downloads"));
  let finish;
  h.hooks.savePdf = () => new Promise((_, reject) => { finish = reject; });
  menu.open = true;
  save.click();
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(h.status()).toBe(preparing);
  const requestIndex = h.requests.findIndex(request => request.kind === "savePdf");
  expect(h.requests[requestIndex]).toEqual({ kind: "savePdf", tab: "a", expectedUrl: "https://example.org/a" });
  expect(h.requests.slice(0, requestIndex).filter(request => request.kind === "present").at(-1).bounds.height).toBe(576);
  h.select("b");
  await waitFor(() => expect(h.visible()).toBe("b"));
  finish(Error("Browser page changed"));
  await waitFor(() => expect(h.status()).toBe(t("Browser page changed")));
  expect(h.selected()).toBe("b");
});
it("opens developer tools only from the menu for the current visible browser tab", async () => {
  const h = await mount();
  const requests = () => h.requests.filter(request => request.kind === "openDeveloperTools");
  const menu = h.root.querySelector(".browser-options");
  const entry = menu.querySelector('[data-i18n-text="Developer tools"]');
  expect(entry).not.toBeNull();
  expect(requests()).toEqual([]);

  h.select("b");
  await waitFor(() => expect(h.visible()).toBe("b"));
  menu.open = true;
  entry.click();
  await waitFor(() => expect(requests()).toEqual([
    { kind: "openDeveloperTools", tab: "b", expectedUrl: "https://example.org/b", expectedDocumentRevision: "b:1" },
  ]));
  expect(menu.open).toBe(false);
  expect(h.visible()).toBe("b");
  expect(h.saved().activeTab).toBe("b");
});

it("uses the native document revision even when the tab reloads the same address", async () => {
  const h = await mount();
  const menu = h.root.querySelector(".browser-options");
  const entry = menu.querySelector('[data-i18n-text="Developer tools"]');
  const requests = () => h.requests.filter(request => request.kind === "openDeveloperTools");

  entry.click();
  await waitFor(() => expect(requests().map(r => r.expectedDocumentRevision)).toEqual(["a:1"]));
  h.emit({ kind: "navigationStarted", tab: "a" });
  entry.click();
  await app.finishWindowWrites();
  expect(requests()).toHaveLength(1);

  h.emit({ kind: "navigationFinished", tab: "a", success: true, documentRevision: "a:2" });
  entry.click();
  await waitFor(() => expect(requests().map(r => r.expectedDocumentRevision)).toEqual(["a:1", "a:2"]));
  expect(requests().map(r => r.expectedUrl)).toEqual(["https://example.org/a", "https://example.org/a"]);
});

it("uses the native document that finished loading during shell recovery", async () => {
  const h = await mount([], "restored:2");
  const entry = h.root.querySelector('.browser-options [data-i18n-text="Developer tools"]');
  entry.click();
  await waitFor(() => expect(h.requests).toContainEqual({
    kind: "openDeveloperTools", tab: "a", expectedUrl: "https://example.org/a", expectedDocumentRevision: "restored:2",
  }));
  expect(h.requests.some(r => r.kind === "create" && r.tabId === "a")).toBe(false);
});

it("discards developer tools actions while the browser surface is inactive", async () => {
  const h = await mount();
  const menu = h.root.querySelector(".browser-options");
  const entry = menu.querySelector('[data-i18n-text="Developer tools"]');
  h.root.setAttribute("inert", "");
  menu.open = true;
  entry.click();
  await app.canDeactivate();
  expect(h.requests.some(request => request.kind === "openDeveloperTools")).toBe(false);
});

it("does not retarget a queued developer tools action after switching tabs", async () => {
  const h = await mount();
  let completeSave;
  h.hooks.save = () => new Promise(resolve => { completeSave = resolve; });
  h.select("b");
  await waitFor(() => expect(completeSave).toBeTypeOf("function"));

  const menu = h.root.querySelector(".browser-options");
  menu.open = true;
  menu.querySelector('[data-i18n-text="Developer tools"]').click();
  completeSave();
  await waitFor(() => expect(h.visible()).toBe("b"));
  expect(h.requests.some(request => request.kind === "openDeveloperTools")).toBe(false);
});

it("drops a queued developer tools action after its tab navigates in place", async () => {
  const h = await mount();
  let finishNavigation;
  h.hooks.navigate = () => new Promise(resolve => { finishNavigation = resolve; });
  const address = h.root.querySelector(".browser-address");
  address.focus();
  address.value = "https://example.org/updated";
  address.dispatchEvent(new Event("input", { bubbles: true }));
  address.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => expect(finishNavigation).toBeTypeOf("function"));

  const menu = h.root.querySelector(".browser-options");
  menu.open = true;
  menu.querySelector('[data-i18n-text="Developer tools"]').click();
  finishNavigation();
  await app.finishWindowWrites();
  expect(h.saved().activeTab).toBe("a");
  expect(h.saved().tabs[0].url).toBe("https://example.org/updated");
  expect(h.requests.some(request => request.kind === "openDeveloperTools")).toBe(false);
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
