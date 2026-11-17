import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import { setupBrowserApp } from "./browser-app.js";
import { t } from "../../i18n.js";

const first = {
  id: "32343a13-7ecf-4ac4-a2d9-82bd58f8171b",
  title: "Retained first",
  url: "https://test.example/first",
  zoom: 1.2,
  muted: true,
};
const peer = {
  id: "6ca0ed15-aa36-46ea-9d10-0cdbdb45ecc1",
  title: "Retained peer",
  url: "https://test.example/peer",
  zoom: 1,
  muted: false,
};
const failure = () => t("The page process stopped. Reload the tab to reopen its address.");
let app;
afterEach(async () => {
  await app?.canDeactivate();
  app = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function start(initialNative = [first, peer]) {
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ x: 50, y: 80, width: 900, height: 600 }));
  let emit;
  let revision = 0;
  let failCreation = false;
  const requests = [];
  const saves = [];
  const container = document.createElement("main");
  document.body.append(container);
  const invoke = vi.fn(async (command, args) => {
    if (command === "browser_get_state") {
      return { startupMode: "browser", session: { revision, activeTab: first.id, tabs: [first, peer] } };
    }
    if (command === "browser_save_session") {
      saves.push(args);
      return { revision: ++revision };
    }
    const request = args.request;
    requests.push(request);
    if (request.kind === "status") return { surfaceRevision: 0, tabs: initialNative };
    if (request.kind === "create" && failCreation) {
      failCreation = false;
      throw new Error("Test controller unavailable");
    }
    return {};
  });
  app = setupBrowserApp({ invoke, listen: async (_name, callback) => { emit = payload => callback({ payload }); } });
  app.renderContent(container);
  await waitFor(() => expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2));
  const select = async id => {
    const button = container.querySelector(`[data-browser-tab-id="${id}"] [role="tab"]`);
    button.click();
    await waitFor(() => expect(container.querySelector(`[data-browser-tab-id="${id}"] [role="tab"]`)?.getAttribute("aria-selected")).toBe("true"));
  };
  return {
    container, invoke, requests, saves, select,
    event: payload => emit(payload),
    status: () => container.querySelector('.browser-footer > [role="status"]').textContent,
    failNextCreation: () => { failCreation = true; },
    reload: () => container.querySelector(`button[aria-label="${t("Reload")}"]`).click(),
  };
}

it("keeps saved tabs and an unaffected peer, then recreates the failed page on explicit reload", async () => {
  const view = await start();
  await waitFor(() => expect(view.requests.some(request => request.kind === "present" && request.tab === first.id)).toBe(true));
  view.event({ kind: "navigationStarted", tab: first.id });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }));
  expect(view.container.querySelector(".browser-find").hidden).toBe(false);
  const findStops = view.requests.filter(request => request.kind === "findStop").length;
  view.event({ kind: "processFailed", tab: first.id });
  view.event({ kind: "processFailed", tab: first.id });
  view.event({ kind: "title", tab: first.id, title: "Stale title" });
  view.event({ kind: "loading", tab: first.id, url: "https://test.example/stale" });
  expect(view.status()).toBe(failure());
  expect(view.container.querySelector('[role="tab"][aria-selected="true"]').textContent).toContain(first.title);
  expect(view.container.querySelector(".browser-find").hidden).toBe(true);
  expect(view.saves).toEqual([]);
  expect(view.requests.filter(request => request.kind === "create" || request.kind === "close")).toEqual([]);
  await view.select(peer.id);
  expect(view.requests.filter(request => request.kind === "findStop")).toHaveLength(findStops);
  await waitFor(() => expect(view.requests.some(request => request.kind === "present" && request.tab === peer.id)).toBe(true));
  expect(view.status()).toBe("");
  await view.select(first.id);
  expect(view.status()).toBe(failure());
  expect(view.requests.filter(request => request.kind === "create" || request.kind === "close")).toEqual([]);
  view.reload();
  await waitFor(() => expect(view.status()).toBe(""));
  expect(view.requests.filter(request => request.kind === "close" || request.kind === "create")).toEqual([
    { kind: "close", tab: first.id },
    expect.objectContaining({ kind: "create", tabId: first.id, url: first.url, zoom: 1.2, muted: true }),
  ]);
  expect(view.requests.some(request => request.kind === "action" && request.action === "reload")).toBe(false);
  expect(view.saves.at(-1).tabs).toEqual([first, peer]);
});

it("retains the stored URL and settings when the native status reports a failed tab on shell initialization", async () => {
  const view = await start([{ id: first.id, processFailed: true }, peer]);
  expect(view.status()).toBe(failure());
  expect(view.requests.some(request => request.kind === "create")).toBe(false);
  view.reload();
  await waitFor(() => expect(view.status()).toBe(""));
  expect(view.requests.find(request => request.kind === "create"))
    .toMatchObject({ tabId: first.id, url: first.url, muted: true, zoom: 1.2 });
  expect(view.saves).toEqual([]);
});

it("keeps a crashed tab retryable after new controller creation fails", async () => {
  const view = await start([{ id: first.id, processFailed: true }, peer]);
  view.failNextCreation();
  view.reload();
  await waitFor(() => expect(view.status()).toContain("Test controller unavailable"));
  expect(view.status()).toContain(failure());
  expect(view.container.querySelectorAll('[role="tab"]')).toHaveLength(2);
  view.reload();
  await waitFor(() => expect(view.status()).toBe(""));
  expect(view.requests.filter(request => request.kind === "create")).toHaveLength(2);
  expect(view.requests.filter(request => request.kind === "close")).toEqual([{ kind: "close", tab: first.id }]);
  expect(view.saves).toEqual([]);
});
