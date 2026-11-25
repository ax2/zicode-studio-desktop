import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, getByRole, queryByRole, waitFor, within } from "@testing-library/dom";
import { getLocale, setLocale } from "../../i18n.js";
import { navigateToBrowserSource } from "../features/browser-source-navigation.js";
import { setupBrowserApp } from "./browser-app.js";

const locale = getLocale();
const page = { id: "article", title: "Current article", url: "https://example.invalid/article" };
const blank = { id: "new", title: "New tab", url: "about:blank" };
const marked = { id: "known", title: "Research notes", url: "https://research.invalid/reference", shortcut: true };
const ordinary = { id: "ordinary", title: "Regular bookmark", url: "https://other.invalid/" };
let app;
const dialogMethods = ["showModal", "close"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]);
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; this.dispatchEvent(new Event("close")); } });
});

afterEach(async () => {
  await app?.canDeactivate();
  app = undefined;
  document.body.replaceChildren();
  setLocale(locale);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const [name, descriptor] of dialogMethods) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else delete HTMLDialogElement.prototype[name];
  }
});

function setup({ tabs = [page], active = tabs[0].id, privateWindow = false, list, save, hide, present, stateError } = {}) {
  setLocale("en");
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 20, y: 50, width: 900, height: 580 });
  const host = document.createElement("main");
  document.body.append(host);
  let revision = 0;
  const requests = vi.fn(async (command, args) => {
    if (command === "browser_get_state") {
      if (stateError) throw stateError;
      return { startupMode: "browser", private: privateWindow, session: { activeTab: active, revision, tabs: structuredClone(tabs) } };
    }
    if (command === "browser_save_session") return { revision: ++revision };
    if (command === "browser_bookmarks") {
      if (args.request.kind === "save") return save?.(args.request);
      return list ? list() : { bookmarks: [marked, ordinary], folders: [] };
    }
    if (args?.request?.kind === "url") return { url: tabs.find(tab => tab.id === args.request.tab)?.url ?? "about:blank" };
    if (args?.request?.kind === "status") return { surfaceRevision: 0, tabs: structuredClone(tabs) };
    if (args?.request?.kind === "snapshot") return "data:image/jpeg;base64,AA==";
    if (args?.request?.kind === "present" && present) return present(args.request.tab);
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

it("routes a saved note source to a fresh browser tab without replacing the current page", async () => {
  const { host, requests, calls } = setup();
  const source = "https://saved.invalid/article?lang=zh#section";
  let active = false;
  await navigateToBrowserSource(source, {
    scope: { workspaceId: "workspace", isCurrent: () => true },
    activate: async () => { active = true; },
    isActive: () => active,
    open: (url, current) => app.openSource(url, current),
  });
  const selected = getByRole(host, "tab", { selected: true });
  const tabId = selected.closest("[data-browser-tab-id]").dataset.browserTabId;
  expect(tabId).not.toBe(page.id);
  expect(calls("create")).toContainEqual(expect.objectContaining({ tabId, url: source }));
  expect(calls("present").at(-1)?.tab).toBe(tabId);
  expect(requests).toHaveBeenCalledWith("browser_save_session", expect.objectContaining({
    activeTab: tabId, tabs: [expect.objectContaining(page), expect.objectContaining({ id: tabId, url: source })],
  }));
});

it("keeps saved browser tabs when a note link is opened but the session cannot restore", async () => {
  const { requests, calls } = setup({ stateError: new Error("state unavailable") });
  await expect(app.openSource("https://saved.invalid/", () => true)).rejects.toThrow("Could not restore the browser");
  expect(calls("create")).toHaveLength(0);
  expect(requests.mock.calls.some(([command]) => command === "browser_save_session")).toBe(false);
});

it.each(["notes blocks leaving", "workspace changes"])("does not open a note URL when %s", async (reason) => {
  let current = true;
  const open = vi.fn();
  const activate = vi.fn(async () => { if (reason === "workspace changes") current = false; });
  await navigateToBrowserSource("https://saved.invalid/", {
    scope: { workspaceId: "workspace", isCurrent: () => current },
    activate, isActive: () => reason !== "notes blocks leaving", open,
  });
  expect(activate).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
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
  const menu = host.querySelector(".browser-options");
  menu.open = true;
  fireEvent(menu, new Event("toggle"));
  expect(list).not.toHaveBeenCalled();
  expect(within(menu).queryByRole("button", { name: "Add website shortcut" })).toBeNull();
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

it.each([false, true])("waits for native presentation before capturing an overlay (dismissed: %s)", async dismissed => {
  const second = { id: "second", title: "Other article", url: "https://example.invalid/other" };
  let finishPresent;
  const { host, calls } = setup({
    tabs: [page, second],
    present: id => id === second.id && !finishPresent
      ? new Promise(resolve => { finishPresent = resolve; }) : undefined,
  });
  await waitFor(() => expect(calls("present").at(-1)?.tab).toBe(page.id));
  getByRole(host, "tab", { name: second.title }).click();
  await waitFor(() => expect(finishPresent).toBeTypeOf("function"));

  const menu = document.createElement("details");
  menu.className = "quick-tools-menu";
  menu.getClientRects = () => [{ width: 150, height: 220 }];
  document.body.append(menu);
  menu.open = true;
  await new Promise(resolve => setTimeout(resolve, 0));

  const earlyCapture = calls("snapshot");
  if (dismissed) menu.open = false;
  finishPresent();
  expect(earlyCapture).toHaveLength(0);
  if (dismissed) {
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(calls("snapshot")).toHaveLength(0);
    expect(calls("hide")).toHaveLength(0);
    expect(calls("present").map(entry => entry.tab)).toEqual([page.id, second.id]);
  } else {
    await waitFor(() => expect(calls("hide")).toHaveLength(1));
    expect(calls("snapshot").map(entry => entry.tab)).toEqual([second.id]);
    expect(host.querySelector(".browser-overlay-preview")?.dataset.tab).toBe(second.id);
  }
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


it("can mark the active page as a shortcut directly from the menu without duplicating a bookmark", async () => {
  const expected = { ...ordinary, url: page.url, folderId: "folder" };
  const library = { revision: 12, folders: [{ id: "folder", title: "Research", parentId: null }], bookmarks: [expected, marked] };
  const save = vi.fn(async request => ({ ...library, revision: 13, folders: request.folders, bookmarks: request.bookmarks }));
  const { host, calls } = setup({ list: async () => library, save });
  await waitFor(() => expect(calls("present").at(-1)?.tab).toBe(page.id));
  const menu = host.querySelector(".browser-options");
  menu.open = true;
  fireEvent(menu, new Event("toggle"));
  (await within(menu).findByRole("button", { name: "Add website shortcut" })).click();
  const dialog = await waitFor(() => getByRole(document.body, "dialog", { name: "Bookmarks" }));
  const form = await within(dialog).findByRole("form", { name: "Bookmark editor" });
  expect(within(form).getByLabelText("Bookmark name").value).toBe(expected.title);
  expect(within(form).getByLabelText("Bookmark URL").value).toBe(page.url);
  expect(within(form).getByRole("checkbox", { name: "Show in website shortcuts" }).checked).toBe(true);
  expect(save).not.toHaveBeenCalled();
  const submit = within(form).getByRole("button", { name: "Save" });
  await waitFor(() => expect(submit.matches(":disabled")).toBe(false));
  submit.click();
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toEqual({
    kind: "save", expectedRevision: 12, folders: library.folders,
    bookmarks: [{ ...expected, shortcut: true }, marked],
  });
  await waitFor(() => expect(within(dialog).queryByRole("form", { name: "Bookmark editor" })).toBeNull());
  within(dialog).getByRole("button", { name: "Close" }).click();
  await waitFor(() => expect(document.activeElement).toBe(menu.querySelector("summary")));
  expect(calls("navigate")).toHaveLength(0);
});

it("can add the first shortcut from a blank tab menu and then add another from the new-tab list", async () => {
  let library = { revision: 0, folders: [], bookmarks: [] };
  const save = vi.fn(async request => library = { revision: 1, folders: request.folders, bookmarks: request.bookmarks });
  const { host, calls } = setup({ tabs: [blank], list: async () => library, save });
  await waitFor(() => expect(calls("present").at(-1)?.tab).toBe(blank.id));
  const menu = host.querySelector(".browser-options");
  menu.open = true;
  fireEvent(menu, new Event("toggle"));
  (await within(menu).findByRole("button", { name: "Add website shortcut" })).click();
  const dialog = await waitFor(() => getByRole(document.body, "dialog", { name: "Bookmarks" }));
  const form = await within(dialog).findByRole("form", { name: "Bookmark editor" });
  expect(within(form).getByRole("checkbox", { name: "Show in website shortcuts" }).checked).toBe(true);
  expect(save).not.toHaveBeenCalled();
  fireEvent.input(within(form).getByLabelText("Bookmark name"), { target: { value: "New shortcut" } });
  fireEvent.input(within(form).getByLabelText("Bookmark URL"), { target: { value: "https://first.invalid/" } });
  const submit = within(form).getByRole("button", { name: "Save" });
  await waitFor(() => expect(submit.matches(":disabled")).toBe(false));
  submit.click();
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  await waitFor(() => expect(within(dialog).queryByRole("form", { name: "Bookmark editor" })).toBeNull());
  within(dialog).getByRole("button", { name: "Close" }).click();
  const panel = await waitFor(() => getByRole(host, "region", { name: "Website shortcuts" }));
  expect(within(panel).getByRole("button", { name: /New shortcut/ })).toBeTruthy();
  within(panel).getByRole("button", { name: "Add website shortcut" }).click();
  const second = await waitFor(() => getByRole(document.body, "dialog", { name: "Bookmarks" }));
  expect((await within(second).findByRole("checkbox", { name: "Show in website shortcuts" })).checked).toBe(true);
  within(second).getByRole("button", { name: "Close" }).click();
  await waitFor(() => expect(document.activeElement).toBe(host.querySelector(".browser-address")));
  expect(save).toHaveBeenCalledOnce();
  expect(calls("navigate")).toHaveLength(0);
});
