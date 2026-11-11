import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/dom";
import { setupBrowserApp } from "./browser-app.js";
import { t } from "../../i18n.js";
let app;
afterEach(async () => { await app?.canDeactivate(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
it("uses current native titles after chrome reload, including empty titles and blank tabs", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  const tabs = [{ id: "a", url: "https://example.org/new", title: "Old document" }, { id: "b", url: "https://example.org/untitled", title: "Old heading" }, { id: "c", url: "about:blank", title: "Old page" }];
  const invoke = vi.fn(async (command, args) => {
    if (command === "browser_get_state") return { startupMode: "browser", session: { revision: 1, tabs: structuredClone(tabs), activeTab: "a", closedTabs: [] } };
    if (command === "browser_control" && args.request.kind === "status") return { surfaceRevision: 0, tabs: tabs.map((tab, i) => ({ ...tab, title: i === 0 ? "Current native document" : "" })) };
    return {};
  });
  let emit;
  app = setupBrowserApp({ invoke, listen: async (_event, callback) => { emit = payload => callback({ payload }); } }); const root = document.createElement("main"); document.body.append(root); app.renderContent(root);
  await waitFor(() => expect(root.querySelectorAll('[role="tab"]').length).toBe(3));
  expect([...root.querySelectorAll('.browser-tab-label')].map(el => el.textContent)).toEqual(["Current native document", "https://example.org/untitled", t("New tab")]);
  expect(tabs[0].title).toBe("Old document"); expect(invoke.mock.calls.some(([name]) => name === "browser_save_session")).toBe(false);

  const tab = id => root.querySelector(`[data-browser-tab-id="${id}"] [role="tab"]`);
  expect([...root.querySelectorAll('[role="tab"]')].map(element => element.tabIndex)).toEqual([0, -1, -1]);
  tab("a").focus();
  fireEvent.keyDown(tab("a"), { key: "ArrowLeft" });
  expect(document.activeElement).toBe(tab("c"));
  expect(tab("a").getAttribute("aria-selected")).toBe("true");
  emit({ kind: "title", tab: "a", title: "Background repaint" });
  expect(document.activeElement).toBe(tab("c"));
  expect(tab("c").tabIndex).toBe(0);
  root.querySelector(".browser-address").focus();
  expect(tab("a").tabIndex).toBe(0);
  expect(tab("c").tabIndex).toBe(-1);

  const address = root.querySelector(".browser-address");
  const cleanRoute = "https://example.org/new#overview";
  emit({ kind: "visited", tab: "a", url: cleanRoute, title: "Route", sameDocument: true });
  expect(address.value).toBe(cleanRoute);
  fireEvent.input(address, { target: { value: "unsent draft" } });
  const route = "https://example.org/new#details";
  emit({ kind: "visited", tab: "a", url: route, title: "Route", sameDocument: true });
  expect(address.value).toBe("unsent draft");
  expect(tab("a").title).toBe(route);
  fireEvent.keyDown(address, { key: "Escape", isComposing: true });
  expect(address.value).toBe("unsent draft");
  fireEvent.keyDown(address, { key: "Escape" });
  expect(address.value).toBe(route);
  expect(document.activeElement).toBe(address);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_save_session", expect.objectContaining({
    activeTab: "a", tabs: expect.arrayContaining([expect.objectContaining({ id: "a", url: route })]),
  })));
});
