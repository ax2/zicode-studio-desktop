import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import { t } from "../../i18n.js";
import { setupBrowserApp } from "./browser-app.js";
let app;
afterEach(async () => { await app?.canDeactivate(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup(metadata, present = async () => {}, nativeWindow) {
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () { return this.classList.contains("browser-viewport") ? { x: 50, y: 80, width: 900, height: 600 } : { x: 0, y: 0, width: 0, height: 0 }; });
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  const invoke = vi.fn(async (command, args) => {
    if (command === "browser_get_state") return metadata();
    if (command === "browser_control") {
      if (args.request.kind === "status") return { surfaceRevision: 0, tabs: [] };
      if (args.request.kind === "present") return present();
    }
    return {};
  });
  const host = document.createElement("main"); document.body.append(host);
  app = setupBrowserApp({ invoke, nativeWindow }); app.renderContent(host);
  return { host, invoke, navigation: () => host.querySelector(".browser-navigation"), strip: () => host.querySelector(".browser-tab-strip") };
}
const stored = () => ({ startupMode: "browser", session: { revision: 9, activeTab: "a", tabs: [{ id: "a", url: "https://example.org/", title: "Retained page" }] } });
it("keeps the browser controls inert until metadata and the first native presentation finish", async () => {
  let metadataDone, presentDone;
  const f = setup(() => new Promise(resolve => { metadataDone = resolve; }), () => new Promise(resolve => { presentDone = resolve; }));
  expect(f.navigation().inert).toBe(true); expect(f.strip().inert).toBe(true); expect(f.host.querySelector(".browser-startup")).not.toBeNull();
  const retry = f.host.querySelector(".browser-startup button"); expect(retry.hidden).toBe(true); expect(retry.disabled).toBe(true); retry.click();
  expect(f.invoke.mock.calls.filter(([name]) => name === "browser_get_state")).toHaveLength(1);
  metadataDone(stored()); await waitFor(() => expect(presentDone).toBeTypeOf("function"));
  expect(f.navigation().inert).toBe(true); expect(f.host.querySelector(".browser-startup")).not.toBeNull();
  presentDone(); await waitFor(() => expect(f.navigation().inert).toBe(false));
  expect(f.strip().inert).toBe(false); expect(f.host.querySelector(".browser-startup")).toBeNull();
  expect(f.invoke.mock.calls.some(([name]) => name === "browser_save_session")).toBe(false);
});
it("shows failed restoration with an explicit retry and does not overwrite the stored session", async () => {
  const metadata = vi.fn().mockRejectedValueOnce(Error("Metadata temporarily unavailable")).mockResolvedValue(stored());
  const f = setup(metadata);
  await waitFor(() => expect(f.host.querySelector(".browser-startup p").textContent).toBe(t("Could not restore the browser. Your saved tabs are kept. Please retry.")));
  expect(f.navigation().inert).toBe(true); f.host.querySelector(".browser-startup button").click();
  await waitFor(() => expect(f.navigation().inert).toBe(false)); expect(metadata).toHaveBeenCalledTimes(2);
  expect(f.host.querySelector('.browser-footer > [role="status"]').textContent).toBe("");
  expect(f.host.querySelector(".browser-tab-label").textContent).toBe("Retained page");
  expect(f.invoke.mock.calls.some(([name]) => name === "browser_save_session")).toBe(false);
});
it("enables a genuinely empty browser without waiting for a nonexistent native page", async () => {
  const f = setup(async () => ({ startupMode: "browser", session: { revision: 0, activeTab: null, tabs: [] } }));
  await waitFor(() => expect(f.strip().inert).toBe(false));
  expect(f.host.querySelector(".browser-viewport").textContent).not.toBe("");
  expect(f.invoke.mock.calls.some(([,args]) => args?.request?.kind === "create")).toBe(false);
});

it("defers startup presentation while the owner is minimized and reuses the view after restore", async () => {
  let minimized = true, resize;
  const nativeWindow = {
    isMinimized: async () => minimized,
    onResized: async callback => { resize = callback; },
  };
  const f = setup(stored, undefined, nativeWindow);
  const count = kind => f.invoke.mock.calls.filter(([, args]) => args?.request?.kind === kind).length;
  await waitFor(() => expect(f.host.querySelector('[role="tab"]')).not.toBeNull());
  expect(f.navigation().inert).toBe(true);
  expect(count("create")).toBe(0);
  expect(count("present")).toBe(0);
  minimized = false;
  resize();
  await waitFor(() => expect(f.navigation().inert).toBe(false));
  expect(count("create")).toBe(1);
  expect(count("present")).toBe(1);
  minimized = true;
  resize();
  await waitFor(() => expect(count("hide")).toBe(1));
  minimized = false;
  resize();
  await waitFor(() => expect(count("present")).toBe(2));
  expect(count("create")).toBe(1);
  expect(f.host.querySelector('.browser-footer > [role="status"]').textContent).toBe("");
});
