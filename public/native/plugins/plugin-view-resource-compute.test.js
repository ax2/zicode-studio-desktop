import { describe, expect, it, vi } from "vitest";
import { createResourceComputation } from "./plugin-view-resource-compute.js";
import { resourceViewTarget } from "./plugin-view-resource.js";
import { admission, reconciliation } from "../../../tests/helpers/resource-call-admission.js";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const params = { capabilityId: "resource.inspect", resourceId: id,
  contentVersion: "a".repeat(64), toolCallId: id, input: {} };
function setup(onOutputs, recoverable = false) {
  let target = { instanceId: "runtime", sessionId: "session", workspaceId: "workspace" };
  const source = { pluginId: "self", capabilityId: params.capabilityId,
    packageVersion: "1.0.0", contentVersion: params.contentVersion, profile: "resource.wasi.input.draft2" };
  const reply = { schemaVersion: 1, operationId: id, source, result: { text: "resource" }, privateToken: "secret" };
  const gateway = { invokeResource: vi.fn(async () => reply),
    cancelResource: vi.fn(async () => ({ schemaVersion: 1, status: "requested", executionFinished: false })) };
  gateway.resourceCalls = { keep: vi.fn(async (target, owner, ticket) => ({ target, owner, ticket })), remove: vi.fn(async () => {}) };
  gateway.prepareResourceCall = vi.fn(async owner => admission(owner));
  gateway.reconcileResourceCall = vi.fn(async (owner, ticket) => reconciliation(owner, ticket.callId));
  gateway.invokeResourceCall = gateway.invokeResource;
  const computation = createResourceComputation({ recoverable, instance: { plugin: { id: "self" },
    resourceTarget: resourceViewTarget(target) }, gateway, getTarget: () => target, isCurrent: () => true, onOutputs });
  return { computation, gateway, reply, change: () => { target = { ...target, sessionId: "new" }; } };
}
describe("isolated View resource computation", () => {
  it("does not execute when the durable record cannot be committed", async () => {
    const c = setup(undefined, true); c.gateway.resourceCalls.keep.mockRejectedValue(new Error("quota"));
    await expect(c.computation.invoke(params)).rejects.toThrow("resource_journal_unavailable");
    expect(c.gateway.invokeResourceCall).not.toHaveBeenCalled();
    expect(c.gateway.reconcileResourceCall).toHaveBeenCalledOnce();
    expect(c.computation.unresolved(id)).toBe(false);
  });
  it("commits before invoke, retains uncertainty and removes only after valid terminal proof", async () => {
    const c = setup(undefined, true); let commit;
    c.gateway.resourceCalls.keep.mockImplementation(() => new Promise(resolve => { commit = resolve; }));
    const work = c.computation.invoke(params); await vi.waitFor(() => expect(commit).toBeTypeOf("function"));
    expect(c.gateway.invokeResourceCall).not.toHaveBeenCalled();
    c.gateway.invokeResourceCall.mockRejectedValue(new Error("lost")); commit({ id: "record" });
    await expect(work).rejects.toThrow(); expect(c.gateway.resourceCalls.remove).not.toHaveBeenCalled();
    c.gateway.reconcileResourceCall.mockImplementation(async (owner, ticket) => reconciliation(owner, ticket.callId, "ended"));
    await c.computation.check({ toolCallId: id }); expect(c.gateway.resourceCalls.remove).toHaveBeenCalledWith({ id: "record" });
  });
  it.each(["not_started", "not_admissible"])("releases a strictly closed %s call without replay or output recovery", async phase => {
    const outputs = vi.fn(); const c = setup(outputs, true);
    c.gateway.invokeResourceCall.mockRejectedValue(new Error("lost"));
    await expect(c.computation.invoke(params)).rejects.toThrow("resource_execution_failed");
    c.gateway.reconcileResourceCall.mockImplementation(async (owner, ticket) => reconciliation(owner, ticket.callId, phase));
    await expect(c.computation.check({ toolCallId: id })).resolves.toMatchObject({ phase, executionFinished: true });
    expect(c.computation.unresolved(id)).toBe(false);
    expect(outputs).not.toHaveBeenCalled(); expect(c.gateway.invokeResourceCall).toHaveBeenCalledOnce();
    expect(c.gateway.cancelResource).not.toHaveBeenCalled();
  });
  it("snapshots resource identity and input before async prepare, and seals after teardown", async () => {
    const c = setup(undefined, true); let finish;
    c.gateway.prepareResourceCall.mockImplementation(owner => new Promise(resolve => { finish = () => resolve(admission(owner)); }));
    const request = { ...params, input: { flag: false } };
    const work = c.computation.invoke(request);
    request.resourceId = "changed"; request.input.flag = true;
    finish(); await work;
    expect(c.gateway.invokeResourceCall.mock.calls[0][1]).toMatchObject({ resourceId: id, input: { flag: false } });
    const pending = c.computation.invoke(params); c.computation.destroy(); finish();
    await expect(pending).rejects.toThrow("resource_view_changed");
    expect(c.gateway.invokeResourceCall).toHaveBeenCalledOnce();
    expect(c.gateway.reconcileResourceCall).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ callId: "resource-call-" + id }));
  });
  it("does not trap the UI or reserve cancellation for a definite Host admission-busy rejection", async () => {
    const c = setup(undefined, true); c.gateway.invokeResource.mockRejectedValue({ code: "resource_worker_busy" });
    await expect(c.computation.invoke(params)).rejects.toThrow("resource_worker_busy");
    expect(c.computation.unresolved(id)).toBe(false); expect(c.gateway.cancelResource).not.toHaveBeenCalled();
  });
  it("honors cancellation during preflight without starting or cancelling Host work", async () => {
    const c = setup(undefined, true); let resolve;
    c.gateway.prepareResourceCall.mockImplementation(() => new Promise(done => { resolve = done; }));
    const work = c.computation.invoke(params);
    await expect(c.computation.cancel({ toolCallId: id })).resolves.toMatchObject({ status: "pending" });
    resolve(admission({ runtimeId: "runtime", sessionId: "session", pluginId: "self", capabilityId: params.capabilityId }));
    await expect(work).rejects.toThrow("worker_cancelled");
    expect(c.gateway.invokeResource).not.toHaveBeenCalled(); expect(c.gateway.cancelResource).not.toHaveBeenCalled();
    expect(c.computation.unresolved(id)).toBe(false);
  });
  it("captures Host identity before a recoverable call and retains uncertain work until an explicit terminal check", async () => {
    const c = setup(undefined, true);
    c.gateway.invokeResource.mockRejectedValue(new Error("transport lost"));
    await expect(c.computation.invoke(params)).rejects.toThrow("resource_execution_failed");
    expect(c.gateway.invokeResourceCall.mock.calls[0][2].hostInstanceId).toBe("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    expect(c.computation.unresolved(id)).toBe(true);
    await expect(c.computation.invoke(params)).rejects.toThrow("resource_call_duplicate");
    await expect(c.computation.check({ toolCallId: id })).resolves.toMatchObject({ phase: "active", executionFinished: false });
    expect(c.computation.unresolved(id)).toBe(true);
    c.gateway.reconcileResourceCall.mockImplementation(async (owner, call) => reconciliation(owner, call.callId, "active"));
    await expect(c.computation.check({ toolCallId: id })).resolves.toMatchObject({ phase: "active" });
    c.gateway.reconcileResourceCall.mockImplementation(async (owner, call) => reconciliation(owner, call.callId, "ended"));
    await expect(c.computation.check({ toolCallId: id })).resolves.toMatchObject({ executionFinished: true });
    expect(c.computation.unresolved(id)).toBe(false);
    expect(c.gateway.invokeResource).toHaveBeenCalledOnce();
  });
  it("keeps work uncertain after changed Host, invalid evidence, or a failed status read", async () => {
    const c = setup(undefined, true); c.gateway.invokeResource.mockRejectedValue({});
    await expect(c.computation.invoke(params)).rejects.toThrow();
    c.gateway.reconcileResourceCall.mockRejectedValue({ code: "resource_call_host_changed" });
    await expect(c.computation.check({ toolCallId: id })).rejects.toThrow("resource_call_host_changed");
    c.gateway.reconcileResourceCall.mockResolvedValue({ ...reconciliation({}, "resource-call-" + id, "ended") });
    await expect(c.computation.check({ toolCallId: id })).rejects.toThrow("resource_response_invalid");
    expect(c.computation.unresolved(id)).toBe(true); expect(c.gateway.invokeResource).toHaveBeenCalledOnce();
    c.computation.destroy();
  });
  it("does not execute when status support is unavailable or scope changes during preflight", async () => {
    const c = setup(undefined, true);
    c.gateway.prepareResourceCall.mockRejectedValue({ code: "not_found" });
    await expect(c.computation.invoke(params)).rejects.toThrow("resource_status_unavailable");
    expect(c.computation.unresolved(id)).toBe(false); expect(c.gateway.invokeResource).not.toHaveBeenCalled();
    c.gateway.prepareResourceCall.mockImplementation(async owner => { c.change(); return admission(owner); });
    await expect(c.computation.invoke(params)).rejects.toThrow("resource_view_changed");
    expect(c.gateway.invokeResource).not.toHaveBeenCalled();
  });
  it("forwards whitelisted output references to the View and trusted preview with parent scope", async () => {
    const outputs = vi.fn();
    const c = setup(outputs);
    c.reply.outputProfile = "resource.wasi.output.draft1";
    c.reply.resources = [{ index: 0, resourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", contentVersion: "b".repeat(64),
      mimeType: "image/png", byteLength: 10, expiresInSeconds: 60, saved: false, origin: "worker-output",
      derivedFrom: { resourceId: id, contentVersion: params.contentVersion, token: "private" }, privatePath: "private" }];
    const result = await c.computation.invoke(params);
    expect(result.resources[0].privatePath).toBeUndefined();
    expect(result.resources[0].derivedFrom.token).toBeUndefined();
    expect(outputs).toHaveBeenCalledWith(result.resources, { runtimeId: "runtime", sessionId: "session", pluginId: "self", capabilityId: params.capabilityId });
    outputs.mockImplementation(() => { throw new Error("rendering failed"); });
    await expect(c.computation.invoke(params)).resolves.toMatchObject({ outputProfile: c.reply.outputProfile });
    c.reply.resources[0].derivedFrom.resourceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await expect(c.computation.invoke(params)).rejects.toThrow("resource_response_invalid");
    expect(outputs).toHaveBeenCalledTimes(2);
  });
  it("derives owner from parent and strips extra response fields", async () => {
    const c = setup();
    const result = await c.computation.invoke(params);
    expect(result.result).toEqual({ text: "resource" });
    expect(result.privateToken).toBeUndefined();
    expect(c.gateway.invokeResource.mock.calls[0][0]).toEqual({ runtimeId: "runtime",
      sessionId: "session", pluginId: "self", capabilityId: params.capabilityId });
  });
  it("rejects client owner paths malformed UUID and oversized parameters before HTTP", async () => {
    const c = setup();
    for (const extra of [{ owner: {} }, { workerPath: "x" }, { toolCallId: "x" },
      { input: { text: "x".repeat(50000) } }]) {
      await expect(c.computation.invoke({ ...params, ...extra })).rejects.toThrow("resource_request_invalid");
    }
    expect(c.gateway.invokeResource).not.toHaveBeenCalled();
  });
  it("permits independent cancellation only for own active calls and bounds concurrency", async () => {
    const c = setup();
    const finishes = [];
    c.gateway.invokeResource.mockImplementation(() => new Promise((resolve) => { finishes.push(resolve); }));
    const work = c.computation.invoke(params);
    await expect(c.computation.invoke(params)).rejects.toThrow("resource_call_duplicate");
    const secondId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const second = c.computation.invoke({ ...params, toolCallId: secondId });
    await expect(c.computation.invoke({ ...params, toolCallId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }))
      .rejects.toThrow("resource_worker_busy");
    await expect(c.computation.cancel({ toolCallId: id })).resolves.toMatchObject({ status: "requested", executionFinished: false });
    expect(c.gateway.cancelResource.mock.calls[0][0].pluginId).toBe("self");
    c.computation.destroy();
    expect(c.gateway.cancelResource).toHaveBeenCalledTimes(3);
    for (const finish of finishes) finish(c.reply);
    await expect(second).rejects.toThrow("resource_view_changed");
    await expect(work).rejects.toThrow("resource_view_changed");
  });
  it("withholds old results and cancels active work on disposal", async () => {
    const c = setup();
    let finish;
    c.gateway.invokeResource.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const work = c.computation.invoke(params);
    c.change();
    finish(c.reply);
    await expect(work).rejects.toThrow("resource_view_changed");
    await expect(c.computation.cancel({ toolCallId: id })).rejects.toThrow("resource_view_changed");
  });
  it("sanitizes errors and requests cancellation after an uncertain transport failure", async () => {
    const c = setup();
    c.gateway.invokeResource.mockRejectedValue(new Error("private path credential"));
    await expect(c.computation.invoke(params)).rejects.toThrow("[resource_execution_failed]");
    expect(c.gateway.cancelResource).toHaveBeenCalledTimes(1);
  });
  it("rejects mismatched output provenance and foreign cancellation", async () => {
    const c = setup();
    c.reply.source.pluginId = "other";
    await expect(c.computation.invoke(params)).rejects.toThrow("resource_response_invalid");
    await expect(c.computation.cancel({ toolCallId: id })).rejects.toThrow("resource_call_unavailable");
  });
  it("preserves fixed execution classes without exposing the Host message", async () => {
    const c = setup();
    for (const code of ["worker_fuel_exhausted", "worker_memory_trap", "worker_stack_exhausted", "worker_trapped", "worker_exit_failed"]) {
      c.gateway.invokeResource.mockRejectedValue({ code, message: "private report" });
      await expect(c.computation.invoke(params)).rejects.toThrow(`[${code}]`);
    }
  });
});
