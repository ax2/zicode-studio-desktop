import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, getByRole, queryByRole, waitFor, within } from "@testing-library/dom";
import { getLocale, setLocale } from "../../i18n.js";
import { setupBrowserApp } from "./browser-app.js";

const locale = getLocale();
const page = { id: "article", title: "Current article", url: "https://example.invalid/article" };
const blank = { id: "new", title: "New tab", url: "about:blank" };
const marked = { id: "known", title: "Research notes", url: "https://research.invalid/reference", shortcut: true };
const ordinary = { id: "ordinary", title: "Regular bookmark", url: "https://other.invalid/" };
let app;

afterEach(async () => {
  await app?.canDeactivate();
  app = undefined;
  document.body.replaceChildren();
  setLocale(locale);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup({ tabs = [page], active = tabs[0].id, privateWindow = false, list, hide } = {}) {
  setLocale("en");
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 20, y: 50, width: 900, height: 580 });
  const host = document.createElement("main");
  document.body.append(host);
  let revision = 0;
  const requests = vi.fn(async (command, args) => {
    if (command === "browser_get_state") return {
      startupMode: "browser", private: privateWindow, session: { activeTab: active, revision, tabs: structuredClone(tabs) },
    };
    if (command === "browser_save_session") return { revision: ++revision };
    if (command === "browser_bookmarks") return list ? list() : { bookmarks: [marked, ordinary], folders: [] };
    if (args?.request?.kind === "status") return { surfaceRevision: 0, tabs: structuredClone(tabs) };
    if (args?.request?.kind === "snapshot") return "data:image/jpeg;base64,AA==";
    if (args?.request?.kind === "hide" && hide) return hide();
    return {};
  });
  app = setupBrowserApp({ invoke: requests });
  app.renderContent(host);
  const calls = kind => requests.mock.calls
    .filter(([command, args]) => command === "browser_control" && args?.request?.kind === kind)
    .map(([, args]) => args.request);
  return { host, requests, calls };
}

it("opens a marked website in the current new tab and retains the other open page", async () => {
  const { host, requests, calls } = setup();
  await waitFor(() => expect(calls("present").at(-1)?.tab).toBe(page.id));
  fireEvent.keyDown(document, { key: "t", ctrlKey: true });
  const panel = await waitFor(() => getByRole(host, "region", { name: "Website shortcuts" }));
  const tile = within(panel).getByRole("button", { name: /Research notes/ });
  expect(queryByRole(panel, "button", { name: /Regular bookmark/ })).toBeNull();
  expect(tile.textContent).toContain("research.invalid");
  const address = host.querySelector(".browser-address");
  expect(document.activeElement).toBe(address);
  expect(address.value).toBe("");
  expect(calls("hide")).toHaveLength(1);
  expect(calls("navigate")).toHaveLength(0);
  const newId = getByRole(host, "tab", { selected: true }).closest("[data-browser-tab-id]").dataset.browserTabId;
  tile.click();
  await waitFor(() => expect(calls("navigate")).toEqual([{ kind: "navigate", tab: newId, url: marked.url }]));
  await waitFor(() => expect(calls("present").at(-1)?.tab).toBe(newId));
  expect(getByRole(host, "tab", { name: page.title })).toBeTruthy();
  expect(host.querySelector(".browser-new-tab-shortcuts")).toBeNull();
  expect(address.value).toBe(marked.url);
  expect(requests).toHaveBeenCalledWith("browser_save_session", expect.objectContaining({
    activeTab: newId, tabs: [
      expect.objectContaining({ id: page.id, url: page.url }),
      expect.objectContaining({ id: newId, url: marked.url }),
    ],
  }));
});

it("drops a restored blank tab's pending list after selecting an existing page", async () => {
  let resolve;
  const list = vi.fn(() => new Promise(done => { resolve = done; }));
  const { host, calls } = setup({ tabs: [blank, page], list });
  await waitFor(() => expect(list).toHaveBeenCalledOnce());
  getByRole(host, "tab", { name: page.title }).click();
  await waitFor(() => expect(calls("present").at(-1)?.tab).toBe(page.id));
  resolve({ bookmarks: [marked], folders: [] });
  await Promise.resolve();
  await Promise.resolve();
  expect(host.querySelector(".browser-new-tab-shortcuts")).toBeNull();
  expect(calls("present").at(-1)?.tab).toBe(page.id);
  expect(calls("navigate")).toHaveLength(0);
});

it("keeps private blank tabs free of library lookups", async () => {
  const list = vi.fn(async () => ({ bookmarks: [marked], folders: [] }));
  const { host, calls } = setup({ tabs: [blank], privateWindow: true, list });
  await waitFor(() => expect(calls("present").at(-1)?.tab).toBe(blank.id));
  expect(list).not.toHaveBeenCalled();
  expect(host.querySelector(".browser-new-tab-shortcuts")).toBeNull();
});

it("returns to a normal blank page when there are no marked sites or the library fails", async () => {
  const list = vi.fn()
    .mockResolvedValueOnce({ bookmarks: [ordinary], folders: [] })
    .mockRejectedValueOnce(new Error("Library unavailable"));
  const { host, calls } = setup({ tabs: [blank], list });
  await waitFor(() => expect(calls("present").at(-1)?.tab).toBe(blank.id));
  expect(host.querySelector(".browser-new-tab-shortcuts")).toBeNull();
  fireEvent.keyDown(document, { key: "t", ctrlKey: true });
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(calls("present").at(-1)?.tab).not.toBe(blank.id));
  expect(host.querySelector(".browser-new-tab-shortcuts")).toBeNull();
  expect(host.querySelector(".browser-address").value).toBe("");
});

it("clears a temporary native blank-page preview when shortcuts become available under a menu", async () => {
  let resolve;
  const list = vi.fn(() => new Promise(done => { resolve = done; }));
  const { host, calls } = setup({ tabs: [blank], list });
  await waitFor(() => expect(calls("present").at(-1)?.tab).toBe(blank.id));
  const menu = document.createElement("details");
  menu.className = "quick-tools-menu";
  menu.getClientRects = () => [{ width: 150, height: 220 }];
  document.body.append(menu);
  menu.open = true;
  await waitFor(() => expect(calls("hide")).toHaveLength(1));
  expect(host.querySelector(".browser-overlay-preview")).toBeTruthy();

  resolve({ bookmarks: [marked], folders: [] });
  menu.open = false;
  await waitFor(() => getByRole(host, "region", { name: "Website shortcuts" }));
  expect(host.querySelector(".browser-overlay-preview")).toBeNull();
  expect(calls("navigate")).toHaveLength(0);
});

it("waits for a restored native blank view to hide before exposing shortcut buttons", async () => {
  let finishHide;
  const hide = vi.fn().mockResolvedValue({}).mockImplementationOnce(() => new Promise(resolve => { finishHide = resolve; }));
  const { host } = setup({ tabs: [{ ...blank, visible: true }], hide });
  await waitFor(() => expect(hide).toHaveBeenCalledOnce());
  expect(host.querySelector(".browser-new-tab-shortcuts")).toBeNull();
  finishHide({});
  await waitFor(() => getByRole(host, "region", { name: "Website shortcuts" }));
  expect(hide).toHaveBeenCalledOnce();
});
