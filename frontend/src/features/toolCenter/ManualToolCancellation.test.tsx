import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { emptyAccess } from "../commandPalette/tool-access";
import { ManualToolDetail } from "./ManualToolDetail";
import type { ManualToolApi } from "./manual-tools";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); });
const scope = { sceneId: "programming", workspaceId: "workspace", pluginId: "fixture", capabilityId: "run" };
const callId = "00000000-0000-4000-8000-000000000001";
const status = (status: "running" | "cancel_requested" | "finished", outcome: string | null = null) => ({
  schemaVersion: 1, profile: "manual.tool.call.v1", status, executionFinished: status === "finished", outcome,
});
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function mount(options: Partial<ManualToolApi> = {}) {
  setLocale("en");
  const pending = deferred<{ result: unknown }>();
  const api = {
    searchTools: vi.fn(), loadTool: vi.fn(async () => ({ pluginId: "fixture", version: "0.1.0", revision: "revision", enabled: true,
      capability: { id: "run", inputSchema: { type: "object", properties: {} } }, permissions: [] })),
    callProtocol: vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1", prepareRequired: true, runtimes: ["worker", "wasi"] })),
    prepareCall: vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1", callId })),
    cancelCall: vi.fn(async () => status("cancel_requested")), callStatus: vi.fn(async () => status("running")),
    invoke: vi.fn(() => pending.promise), ...options,
  } satisfies ManualToolApi;
  const store = { read: vi.fn(async () => emptyAccess()), mutate: vi.fn(async () => emptyAccess()) };
  const busy = vi.fn();
  const element = document.createElement("div"); document.body.append(element);
  const root = createRoot(element); roots.push(root);
  await act(async () => root.render(<ManualToolDetail tool={{ toolId: "tool", accessId: "access", ...scope, title: "Run",
    applicationName: "Fixture", publisher: "Studio", version: "0.1.0", enabled: true, runtime: "javascript" }}
    revision="revision" api={api} scope={scope} accessStore={store} onBusy={busy} />));
  const submit = async () => { await act(async () => { element.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); };
  const click = async (label: string) => { const button = [...element.querySelectorAll("button")].find(value => value.textContent === label);
    expect(button).toBeTruthy(); await act(async () => button?.click()); };
  return { root, element, api, pending, store, busy, submit, click };
}

it.each(["worker_timeout", "worker_fuel_exhausted", "worker_memory_trap", "worker_stack_exhausted"])("records %s while keeping the execution lock until valid status", async code => {
  const { element, api, pending, submit, click, busy } = await mount();
  await submit(); await act(async () => pending.reject({ code, message: "PRIVATE_RAW_ERROR" }));
  expect(element.textContent).toContain("Confirm its status before running again");
  const record = element.querySelector<HTMLTextAreaElement>('[aria-label="Call troubleshooting record"]');
  expect(record).not.toBeNull();
  expect(record?.value).toContain(code); expect(record?.value).toContain(callId);
  expect(record?.value).not.toContain("PRIVATE_RAW_ERROR");
  expect(record?.closest("details")?.open).toBe(false);
  await submit(); expect(api.invoke).toHaveBeenCalledTimes(1); expect(busy).toHaveBeenLastCalledWith(true);
  vi.mocked(api.callStatus).mockResolvedValue(status("finished", code));
  await click("Check tool status");
  expect(busy).toHaveBeenLastCalledWith(false); expect(api.invoke).toHaveBeenCalledTimes(1);
  expect(record?.value).toContain("status_verified"); expect(record?.value).toContain(code);
});

it("binds the issued handle and waits for actual cancellation instead of its acknowledgement", async () => {
  const { element, api, pending, store, submit, click, busy } = await mount();
  await submit(); await submit();
  expect(api.prepareCall).toHaveBeenCalledTimes(1); expect(api.invoke).toHaveBeenCalledTimes(1);
  expect(api.invoke).toHaveBeenCalledWith("programming", "workspace", "fixture", "run", {}, { catalogRevision: "revision", callId });
  await click("Cancel tool");
  expect(api.cancelCall).toHaveBeenCalledWith(scope, callId);
  expect(element.textContent).toContain("Waiting for the tool to stop");
  expect(element.textContent).not.toContain("Tool cancelled.");
  expect(busy).toHaveBeenLastCalledWith(true);
  await act(async () => pending.reject({ code: "worker_cancelled" }));
  expect(element.textContent).toContain("Tool cancelled."); expect(element.querySelector('[role="alert"]')).toBeNull();
  expect(element.textContent).not.toContain("Waiting for the tool to stop");
  expect(store.mutate).not.toHaveBeenCalled(); expect(busy).toHaveBeenLastCalledWith(false);
});

it("preserves a genuine late success and records recent once", async () => {
  const { element, pending, store, submit, click } = await mount();
  await submit(); await click("Cancel tool");
  await act(async () => pending.resolve({ result: { text: "actual success" } }));
  expect(element.textContent).not.toContain("Tool cancelled.");
  expect((element.querySelector("[data-tool-result]") as HTMLTextAreaElement).value).toBe("{\n  \"text\": \"actual success\"\n}");
  expect(store.mutate).toHaveBeenCalledTimes(1);
});

it("locks retry after a lost response until Host proves completion", async () => {
  const { element, api, pending, store, submit, click, busy } = await mount();
  await submit(); await act(async () => pending.reject({ code: "plugin_capability_timeout" }));
  await submit(); expect(api.invoke).toHaveBeenCalledTimes(1); expect(busy).toHaveBeenLastCalledWith(true);
  await click("Check tool status"); expect(element.textContent).toContain("still running");
  vi.mocked(api.callStatus).mockResolvedValue(status("finished", "worker_cancelled"));
  await click("Check tool status"); expect(element.textContent).toContain("Tool cancelled.");
  expect(busy).toHaveBeenLastCalledWith(false); expect(store.mutate).not.toHaveBeenCalled();
});

it.each(["manual_call_already_started", "manual_calls_unavailable", "proxy_error", "plugin_execution_failed"])(
  "requires Host completion proof after an issued call rejects with %s", async code => {
    const { api, pending, submit, click, busy, store } = await mount();
    await submit(); await act(async () => pending.reject({ code }));
    await submit();
    expect(api.invoke).toHaveBeenCalledTimes(1); expect(busy).toHaveBeenLastCalledWith(true);
    await click("Check tool status");
    expect(busy).toHaveBeenLastCalledWith(true);
    vi.mocked(api.callStatus).mockResolvedValue(status("finished", "plugin_execution_failed"));
    await click("Check tool status");
    expect(busy).toHaveBeenLastCalledWith(false); expect(store.mutate).not.toHaveBeenCalled();
  },
);

it.each([null, undefined, "", 42, {}, [], "x".repeat(129)])("rejects a malformed terminal outcome %j without unlocking", async outcome => {
  const { api, pending, submit, click, busy } = await mount();
  await submit(); await act(async () => pending.reject({ code: "plugin_capability_timeout" }));
  vi.mocked(api.callStatus).mockResolvedValue({ ...status("finished"), outcome } as Awaited<ReturnType<NonNullable<ManualToolApi["callStatus"]>>>);
  await click("Check tool status"); await submit();
  expect(api.invoke).toHaveBeenCalledTimes(1); expect(busy).toHaveBeenLastCalledWith(true);
});

it("rejects a cancellation acknowledgement with contradictory running outcome", async () => {
  const { element, api, pending, submit, click, busy } = await mount();
  await submit();
  vi.mocked(api.cancelCall).mockResolvedValue(status("cancel_requested", "worker_cancelled"));
  await click("Cancel tool");
  expect(element.textContent).toContain("Cancellation could not be confirmed");
  await submit(); expect(api.invoke).toHaveBeenCalledTimes(1); expect(busy).toHaveBeenLastCalledWith(true);
  await act(async () => pending.resolve({ result: { ok: true } }));
  expect(busy).toHaveBeenLastCalledWith(false);
});

it("does not unlock a live invoke when cancellation fails and status arrives before its response", async () => {
  const { element, api, pending, submit, click, busy } = await mount();
  await submit(); vi.mocked(api.cancelCall).mockRejectedValue(new Error("offline"));
  await click("Cancel tool"); expect(element.textContent).toContain("could not be confirmed");
  vi.mocked(api.callStatus).mockResolvedValue(status("finished", "completed"));
  await click("Check tool status"); await submit();
  expect(api.invoke).toHaveBeenCalledTimes(1); expect(busy).toHaveBeenLastCalledWith(true);
  await act(async () => pending.resolve({ result: { ok: true } }));
  expect(busy).toHaveBeenLastCalledWith(false);
});

it("uses legacy execution with no cancel button when Host does not advertise v1", async () => {
  const { element, api, pending, submit } = await mount({ callProtocol: vi.fn(async () => { throw new Error("HTTP 404"); }) });
  await submit(); expect(api.prepareCall).not.toHaveBeenCalled();
  expect(element.textContent).not.toContain("Cancel tool");
  expect(api.invoke).toHaveBeenCalledWith("programming", "workspace", "fixture", "run", {}, { catalogRevision: "revision" });
  await act(async () => pending.resolve({ result: {} }));
});

it("requests cancellation on unmount and ignores a late result", async () => {
  const { root, api, pending, store, submit } = await mount(); await submit();
  roots.splice(roots.indexOf(root), 1);
  await act(async () => root.unmount()); expect(api.cancelCall).toHaveBeenCalledWith(scope, callId);
  await act(async () => pending.resolve({ result: { text: "late" } }));
  expect(store.mutate).not.toHaveBeenCalled();
});

it("never invokes a prepared call that returns after the tool is unmounted", async () => {
  const prepare = deferred<{ schemaVersion: number; profile: string; callId: string }>();
  const { root, api, store, submit } = await mount({ prepareCall: vi.fn(()=>prepare.promise) });
  await submit(); roots.splice(roots.indexOf(root),1); await act(async()=>root.unmount());
  await act(async()=>prepare.resolve({ schemaVersion:1,profile:"manual.tool.call.v1",callId }));
  expect(api.invoke).not.toHaveBeenCalled(); expect(api.cancelCall).toHaveBeenCalledWith(scope,callId);
  expect(store.mutate).not.toHaveBeenCalled();
});

const hostInstanceId = "00000000-0000-4000-8000-000000000002";
const retiredProof = () => ({ ...status("finished", "manual_call_retired"), profile: "manual.tool.reconcile.v1", callId, hostInstanceId });
function recoveryOptions(reconcileCall = vi.fn(async () => retiredProof())): Partial<ManualToolApi> {
  return {
    callProtocol: vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1", prepareRequired: true,
      runtimes: ["worker"], reconcileProfile: "manual.tool.reconcile.v1" })),
    prepareCall: vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1", callId, hostInstanceId })),
    callStatus: vi.fn(async () => { throw { code: "manual_call_unavailable" }; }), reconcileCall,
  };
}

