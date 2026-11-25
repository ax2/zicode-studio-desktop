import { getByRole, queryByRole, waitFor } from "@testing-library/dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getLocale, setLocale } from "../../i18n.js";
import { setupBrowserApp } from "./browser-app.js";

const dialogMethods = ["showModal", "close"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]);
const tab = { id: "article", url: "https://example.invalid/article", title: "Article" };
const caretMethod = Object.getOwnPropertyDescriptor(document, "caretPositionFromPoint");
let app, locale, observers;
beforeEach(() => {
  locale = getLocale();
  setLocale("en");
  observers = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback) { this.resize = callback; }
    observe(target) { observers.push({ target, resize: this.resize, disconnect: this.disconnect }); }
    disconnect = vi.fn();
  });
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
  if (caretMethod) Object.defineProperty(document, "caretPositionFromPoint", caretMethod);
  else delete document.caretPositionFromPoint;
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
  const snapshot = vi.fn(async () => "data:image/jpeg;base64,AA==");
  const readArticle = vi.fn(async () => ({ tab: tab.id, documentRevision, page }));
  const invoke = vi.fn(async (command, args) => {
    if (command === "browser_get_state") return { startupMode: "browser", session: { revision: 0, activeTab: tab.id, tabs: [tab] } };
    if (command === "browser_read_article") return readArticle();
    if (args?.request?.kind === "status") return { surfaceRevision: 0, tabs: [{ ...tab, documentRevision }] };
    if (args?.request?.kind === "snapshot") return snapshot();
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
  const requestFromMenu = () => {
    trigger.focus();
    menu.open = true;
    getByRole(menu, "button", { name: "Reading mode" }).click();
  };
  const requestFromPage = () => emit({ kind: "contextAction", action: "reader", tab: tab.id });
  return {
    invoke, present, snapshot, trigger, address: root.querySelector(".browser-address"), readArticle, requestFromMenu, requestFromPage,
    render: () => app.renderContent(root),
    openFromMenu() {
      requestFromMenu();
      return findReader();
    },
    openFromPage() {
      requestFromPage();
      return findReader();
    },
    replaceArticleText(text) { page.blocks[0].text = text; },
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

it("keeps the current reading block and focus through font-size changes", async () => {
  const h = await setup();
  const dialog = await h.openFromMenu();
  const region = getByRole(dialog, "region", { name: "Page content" });
  const paragraph = region.querySelector("article > p:last-child");
  const larger = getByRole(dialog, "button", { name: "Larger reading text" });
  const smaller = getByRole(dialog, "button", { name: "Smaller reading text" });
  const layout = {
    "0": { start: 60, height: 30 }, "1": { start: 90, height: 40 },
    "2": { start: 120, height: 60 }, "3": { start: 170, height: 90 },
  };
  region.getBoundingClientRect = () => ({ top: 80 });
  paragraph.getBoundingClientRect = () => {
    const { start, height } = layout[dialog.dataset.readerSize];
    const top = 80 + start - region.scrollTop;
    return { top, height, bottom: top + height };
  };
  region.scrollTop = 100;

  larger.focus();
  larger.click();
  expect(region.scrollTop).toBe(135);
  larger.click();
  expect(region.scrollTop).toBe(192.5);
  expect(larger.getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(larger);
  larger.click();
  expect(region.scrollTop).toBe(192.5);

  smaller.focus();
  smaller.click();
  expect(region.scrollTop).toBe(135);
  smaller.click();
  expect(region.scrollTop).toBe(100);
  smaller.click();
  expect(region.scrollTop).toBe(67.5);
  expect(smaller.getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(smaller);
  smaller.click();
  expect(region.scrollTop).toBe(67.5);
});

it("keeps the visible text line when the font wraps a long paragraph differently", async () => {
  const h = await setup();
  h.replaceArticleText("Long article with different words and line lengths. ".repeat(18));
  const dialog = await h.openFromMenu();
  const region = getByRole(dialog, "region", { name: "Page content" });
  const paragraph = region.querySelector("article > p:last-child");
  region.getBoundingClientRect = () => ({ top: 80 });
  paragraph.getBoundingClientRect = () => {
    const larger = dialog.dataset.readerSize === "2";
    const top = 80 + (larger ? 70 : 50) - region.scrollTop;
    const height = larger ? 560 : 400;
    return { left: 0, top, height, bottom: top + height };
  };
  const text = paragraph.firstChild;
  Object.defineProperty(document, "caretPositionFromPoint", {
    configurable: true, value: () => ({ offsetNode: text, offset: 112 }),
  });
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, "createRange").mockImplementation(() => {
    const range = createRange();
    range.getBoundingClientRect = () => ({
      top: 80 + (dialog.dataset.readerSize === "2" ? 209 : 161) - region.scrollTop,
      height: 28,
    });
    return range;
  });
  region.scrollTop = 150;

  getByRole(dialog, "button", { name: "Larger reading text" }).click();
  expect(region.scrollTop).toBe(198);
  getByRole(dialog, "button", { name: "Smaller reading text" }).click();
  expect(region.scrollTop).toBe(150);
});

it("anchors width changes to the visible line and follows subsequent user scrolling", async () => {
  let width = 890;
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(() => width);
  const h = await setup();
  const dialog = await h.openFromMenu();
  const region = getByRole(dialog, "region", { name: "Page content" });
  const paragraph = region.querySelector("article > p:last-child");
  const observer = observers.find(entry => entry.target === region);
  const bounds = () => ({ top: 80, left: 0, height: 500, bottom: 580 });
  region.getBoundingClientRect = bounds;
  paragraph.getBoundingClientRect = bounds;

  const caret = vi.fn(() => ({ offsetNode: paragraph.firstChild, offset: 0 }));
  Object.defineProperty(document, "caretPositionFromPoint", { configurable: true, value: caret });
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, "createRange").mockImplementation(() => {
    const range = createRange();
    range.getBoundingClientRect = () => ({
      height: 28,
      top: 80 + (width === 890 ? 159 : 318) + range.startOffset * 18 - region.scrollTop,
    });
    return range;
  });
  function userScroll(top) {
    region.scrollTop = top;
    region.dispatchEvent(new Event("scroll"));
  }

  userScroll(150);
  width = 398;
  observer.resize();
  expect(region.scrollTop).toBe(309);
  region.dispatchEvent(new Event("scroll")); // The resize adjustment leaves the original anchor in place.
  observer.resize();
  expect(caret).toHaveBeenCalledTimes(1);
  width = 890;
  observer.resize();
  expect(region.scrollTop).toBe(150);

  caret.mockReturnValue({ offsetNode: paragraph.firstChild, offset: 5 });
  userScroll(200);
  width = 398;
  observer.resize();
  expect(region.scrollTop).toBe(359);
  closeFromButton(dialog);
  expect(observer.disconnect).toHaveBeenCalledOnce();
});

it("restores the same document after resizing while reading mode is closed", async () => {
  let width = 890;
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function () {
    if (this.matches(".browser-reader-scroll, .browser-reader-scroll article > p:last-child")) {
      return { top: 80, left: 0, height: 500, bottom: 580 };
    }
    return { x: 0, y: 0, width: 900, height: 580 };
  });
  Object.defineProperty(document, "caretPositionFromPoint", {
    configurable: true,
    value: () => ({
      offsetNode: document.querySelector(".browser-reader-scroll article > p:last-child").firstChild,
      offset: 7,
    }),
  });
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, "createRange").mockImplementation(() => {
    const range = createRange();
    range.getBoundingClientRect = () => {
      const region = range.startContainer.parentElement.closest(".browser-reader-scroll");
      return { height: 28, top: 80 + (width === 890 ? 159 : 318) + range.startOffset * 18 - region.scrollTop };
    };
    return range;
  });
  const h = await setup();
  const original = await h.openFromMenu();
  getByRole(original, "button", { name: "Larger reading text" }).click();
  getByRole(original, "region").scrollTop = 150;
  closeViaEscape(original); // The preceding scroll has not delivered its event yet.

  width = 398;
  const narrow = await h.openFromMenu();
  expect(getByRole(narrow, "region").scrollTop).toBe(309);
  expect(narrow.dataset.readerSize).toBe("2");
  closeFromButton(narrow);

  width = 890;
  const wide = await h.openFromMenu();
  expect(getByRole(wide, "region").scrollTop).toBe(150);
  closeFromButton(wide);

  h.replaceArticleText("The same document updated this paragraph.");
  width = 398;
  const updated = await h.openFromMenu();
  expect(getByRole(updated, "region").scrollTop).toBe(150);
  closeFromButton(updated);
  h.reloadSameUrl();
  const replacement = await h.openFromMenu();
  expect(getByRole(replacement, "region").scrollTop).toBe(0);
  expect(replacement.dataset.readerSize).toBe("1");
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

it("closes an active reader when leaving Browser and retains the final reading position", async () => {
  const h = await setup();
  const dialog = await h.openFromMenu();
  const region = scrollArticle(dialog, 390);
  region.scrollTop = 424; // No scroll event has been dispatched yet.
  await app.canDeactivate();
  expect(queryByRole(document.body, "dialog", { name: "Reading mode" })).toBeNull();
  h.render();
  h.address.focus();
  await app.finishWindowWrites();
  expect(document.activeElement).toBe(h.address);
  expect(h.invoke).not.toHaveBeenCalledWith("browser_control", focusPage);
  const reopened = await h.openFromMenu();
  expect(getByRole(reopened, "region").scrollTop).toBe(424);
  expect(reopened.dataset.readerSize).toBe("2");
});

it.each(["success", "failure"])("ignores a late %s after leaving and returning to Browser", async (outcome) => {
  const h = await setup();
  let settle;
  const article = await h.readArticle();
  h.readArticle.mockImplementationOnce(() => new Promise((resolve, reject) => { settle = [resolve, reject]; }));
  h.requestFromMenu();
  await waitFor(() => expect(settle).toBeDefined());
  try {
    await app.canDeactivate();
    h.render();
    h.address.focus();
  } finally {
    if (outcome === "success") settle[0](article);
    else settle[1](Error("Obsolete extraction failed"));
  }
  await app.finishWindowWrites();
  expect(queryByRole(document.body, "dialog", { name: "Reading mode" })).toBeNull();
  expect(document.body.textContent).not.toContain("Obsolete extraction failed");
  expect(document.activeElement).toBe(h.address);
  expect(await h.openFromMenu()).toBeTruthy();
});

it.each(["success", "failure"])("keeps the returned page visible after an obsolete snapshot %s", async (outcome) => {
  const h = await setup();
  let settle;
  h.snapshot.mockImplementationOnce(() => new Promise((resolve, reject) => { settle = [resolve, reject]; }));
  h.requestFromPage();
  await waitFor(() => expect(settle).toBeDefined());
  const hides = () => h.invoke.mock.calls.filter(([, args]) => args?.request?.kind === "hide").length;
  const beforePresent = h.present.mock.calls.length;
  let beforeRelease;
  try {
    await app.canDeactivate();
    h.render();
    await waitFor(() => expect(h.present.mock.calls.length).toBeGreaterThan(beforePresent));
    beforeRelease = hides();
    h.address.focus();
  } finally {
    if (outcome === "success") settle[0]("data:image/jpeg;base64,AA==");
    else settle[1](Error("Obsolete native preview failed"));
  }
  await app.finishWindowWrites();
  expect(hides()).toBe(beforeRelease);
  expect(document.body.textContent).not.toContain("Obsolete native preview failed");
  expect(queryByRole(document.body, "dialog", { name: "Reading mode" })).toBeNull();
  expect(document.activeElement).toBe(h.address);
});

it("drops a failed reader presentation after the browser activation ends", async () => {
  const h = await setup();
  let fail;
  h.present.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ x: 0, y: 0, width: 710, height: 580 });
  h.requestFromPage();
  await waitFor(() => expect(fail).toBeTypeOf("function"));
  try {
    app.deactivate();
    h.render();
    h.address.focus();
  } finally { fail(Error("Obsolete reader presentation failed")); }
  await app.finishWindowWrites();
  expect(document.body.textContent).not.toContain("Obsolete reader presentation failed");
  expect(h.readArticle).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(h.address);
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
