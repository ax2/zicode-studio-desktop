import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, getByLabelText, getByRole, queryByRole, waitFor } from "@testing-library/dom";
import { t } from "../../i18n.js";
import { setupBrowserApp } from "./browser-app.js";

const methods = ["showModal", "close"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]);
const tab = { id: "current", url: "https://example.test/first", title: "Current" };
const bookmarks = { revision: 1, folders: [], bookmarks: [{ id: "one", title: "Saved", url: "https://example.test/saved", folderId: null }] };
const history = { entries: [], nextBefore: null, latestId: 0 };
const downloads = { entries: [], nextBefore: null, directory: "Downloads" };
let app;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, width: 900, height: 600 });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true, value() { this.open = true; },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() { if (this.open) { this.open = false; this.dispatchEvent(new Event("close")); } },
  });
});

afterEach(() => {
  app?.deactivate();
  app = undefined;
  for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const [name, descriptor] of methods) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else delete HTMLDialogElement.prototype[name];
  }
});

async function mount({
  readUrl = async () => ({ url: tab.url }),
  readPanel = async (_name, value) => value,
  takePreview = async () => "data:image/jpeg;base64,AA==",
} = {}) {
  const invoke = vi.fn(async (command, args) => {
    if (command === "browser_get_state") return { startupMode: "browser", session: { revision: 0, activeTab: tab.id, tabs: [tab] } };
    if (command === "browser_bookmarks") {
      return document.querySelector("dialog.browser-bookmarks-dialog[open]") ? readPanel("Bookmarks", bookmarks) : bookmarks;
    }
    if (command === "browser_history") return readPanel("Browsing history", history);
    const control = args?.request;
    if (control?.kind === "status") return { surfaceRevision: 0, tabs: [tab] };
    if (control?.kind === "url") return readUrl();
    if (control?.kind === "snapshot") return takePreview();
    if (control?.kind === "downloads") return readPanel("Downloads", downloads);
    return {};
  });
  const container = document.createElement("main");
  const next = document.createElement("button");
  next.textContent = "Notes";
  document.body.append(container, next);
  let emit;
  app = setupBrowserApp({ invoke, listen: async (_name, callback) => { emit = payload => callback({ payload }); } });
  app.renderContent(container);
  const didPresent = ([command, args]) => command === "browser_control" && args.request.kind === "present";
  await waitFor(() => expect(invoke.mock.calls.some(didPresent)).toBe(true));
  return {
    invoke, next,
    fromPage(action) { emit({ kind: "shortcut", action, tab: tab.id }); },
    open(name) {
      const menu = container.querySelector(".browser-options");
      menu.open = true;
      getByRole(menu, "button", { name: t(name) }).click();
    },
    async leave() {
      expect(await app.canDeactivate()).toBe(true);
      app.deactivate();
      next.focus();
    },
    async returnToBrowser() {
      const presents = invoke.mock.calls.filter(didPresent).length;
      app.renderContent(container);
      await waitFor(() => expect(invoke.mock.calls.filter(didPresent).length).toBeGreaterThan(presents));
    },
  };
}

const panel = name => getByRole(document.body, "dialog", { name: t(name) });

it("does not open an old Bookmarks request after leaving and reopening Browser", async () => {
  let reply;
  const readUrl = vi.fn().mockImplementationOnce(() => new Promise(resolve => { reply = resolve; })).mockResolvedValue({ url: tab.url });
  const readPanel = vi.fn(async (_name, value) => value);
  const h = await mount({ readUrl, readPanel });
  h.open("Bookmarks");
  await waitFor(() => expect(readUrl).toHaveBeenCalledOnce());
  await h.leave();
  await h.returnToBrowser();
  reply({ url: tab.url });
  await app.finishWindowWrites();
  expect(queryByRole(document.body, "dialog", { name: t("Bookmarks") })).toBeNull();
  expect(readPanel).not.toHaveBeenCalled();

  h.open("Bookmarks");
  const dialog = await waitFor(() => panel("Bookmarks"));
  await waitFor(() => expect(getByRole(dialog, "button", { name: `${t("Open bookmark")}: Saved` })).toBeTruthy());
  getByRole(dialog, "button", { name: t("Close") }).click();
  await waitFor(() => expect(dialog.isConnected).toBe(false));
});

it.each(["Bookmarks", "Browsing history", "Downloads"])("closes %s on switching applications even if its list is still loading", async name => {
  let reply;
  const readPanel = vi.fn()
    .mockImplementationOnce((_name, value) => new Promise(resolve => { reply = () => resolve(value); }))
    .mockImplementation(async (_name, value) => value);
  const h = await mount({ readPanel });
  h.open(name);
  const dialog = await waitFor(() => panel(name));
  await waitFor(() => expect(readPanel).toHaveBeenCalledOnce());
  await h.leave();
  expect(dialog.isConnected).toBe(false);
  reply();
  await app.finishWindowWrites();
  expect(document.activeElement).toBe(h.next);
  expect(h.invoke).not.toHaveBeenCalledWith("browser_control", { request: expect.objectContaining({ kind: "focusPage" }) });

  await h.returnToBrowser();
  h.open(name);
  const reopened = await waitFor(() => panel(name));
  expect(reopened).not.toBe(dialog);
  getByRole(reopened, "button", { name: t("Close") }).click();
  await waitFor(() => expect(reopened.isConnected).toBe(false));
});