it("unlocks a lost response only after matching original Host proves retirement, then permits a new call", async () => {
  const reconcile = vi.fn(async () => retiredProof());
  const { api, pending, submit, click, busy, store } = await mount(recoveryOptions(reconcile));
  await submit(); await act(async () => pending.reject({ code: "plugin_capability_timeout" }));
  await click("Check tool status");
  expect(reconcile).toHaveBeenCalledWith(scope, callId, hostInstanceId);
  expect(busy).toHaveBeenLastCalledWith(false); expect(store.mutate).not.toHaveBeenCalled();
  vi.mocked(api.prepareCall).mockResolvedValue({ schemaVersion: 1, profile: "manual.tool.call.v1", callId: "00000000-0000-4000-8000-000000000003", hostInstanceId });
  vi.mocked(api.invoke).mockResolvedValue({ result: { text: "recovered" } });
  await submit(); expect(api.invoke).toHaveBeenCalledTimes(2); expect(store.mutate).toHaveBeenCalledTimes(1);
});

it.each(["callId", "hostInstanceId", "profile"] as const)("rejects mismatched reconciliation %s without unlocking", async field => {
  const reconcile = vi.fn(async () => ({ ...retiredProof(), [field]: "wrong" }));
  const { pending, submit, click, busy, api } = await mount(recoveryOptions(reconcile));
  await submit(); await act(async () => pending.reject({ code: "plugin_capability_timeout" }));
  await click("Check tool status"); await submit();
  expect(busy).toHaveBeenLastCalledWith(true); expect(api.invoke).toHaveBeenCalledTimes(1);
});

