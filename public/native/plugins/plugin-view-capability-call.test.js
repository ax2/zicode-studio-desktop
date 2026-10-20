import { expect, it, vi } from "vitest";
import { invokeViewCapability } from "./plugin-view-capability-call.js";

const revision = "a".repeat(64);
const callId = "00000000-0000-4000-8000-000000000001";
const scope = { sceneId: "programming", workspaceId: "workspace", pluginId: "plugin",
  capabilityId: "tool.run" };
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(overrides = {}) {
  const gateway = {
    callProtocol: vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1", prepareRequired: true })),
    searchTools: vi.fn(async () => ({ schemaVersion: 1, revision })),
    loadTool: vi.fn(async () => ({ pluginId: "plugin", version: "1.0.0", revision,
      capability: { id: "tool.run" } })),
    prepareCall: vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1", callId })),
    cancelCall: vi.fn(async () => ({ status: "cancel_requested", executionFinished: false })),
    invoke: vi.fn(async () => ({ result: { ok: true } })),
    ...overrides,
  };
  const requestState = { cancelled: false, cancel: null };
  const run = (options = {}) => invokeViewCapability({ gateway, scope, input: { value: 1 },
    captureResult: true, pluginVersion: "1.0.0", requestState,
    isCurrent: () => true, ...options });
  return { gateway, requestState, run };
}

it("binds a View capability to a current catalog revision and a single-use Host handle", async () => {
  const { gateway, run } = fixture();
  await expect(run()).resolves.toEqual({ result: { ok: true } });
  expect(gateway.searchTools).toHaveBeenCalledWith("programming",
    { query: "", offset: 0, revision: null, pluginId: "plugin" });
  expect(gateway.loadTool).toHaveBeenCalledWith("programming",
    { pluginId: "plugin", capabilityId: "tool.run", revision });
  expect(gateway.prepareCall).toHaveBeenCalledWith({ ...scope, input: { value: 1 },
    catalogRevision: revision, captureResult: true });
  expect(gateway.invoke).toHaveBeenCalledWith("programming", "workspace", "plugin", "tool.run",
    { value: 1 }, { catalogRevision: revision, captureResult: true, callId });
});

it("uses the revision captured with the View source instead of a fresh catalog", async () => {
  const { gateway, run } = fixture();
  await expect(run({ boundRevision: revision })).resolves.toEqual({ result: { ok: true } });
  expect(gateway.searchTools).not.toHaveBeenCalled();
  expect(gateway.loadTool).toHaveBeenCalledWith("programming",
    { pluginId: "plugin", capabilityId: "tool.run", revision });
});

it("rejects a stale View revision instead of fetching current authority", async () => {
  const { gateway, run } = fixture({ loadTool: vi.fn(async () => {
    throw Object.assign(new Error("changed"), { code: "catalog_changed" });
  }) });
  await expect(run({ boundRevision: revision })).rejects.toMatchObject({ code: "catalog_changed" });
  expect(gateway.searchTools).not.toHaveBeenCalled();
  expect(gateway.prepareCall).not.toHaveBeenCalled();
  expect(gateway.invoke).not.toHaveBeenCalled();
});

it("requests Host cancellation without discarding a late successful result", async () => {
  const pending = deferred();
  const { gateway, requestState, run } = fixture({ invoke: vi.fn(() => pending.promise) });
  const result = run({ cancelRequired: true });
  await vi.waitFor(() => expect(gateway.invoke).toHaveBeenCalledOnce());
  await requestState.cancel();
  expect(gateway.cancelCall).toHaveBeenCalledWith(scope, callId);
  pending.resolve({ result: { completed: true } });
  await expect(result).resolves.toEqual({ result: { completed: true } });
});

it("cancels a handle issued after the View already requested cancellation", async () => {
  const pending = deferred();
  const { gateway, requestState, run } = fixture({ prepareCall: vi.fn(() => pending.promise) });
  const result = run();
  await vi.waitFor(() => expect(gateway.prepareCall).toHaveBeenCalledOnce());
  await requestState.cancel();
  pending.resolve({ schemaVersion: 1, profile: "manual.tool.call.v1", callId });
  await expect(result).rejects.toMatchObject({ code: "plugin_capability_cancelled" });
  expect(gateway.cancelCall).toHaveBeenCalledWith(scope, callId);
  expect(gateway.invoke).not.toHaveBeenCalled();
});

it("keeps legacy calls but rejects an explicit cancellation promise on an old Host", async () => {
  const { gateway, run } = fixture({ callProtocol: vi.fn(async () => { throw new Error("old Host"); }) });
  await expect(run()).resolves.toEqual({ result: { ok: true } });
  expect(gateway.invoke).toHaveBeenCalledWith("programming", "workspace", "plugin", "tool.run",
    { value: 1 }, { captureResult: true });
  await expect(run({ cancelRequired: true })).rejects.toMatchObject({ code: "view_call_cancel_unavailable" });
  expect(gateway.invoke).toHaveBeenCalledOnce();
});

it("rejects a replaced plugin View before preparing or invoking its capability", async () => {
  const { gateway, run } = fixture({ loadTool: vi.fn(async () => ({ pluginId: "plugin",
    version: "2.0.0", revision, capability: { id: "tool.run" } })) });
  await expect(run()).rejects.toMatchObject({ code: "capability_changed" });
  expect(gateway.prepareCall).not.toHaveBeenCalled();
  expect(gateway.invoke).not.toHaveBeenCalled();
});

it("falls back only for a runtime that cannot use the Host call protocol", async () => {
  const { gateway, run } = fixture({ prepareCall: vi.fn(async () => {
    throw Object.assign(new Error("unsupported"), { code: "manual_call_runtime_unsupported" });
  }) });
  await expect(run()).resolves.toEqual({ result: { ok: true } });
  expect(gateway.invoke).toHaveBeenCalledWith("programming", "workspace", "plugin", "tool.run",
    { value: 1 }, { captureResult: true });
  await expect(run({ cancelRequired: true })).rejects.toMatchObject({ code: "view_call_cancel_unavailable" });
});

it("treats a lost invoke response as unknown and asks Host to stop the issued call", async () => {
  const { gateway, run } = fixture({ invoke: vi.fn(async () => {
    throw Object.assign(new Error("timed out"), { code: "plugin_capability_timeout" });
  }) });
  const onUncertain = vi.fn();
  await expect(run({ onUncertain })).rejects.toMatchObject({ code: "view_call_outcome_unknown" });
  expect(gateway.cancelCall).toHaveBeenCalledWith(scope, callId);
  expect(onUncertain).toHaveBeenCalledWith({ scope, callId, hostInstanceId: undefined });
});

it("cancels a prepared handle if the trusted parent cannot track it", async () => {
  const { gateway, run } = fixture();
  await expect(run({ onIssued: () => { throw new Error("panel failed"); } }))
    .rejects.toMatchObject({ code: "view_call_protocol_invalid" });
  expect(gateway.cancelCall).toHaveBeenCalledWith(scope, callId);
  expect(gateway.invoke).not.toHaveBeenCalled();
});
