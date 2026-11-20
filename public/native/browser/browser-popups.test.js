import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import { setupBrowserApp } from "./browser-app.js";
import { createBrowserPopups, insertBrowserLinkedTab } from "./browser-popups.js";

const source = "00000000-0000-4000-8000-000000000001", peer = "00000000-0000-4000-8000-000000000002";
const requested = { kind: "popup", tab: source, url: "https://example.com/linked", userInitiated: true, allowed: true };
let app;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, width: 600, height: 400 });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => { await app?.canDeactivate(); app = null; document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete Element.prototype.scrollIntoView; });
async function mount({ onCreate = async () => {}, rejectSave = () => false } = {}) {
  let session = { revision: 0, activeTab: source, closedTabs: [], tabs: [source, peer].map(id => ({ id, url: "https://example.org/", title: id, zoom: 1, muted: false })) }, emit;
  const calls = [];
  const invoke = async (name, args) => {
    calls.push({ name, args });
    if (name === "browser_get_state") return { startupMode: "browser", session: structuredClone(session) };
    if (name === "browser_control") {
      if (args.request.kind === "status") return { surfaceRevision: 0, tabs: [] };
      if (args.request.kind === "create") await onCreate(args.request);
    }
    if (name === "browser_save_session") {
      if (rejectSave()) throw Error("Browser storage unavailable");
      session = { ...session, revision: session.revision + 1, tabs: args.tabs, activeTab: args.activeTab };
      return session;
    }
    return {};
  };
  app = setupBrowserApp({ invoke, listen: async (_name, callback) => { emit = payload => callback({ payload }); } });
  const root = document.createElement("main");document.body.append(root);app.renderContent(root);
  await waitFor(() => expect(calls.some(c => c.args?.request?.kind === "present")).toBe(true));
  return { emit, calls, root, state: () => structuredClone(session) };
}
it("opens a user link after its source, preserving the source and adjacent tab", async () => {
  const h = await mount(), original = h.state().tabs; h.emit(requested);
  await waitFor(() => expect(h.state().tabs).toHaveLength(3));
  expect(h.state().tabs[0]).toEqual(original[0]);expect(h.state().tabs[2]).toEqual(original[1]);
  expect(h.state().tabs[1].url).toBe(requested.url);expect(h.state().activeTab).toBe(h.state().tabs[1].id);
  expect(h.calls.some(c => c.args?.request?.kind === "navigate" && c.args.request.tab === source)).toBe(false);
});
it("loads a background link after its source without hiding or switching the foreground", async () => {
  const h = await mount(), original = h.state().tabs;
  const before = h.calls.length;
  h.emit({ ...requested, background: true });
  await waitFor(() => expect(h.state().tabs).toHaveLength(3));
  const [retained, child, adjacent] = h.state().tabs;
  expect(retained).toEqual(original[0]);
  expect(adjacent).toEqual(original[1]);
  expect(child.url).toBe(requested.url);
  expect(h.state().activeTab).toBe(source);
  const commands = h.calls.slice(before).map(call => call.args?.request?.kind);
  expect(commands).toContain("create");
  expect(commands).not.toContain("hide");
  expect(commands).not.toContain("present");
});
it("ignores inactive sources and blocks automatic or rejected requests", async () => {
  const h = await mount(); h.emit({ ...requested, tab: peer }); h.emit({ ...requested, userInitiated: false }); h.emit({ ...requested, allowed: false });
  await new Promise(resolve => setTimeout(resolve, 0));expect(h.state().tabs).toHaveLength(2);
  expect(h.calls.filter(c => c.args?.request?.kind === "create")).toHaveLength(1);
  expect(h.root.querySelector('[role="status"]').textContent).toBeTruthy();
});
it("closes a created child if storage fails and keeps the original session", async () => {
  let fail = false; const h = await mount({ rejectSave: () => fail }), original = h.state();fail = true;h.emit(requested);
  await waitFor(() => expect(h.calls.some(c => c.args?.request?.kind === "close")).toBe(true));
  expect(h.state()).toEqual(original);expect(h.root.querySelectorAll('[role="tab"]')).toHaveLength(2);
});
it("rechecks the source after asynchronous creation and rejects a late navigation", async () => {
  let release;const h = await mount({ onCreate: request => request.tabId === source ? undefined : new Promise(resolve => { release = resolve; }) });
  h.emit(requested);await waitFor(() => expect(release).toBeTypeOf("function"));
  h.emit({ kind: "loading", tab: source, url: "https://example.org/changed", finished: false });release();
  await waitFor(() => expect(h.calls.some(c => c.args?.request?.kind === "close")).toBe(true));expect(h.root.querySelectorAll('[role="tab"]')).toHaveLength(2);
});
it("deduplicates a pending source request and releases the guard after failure", async () => {
  let release;const open = vi.fn(() => new Promise((_resolve, reject) => { release = reject; }));
  const handle = createBrowserPopups({ currentSource: () => () => true, open, blocked: vi.fn() });
  const first = handle(requested);await handle(requested);expect(open).toHaveBeenCalledTimes(1);release(Error("failed"));await expect(first).rejects.toThrow("failed");
  open.mockResolvedValueOnce();await handle(requested);expect(open).toHaveBeenCalledTimes(2);
});
it("rejects insertion when the source no longer exists without mutating its input", () => {
  const tabs = [{ id: source }];expect(() => insertBrowserLinkedTab(tabs, peer, { id: "new" })).toThrow();expect(tabs).toEqual([{ id: source }]);
});

it("closes an attached login tab back to its opener without persisting it", async () => {
  const h = await mount(), original = h.state();
  const request = "44444444-4444-4444-8444-444444444444";
  h.emit({ ...requested, request });
  const selectedTab = () => h.root.querySelector('[role="tab"][aria-selected="true"]')?.closest('[data-browser-tab-id]')?.dataset.browserTabId;
  await waitFor(() => expect(h.root.querySelectorAll('[role="tab"]')).toHaveLength(3));
  const login = selectedTab();
  expect(login).not.toBe(source);
  expect(h.calls.some(call => call.args?.request?.tabId === login && call.args.request.popupRequest === request)).toBe(true);
  expect(h.state().tabs).toEqual(original.tabs);
  expect(h.state().activeTab).toBe(source);
  h.emit({ kind: "popupClosed", tab: peer });
  h.emit({ kind: "popupClosed", tab: login });
  await waitFor(() => expect(selectedTab()).toBe(source));
  expect(h.state().tabs).toEqual(original.tabs);
  expect(h.root.querySelectorAll('[role="tab"]')).toHaveLength(2);
});

it("releases a deferred popup from an inactive source without creating a view", async () => {
  const h = await mount(), request = "33333333-3333-4333-8333-333333333333";
  h.emit({ ...requested, tab: peer, request });
  await waitFor(() => expect(h.calls.some(call => call.args?.request?.kind === "cancelPopup" && call.args.request.request === request)).toBe(true));
  expect(h.calls.filter(call => call.args?.request?.kind === "create")).toHaveLength(1);
});
