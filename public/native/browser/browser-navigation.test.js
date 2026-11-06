import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import { setupBrowserApp } from "./browser-app.js";

let app;
afterEach(async () => { await app?.canDeactivate(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
it("uses Stop only for the selected loading tab, then restores Reload", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  const active = "32343a13-7ecf-4ac4-a2d9-82bd58f8171b";
  const peer = "6ca0ed15-aa36-46ea-9d10-0cdbdb45ecc1";
  let emit; const calls = [];
  const invoke = vi.fn(async (name, args) => {
    calls.push({ name, args });
    if (name === "browser_get_state") return { startupMode: "browser", session: { revision: 0, activeTab: active, tabs: [active, peer].map(id => ({ id, url: "https://example.org/", title: id })) } };
    if (name === "browser_control" && args.request.kind === "status") return { surfaceRevision: 0, tabs: [] };
    if (name === "browser_save_session") return { revision: 1 };
    return {};
  });
  app = setupBrowserApp({ invoke, listen: async (_event, callback) => { emit = payload => callback({ payload }); } });
  const container = document.createElement("main"); document.body.append(container); app.renderContent(container);
  await waitFor(() => expect(container.querySelectorAll('[role="tab"]').length).toBe(2));
  const button = container.querySelectorAll(".browser-navigation > button")[2];
  emit({ tab: active, kind: "loading", url: "https://example.org/", finished: false });
  emit({ tab: peer, kind: "navigationFinished", success: true });
  button.click();
  await waitFor(() => expect(calls.some(c => c.args?.request?.action === "stop" && c.args.request.tab === active)).toBe(true));
  emit({ tab: active, kind: "navigationFinished", success: false });
  button.click();
  await waitFor(() => expect(calls.some(c => c.args?.request?.action === "reload" && c.args.request.tab === active)).toBe(true));
  expect(container.querySelectorAll(".browser-navigation > button").length).toBe(4); // Back, Forward, reload/stop, Go.
});
