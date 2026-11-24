import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getByRole, queryByRole, waitFor } from "@testing-library/dom";
import { getLocale, setLocale } from "../../i18n.js";
import { setupBrowserApp } from "./browser-app.js";

const dialogMethods = ["showModal", "close"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]);
const tab = { id: "article", url: "https://example.invalid/article", title: "Article" };
let app, locale;
beforeEach(() => {
  locale = getLocale();
  setLocale("en");
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, width: 900, height: 580 });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true, value() { this.open = true; },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() { this.open = false; this.dispatchEvent(new Event("close")); },
  });
});
afterEach(async () => {
  await app?.canDeactivate();
  app = undefined;
  for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const [name, descriptor] of dialogMethods) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else delete HTMLDialogElement.prototype[name];
  }
  setLocale(locale);
});

async function setup() {
  let emit, documentRevision = "1";
  const page = { url: tab.url, title: tab.title, blocks: [{ kind: "paragraph", text: "Synthetic article" }] };
  const present = vi.fn(async () => {});
  const invoke = vi.fn(async (command, args) => {
    if (command === "browser_get_state") return { startupMode: "browser", session: { revision: 0, activeTab: tab.id, tabs: [tab] } };
    if (command === "browser_read_article") return { tab: tab.id, documentRevision, page };
    if (args?.request?.kind === "status") return { surfaceRevision: 0, tabs: [{ ...tab, documentRevision }] };
    if (args?.request?.kind === "snapshot") return "data:image/jpeg;base64,AA==";
    if (args?.request?.kind === "present") return present();
    return { revision: 1 };
  });
  app = setupBrowserApp({ invoke, listen: async (_name, callback) => { emit = payload => callback({ payload }); } });
  const root = document.createElement("main");
  document.body.append(root);
  app.renderContent(root);
  await waitFor(() => expect(present).toHaveBeenCalled());
  const menu = root.querySelector(".browser-options");
  const trigger = menu.querySelector("summary");
  const findReader = () => waitFor(() => getByRole(document.body, "dialog", { name: "Reading mode" }));
  return {
    invoke, present, trigger, address: root.querySelector(".browser-address"),
    openFromMenu() {
      trigger.focus();
      menu.open = true;
      getByRole(menu, "button", { name: "Reading mode" }).click();
      return findReader();
    },
    openFromPage() {
      emit({ kind: "contextAction", action: "reader", tab: tab.id });
      return findReader();
    },
    reloadSameUrl() {
      emit({ kind: "navigationStarted", tab: tab.id });
      documentRevision = "2";
      emit({ kind: "navigationFinished", tab: tab.id, documentRevision, success: true });
    },
  };
}

function scrollArticle(dialog, scrollTop) {
  let position = 0;
  const region = getByRole(dialog, "region", { name: "Page content" });
  // A closed dialog has no layout, so read the real position before closing.
  Object.defineProperty(region, "scrollTop", {
    get: () => dialog.open ? position : 0,
    set: value => { position = value; },
  });
  region.scrollTop = scrollTop;
  getByRole(dialog, "button", { name: "Larger reading text" }).click();
  return region;
}

const focusPage = { request: { kind: "focusPage", tab: tab.id } };
const closeFromButton = dialog => getByRole(dialog, "button", { name: "Close" }).click();
function closeViaEscape(dialog) {
  if (dialog.dispatchEvent(new Event("cancel", { cancelable: true }))) dialog.close();
}

it("restores reading position and text size for the same page and returns focus to the browser menu", async () => {
  const h = await setup();
  const dialog = await h.openFromMenu();
  const region = scrollArticle(dialog, 240);
  expect(document.activeElement).toBe(region);
  closeFromButton(dialog);
  await waitFor(() => expect(document.activeElement).toBe(h.trigger));
  expect(h.invoke).not.toHaveBeenCalledWith("browser_control", focusPage);

  const reopened = await h.openFromMenu();
  expect(reopened.dataset.readerSize).toBe("2");
  expect(getByRole(reopened, "region").scrollTop).toBe(240);
  expect(h.invoke).toHaveBeenCalledWith("browser_read_article", { tab: tab.id, expectedUrl: tab.url });
  expect(h.invoke).not.toHaveBeenCalledWith("browser_control", { request: expect.objectContaining({ kind: "navigate" }) });
});

it("restores the native page after Escape and resets position when the same address reloads", async () => {
  const h = await setup();
  const dialog = await h.openFromPage();
  scrollArticle(dialog, 392);
  closeViaEscape(dialog);
  await waitFor(() => expect(h.invoke).toHaveBeenCalledWith("browser_control", focusPage));

  const samePage = await h.openFromPage();
  expect(getByRole(samePage, "region").scrollTop).toBe(392);
  expect(samePage.dataset.readerSize).toBe("2");
  closeViaEscape(samePage);
  await waitFor(() => expect(h.invoke.mock.calls.filter(([, args]) => args?.request?.kind === "focusPage")).toHaveLength(2));

  h.reloadSameUrl();
  const newPage = await h.openFromPage();
  expect(getByRole(newPage, "region").scrollTop).toBe(0);
  expect(newPage.dataset.readerSize).toBe("1");
});

it("keeps new chrome focus while the webview is still being presented", async () => {
  const h = await setup();
  const dialog = await h.openFromMenu();
  let release, completed;
  h.present.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }).then(() => { completed = true; }));
  closeFromButton(dialog);
  expect(queryByRole(document.body, "dialog", { name: "Reading mode" })).toBeNull();
  await waitFor(() => expect(release).toBeTypeOf("function"));
  h.address.focus();
  release();
  await waitFor(() => expect(completed).toBe(true));
  expect(document.activeElement).toBe(h.address);
  expect(h.invoke).not.toHaveBeenCalledWith("browser_control", focusPage);
});