it("rejects a matching retirement proof without a terminal outcome", async () => {
  const reconcile = vi.fn(async () => ({ ...retiredProof(), outcome: null }));
  const { pending, submit, click, busy, api } = await mount(recoveryOptions(reconcile));
  await submit(); await act(async () => pending.reject({ code: "plugin_capability_timeout" }));
  await click("Check tool status"); await submit();
  expect(reconcile).toHaveBeenCalledTimes(1); expect(busy).toHaveBeenLastCalledWith(true);
  expect(api.invoke).toHaveBeenCalledTimes(1);
});

it("keeps locked when the original Host changed and never uses the new instance as proof", async () => {
  const reconcile = vi.fn(async () => { throw { code: "manual_call_host_changed" }; });
  const { pending, submit, click, busy, api } = await mount(recoveryOptions(reconcile));
  await submit(); await act(async () => pending.reject({ code: "plugin_capability_timeout" }));
  await click("Check tool status"); await submit();
  expect(busy).toHaveBeenLastCalledWith(true); expect(api.invoke).toHaveBeenCalledTimes(1);
});

it("does not infer retirement from an offline status query", async () => {
  const options = recoveryOptions(); const reconcile = options.reconcileCall;
  const { pending, submit, click, busy } = await mount({ ...options, callStatus: vi.fn(async () => { throw new Error("offline"); }) });
  await submit(); await act(async () => pending.reject({ code: "plugin_capability_timeout" })); await click("Check tool status");
  expect(reconcile).not.toHaveBeenCalled(); expect(busy).toHaveBeenLastCalledWith(true);
});

it("does not unlock a pending original response from a retirement proof", async () => {
  const { api, pending, submit, click, busy, store } = await mount({ ...recoveryOptions(), cancelCall: vi.fn(async () => { throw new Error("offline"); }) });
  await submit(); await click("Cancel tool"); await click("Check tool status"); await submit();
  expect(api.invoke).toHaveBeenCalledTimes(1); expect(busy).toHaveBeenLastCalledWith(true);
  await act(async () => pending.resolve({ result: { text: "late real success" } }));
  expect(busy).toHaveBeenLastCalledWith(false); expect(store.mutate).toHaveBeenCalledTimes(1);
});

it("requires advertised reconciliation and a Host-issued instance identity", async () => {
  for (const missing of ["advertisement", "instance"] as const) {
    const options = recoveryOptions();
    if (missing === "advertisement") options.callProtocol = vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1", prepareRequired: true, runtimes: ["worker"] }));
    else options.prepareCall = vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1", callId }));
    const { pending, submit, click, busy } = await mount(options);
    await submit(); await act(async () => pending.reject({ code: "plugin_capability_timeout" })); await click("Check tool status");
    expect(options.reconcileCall).not.toHaveBeenCalled(); expect(busy).toHaveBeenLastCalledWith(true);
  }
});
