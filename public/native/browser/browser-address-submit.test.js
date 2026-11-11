import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/dom";
import { setupBrowserApp } from "./browser-app.js";

let app;
afterEach(async () => { await app?.canDeactivate(); document.body.replaceChildren(); vi.unstubAllGlobals(); });

it("submits the captured address while preserving edits typed during the native request", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  let complete;
  const invoke = vi.fn(async (command, args) => {
    if (command === "browser_get_state") return { startupMode: "browser", session: { revision: 1, activeTab: "a", tabs: [{ id: "a", url: "https://example.org/old", title: "Original" }] } };
    if (args?.request?.kind === "status") return { surfaceRevision: 0, tabs: [{ id: "a", url: "https://example.org/old" }] };
    if (args?.request?.kind === "navigate") return new Promise(resolve => { complete = resolve; });
    return { revision: 2 };
  });
  const host = document.createElement("main"); document.body.append(host);
  app = setupBrowserApp({ invoke }); app.renderContent(host);
  await waitFor(() => expect(host.querySelector('[role="tab"]')).not.toBeNull());
  const input = host.querySelector(".browser-address"), form = input.form;
  input.focus();
  fireEvent.compositionStart(input);
  fireEvent.input(input, { target: { value: "正在输入" } });
  fireEvent.submit(form);
  expect(complete).toBeUndefined();
  fireEvent.compositionEnd(input);
  fireEvent.input(input, { target: { value: "example.org/first" } });
  fireEvent.submit(form);
  fireEvent.input(input, { target: { value: "newer draft" } });
  await waitFor(() => expect(complete).toBeTypeOf("function"));
  expect(invoke).toHaveBeenCalledWith("browser_control", { request: { kind: "navigate", tab: "a", url: "https://example.org/first" } });
  complete();
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_save_session", expect.objectContaining({ tabs: [expect.objectContaining({ url: "https://example.org/first" })] })));
  expect(input.value).toBe("newer draft");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.value).toBe("https://example.org/first");
});
