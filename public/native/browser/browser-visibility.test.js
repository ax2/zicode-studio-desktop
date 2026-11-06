import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import { setupBrowserApp } from "./browser-app.js";
let app;
afterEach(async () => { await app?.canDeactivate(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("defers creation while hidden, shares concurrent creation and clears only a recovered surface error", async () => {
  let hidden = true, resize, finishCreate, failPresent = true;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () { return this.classList.contains("browser-viewport") ? { x: 50, y: 80, width: 900, height: 600 } : { x: 0, y: 0, width: 0, height: 0 }; });
  vi.stubGlobal("ResizeObserver", class { constructor(callback) { resize = callback; } observe() {} });
  const invoke = vi.fn(async (name, args) => {
    if (name === "browser_get_state") return { startupMode: "browser", session: { revision: 0, activeTab: "a", tabs: [{ id: "a", url: "https://example.org/", title: "Example" }] } };
    if (name === "browser_control") {
      if (args.request.kind === "status") return { surfaceRevision: 0, tabs: [] };
      if (args.request.kind === "create") return new Promise(resolve => { finishCreate = resolve; });
      if (args.request.kind === "present" && failPresent) throw Error("Transient viewport failure");
    }
    return {};
  });
  app = setupBrowserApp({ invoke }); const host = document.createElement("main"); document.body.append(host); app.renderContent(host);
  await waitFor(() => expect(host.querySelector('[role="tab"]')).not.toBeNull());
  const requests = kind => invoke.mock.calls.filter(([, args]) => args?.request?.kind === kind);
  expect(requests("create")).toHaveLength(0);
  hidden = false; document.dispatchEvent(new Event("visibilitychange")); await waitFor(() => expect(requests("create")).toHaveLength(1)); resize(); resize(); await Promise.resolve(); expect(requests("create")).toHaveLength(1);
  finishCreate(); await waitFor(() => expect(host.querySelector('.browser-footer [role="status"]').textContent).toBe("Transient viewport failure"));
  failPresent = false; resize(); await waitFor(() => expect(host.querySelector('.browser-footer [role="status"]').textContent).toBe(""));
  const count = requests("present").length; hidden = true; document.dispatchEvent(new Event("visibilitychange")); await waitFor(() => expect(requests("hide").length).toBeGreaterThan(0)); expect(requests("present")).toHaveLength(count);
});
