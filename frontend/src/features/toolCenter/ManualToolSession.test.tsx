import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { ManualToolSession } from "./ManualToolSession";
import type { ManualToolApi, ToolDetail } from "./manual-tools";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); });
const callId = "00000000-0000-4000-8000-000000000001";
const scope = { sceneId: "programming", workspaceId: "workspace" };
const status = (finished = false) => ({ schemaVersion: 1, profile: "manual.tool.call.v1", status: finished ? "finished" as const : "running" as const,
  executionFinished: finished, outcome: finished ? "worker_cancelled" : null });
async function mount() {
  setLocale("en");
  let resolve!: (value: { result: unknown }) => void;
  let reject!: (error: unknown) => void;
  const pending = new Promise<{ result: unknown }>((yes, no) => { resolve = yes; reject = no; });
  const detail: ToolDetail = { pluginId: "fixture", version: "1", revision: "r", enabled: true,
    capability: { id: "run", inputSchema: { type: "object", properties: {} } }, permissions: [] };
  const api = {
    searchTools: vi.fn(), loadTool: vi.fn(async () => detail), invoke: vi.fn(() => pending),
    callProtocol: vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1", prepareRequired: true, runtimes: ["worker"] })),
    prepareCall: vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1", callId })),
    cancelCall: vi.fn(async () => status()), callStatus: vi.fn(async () => status()),
  } satisfies ManualToolApi;
  const onBusy = vi.fn(), onDirectory = vi.fn();
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const render = () => root.render(<ManualToolSession tool={{ toolId: "fixture/run", accessId: "fixture:run", pluginId: "fixture", capabilityId: "run",
    title: "Example", applicationName: "Fixture", publisher: "Studio", version: "1", enabled: true, runtime: "javascript" }}
    scope={scope} api={api} revision="r" onBusy={onBusy} onDirectory={onDirectory} />);
  await act(async () => render());
  await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const fail = async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    detail.permissions = null as unknown as ToolDetail["permissions"];
    await act(async () => render());
    expect(container.textContent).toContain("Tool view unavailable");
  };
  const click = async (label: string) => {
    const button = [...container.querySelectorAll("button")].find(value => value.textContent === label);
    expect(button).toBeTruthy(); await act(async () => button?.click());
  };
  return { root, container, api, onBusy, onDirectory, fail, click, resolve, reject };
}

it("retains a running handle across view failure and does not auto-cancel or retry", async () => {
  const { container, api, onBusy, onDirectory, fail, click, resolve } = await mount();
  await fail(); expect(onBusy).toHaveBeenLastCalledWith(true);
  expect(api.cancelCall).not.toHaveBeenCalled(); expect(api.invoke).toHaveBeenCalledTimes(1);
  const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  await click("Check tool status"); expect(api.callStatus).toHaveBeenCalledWith({ ...scope, pluginId: "fixture", capabilityId: "run" }, callId);
  expect(container.textContent).toContain("still running");
  await click("Tool directory"); expect(onDirectory).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ result: { text: "late success" } }));
  expect(onBusy).toHaveBeenLastCalledWith(false); expect(container.textContent).toContain("response is unavailable");
  expect(container.textContent).not.toContain("late success"); expect(api.invoke).toHaveBeenCalledTimes(1);
});

it("offers cancellation after failure and unlocks only after the original cancellation response", async () => {
  const { container, api, onBusy, fail, click, reject } = await mount();
  await fail(); await click("Cancel tool");
  expect(api.cancelCall).toHaveBeenCalledWith({ ...scope, pluginId: "fixture", capabilityId: "run" }, callId);
  expect(onBusy).toHaveBeenLastCalledWith(true);
  await act(async () => reject({ code: "worker_cancelled" }));
  expect(onBusy).toHaveBeenLastCalledWith(false); expect(container.textContent).toContain("Tool cancelled.");
  expect(api.invoke).toHaveBeenCalledTimes(1);
});

it("keeps uncertain recovery alive outside a failed view and rejects malformed proof", async () => {
  const { container, api, onBusy, fail, click, reject } = await mount();
  await fail(); await act(async () => reject({ code: "plugin_capability_timeout" }));
  vi.mocked(api.callStatus).mockResolvedValue({ ...status(true), outcome: null });
  await click("Check tool status"); expect(onBusy).toHaveBeenLastCalledWith(true);
  expect(container.textContent).toContain("Status is unavailable");
  vi.mocked(api.callStatus).mockResolvedValue(status(true));
  await click("Check tool status"); expect(onBusy).toHaveBeenLastCalledWith(false);
  expect(container.textContent).toContain("Tool cancelled."); expect(api.invoke).toHaveBeenCalledTimes(1);
});

it("retains bounded troubleshooting metadata outside a failed tool view", async () => {
  const { container, fail, reject, onBusy } = await mount();
  await fail(); await act(async () => reject({ code: "worker_fuel_exhausted", message: "PRIVATE_RAW_ERROR" }));
  const record = container.querySelector<HTMLTextAreaElement>('[aria-label="Call troubleshooting record"]');
  expect(record?.value).toContain(callId);
  expect(record?.value).toContain("worker_fuel_exhausted");
  expect(record?.value).not.toContain("PRIVATE_RAW_ERROR");
  expect(container.textContent).toContain("computation limit");
  expect(onBusy).toHaveBeenLastCalledWith(true);
});