it("keeps an unsaved bookmark draft when the user cancels the application switch", async () => {
  const h = await mount();
  h.open("Bookmarks");
  const dialog = await waitFor(() => panel("Bookmarks"));
  await waitFor(() => getByRole(dialog, "button", { name: `${t("Edit bookmark")}: Saved` })).then(button => button.click());
  const name = await waitFor(() => getByLabelText(dialog, t("Bookmark name")));
  fireEvent.input(name, { target: { value: "Unsaved local draft" } });

  const first = app.canDeactivate();
  const confirmation = await waitFor(() => panel("Discard bookmark edits?"));
  getByRole(confirmation, "button", { name: t("Keep editing") }).click();
  await expect(first).resolves.toBe(false);
  expect(dialog.isConnected).toBe(true);
  expect(name.value).toBe("Unsaved local draft");
  expect(document.activeElement).toBe(name);

  const second = app.canDeactivate();
  getByRole(await waitFor(() => panel("Discard bookmark edits?")), "button", { name: t("Discard changes") }).click();
  await expect(second).resolves.toBe(true);
  expect(dialog.isConnected).toBe(false);
});

it("restores the native tab for a normal keyboard dismissal only while Browser remains active", async () => {
  const h = await mount();
  const focusRequest = { request: { kind: "focusPage", tab: tab.id } };
  h.fromPage("history");
  const first = await waitFor(() => panel("Browsing history"));
  getByRole(first, "button", { name: t("Close") }).click();
  await waitFor(() => expect(h.invoke).toHaveBeenCalledWith("browser_control", focusRequest));
  const focusCalls = () => h.invoke.mock.calls.filter(([command, args]) =>
    command === "browser_control" && args.request.kind === "focusPage");
  expect(focusCalls()).toHaveLength(1);

  h.fromPage("history");
  await waitFor(() => panel("Browsing history"));
  await h.leave();
  expect(queryByRole(document.body, "dialog", { name: t("Browsing history") })).toBeNull();
  expect(focusCalls()).toHaveLength(1);
  expect(document.activeElement).toBe(h.next);
});

it.each(["Browsing history", "Downloads"])("drops a pending %s open before the old page preview returns", async name => {
  let reply;
  const takePreview = vi.fn(() => new Promise(resolve => { reply = resolve; }));
  const readPanel = vi.fn(async (_name, value) => value);
  const h = await mount({ readPanel, takePreview });
  h.open(name);
  await waitFor(() => expect(takePreview).toHaveBeenCalledOnce());
  await h.leave();
  await h.returnToBrowser();
  reply("data:image/jpeg;base64,AA==");
  await app.finishWindowWrites();
  expect(queryByRole(document.body, "dialog", { name: t(name) })).toBeNull();
  expect(readPanel).not.toHaveBeenCalled();
});

it.each(["menu", "page shortcut"])("drops a pending tab search from the %s after leaving and returning", async trigger => {
  let reply;
  const takePreview = vi.fn()
    .mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }))
    .mockResolvedValue("data:image/jpeg;base64,AA==");
  const h = await mount({ takePreview });
  const search = () => trigger === "menu" ? h.open("Search tabs") : h.fromPage("searchTabs");
  search();
  await waitFor(() => expect(takePreview).toHaveBeenCalledOnce());
  await h.leave();
  await h.returnToBrowser();
  const address = getByRole(document.body, "textbox", { name: t("Web address") });
  fireEvent.input(address, { target: { value: "unsent draft" } });
  address.focus();
  reply("data:image/jpeg;base64,AA==");
  await app.finishWindowWrites();
  expect(queryByRole(document.body, "dialog", { name: t("Search tabs") })).toBeNull();
  expect(document.activeElement).toBe(address);
  expect(address.value).toBe("unsent draft");
  expect(h.invoke).not.toHaveBeenCalledWith("browser_control", { request: expect.objectContaining({ kind: "focusPage" }) });

  search();
  const fresh = await waitFor(() => panel("Search tabs"));
  expect(document.activeElement).toBe(getByRole(fresh, "searchbox"));
  getByRole(fresh, "button", { name: t("Close") }).click();
  await waitFor(() => expect(fresh.isConnected).toBe(false));
});

it.each(["menu", "page shortcut"])("drops the %s tab search queued before leaving Browser", async trigger => {
  let reply;
  const readUrl = vi.fn().mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }))
    .mockResolvedValue({ url: tab.url });
  const h = await mount({ readUrl });
  h.open("Bookmarks");
  await waitFor(() => expect(readUrl).toHaveBeenCalledOnce());
  if (trigger === "menu") h.open("Search tabs");
  else h.fromPage("searchTabs");

  await h.leave();
  await h.returnToBrowser();
  const address = getByRole(document.body, "textbox", { name: t("Web address") });
  fireEvent.input(address, { target: { value: "still editing" } });
  address.focus();
  reply({ url: tab.url });
  await app.finishWindowWrites();
  expect(queryByRole(document.body, "dialog", { name: t("Search tabs") })).toBeNull();
  expect(document.activeElement).toBe(address);
  expect(address.value).toBe("still editing");

  h.open("Search tabs");
  const fresh = await waitFor(() => panel("Search tabs"));
  expect(document.activeElement).toBe(getByRole(fresh, "searchbox"));
});
