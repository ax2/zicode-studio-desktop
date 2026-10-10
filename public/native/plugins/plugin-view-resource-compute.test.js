import { describe, expect, it, vi } from "vitest";
import { createResourceComputation } from "./plugin-view-resource-compute.js";
import { resourceViewTarget } from "./plugin-view-resource.js";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const params = { capabilityId: "resource.inspect", resourceId: id,
  contentVersion: "a".repeat(64), toolCallId: id, input: {} };
function setup(onOutputs) {
  let target = { instanceId: "runtime", sessionId: "session", workspaceId: "workspace" };
  const source = { pluginId: "self", capabilityId: params.capabilityId,
    packageVersion: "1.0.0", contentVersion: params.contentVersion, profile: "resource.wasi.input.draft2" };
  const reply = { schemaVersion: 1, operationId: id, source, result: { text: "resource" }, privateToken: "secret" };
  const gateway = { invokeResource: vi.fn(async () => reply),
    cancelResource: vi.fn(async () => ({ schemaVersion: 1, status: "requested", executionFinished: false })) };
  const computation = createResourceComputation({ instance: { plugin: { id: "self" },
    resourceTarget: resourceViewTarget(target) }, gateway, getTarget: () => target, isCurrent: () => true, onOutputs });
  return { computation, gateway, reply, change: () => { target = { ...target, sessionId: "new" }; } };
}
describe("isolated View resource computation", () => {
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
