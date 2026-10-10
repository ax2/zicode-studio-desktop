import { resourceViewTarget } from "./plugin-view-resource.js";
import { normalizeResourceOutputs } from "./plugin-resource-outputs.js";

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const CODES = new Set([
  "resource_worker_busy", "resource_confirmation_required", "permission_denied",
  "runtime_stopped", "resource_unavailable", "resource_authorization_changed",
  "resource_profile_unsupported", "invalid_parameters", "worker_cancelled",
  "worker_timeout", "worker_failed", "worker_cleanup_failed", "worker_protocol_error",
  "worker_fuel_exhausted", "worker_memory_trap", "worker_stack_exhausted", "worker_trapped", "worker_exit_failed",
  "resource_plugin_unavailable", "broker_token_invalid", "resource_budget_exceeded", "resource_output_profile_unsupported", "invalid_output", "result_too_large",
]);
const fail = (code) => { throw new Error(`[${code}]`); };

// Each View owns its calls and immutable parent-derived identity; no child owner/path overrides.
export function createResourceComputation({ instance, gateway, getTarget, isCurrent, onOutputs = () => {} }) {
  const calls = new Map();
  let destroyed = false;
  const current = () => !destroyed && isCurrent() &&
    instance.resourceTarget === resourceViewTarget(getTarget());
  const safeError = (error) => fail(CODES.has(error?.code) ? error.code : "resource_execution_failed");
  function validate(params, invoke) {
    const keys = new Set(invoke
      ? ["capabilityId", "resourceId", "contentVersion", "toolCallId", "input"]
      : ["toolCallId"]);
    if (!params || typeof params !== "object" || Array.isArray(params) ||
        Object.keys(params).some((key) => !keys.has(key)) || !UUID.test(params.toolCallId ?? ""))
      fail("resource_request_invalid");
    if (!current()) fail("resource_view_changed");
  }
  async function cancel(params) {
    validate(params, false);
    const call = calls.get(params.toolCallId);
    if (!call) fail("resource_call_unavailable");
    // Independent request: never reuse the executing request's cancellation signal.
    let result;
    try { result = await gateway.cancelResource(call.owner, params.toolCallId); }
    catch (error) { safeError(error); }
    if (!current()) fail("resource_view_changed");
    if (result?.schemaVersion !== 1 || !["pending", "requested", "finished"].includes(result.status) ||
        typeof result.executionFinished !== "boolean") fail("resource_response_invalid");
    return { schemaVersion: 1, status: result.status, executionFinished: result.executionFinished };
  }
  async function invoke(params) {
    validate(params, true);
    const target = getTarget();
    if (!target?.instanceId || !target?.sessionId || typeof params.capabilityId !== "string" ||
        !params.capabilityId.trim() || params.capabilityId.length > 128 ||
        !UUID.test(params.resourceId ?? "") || !/^[0-9a-f]{64}$/.test(params.contentVersion ?? ""))
      fail("resource_request_invalid");
    if (typeof gateway?.invokeResource !== "function" || typeof gateway?.cancelResource !== "function")
      fail("resource_gateway_unavailable");
    if (calls.has(params.toolCallId)) fail("resource_call_duplicate");
    if (calls.size >= 2) fail("resource_worker_busy");
    let input;
    try {
      input = JSON.stringify(params.input ?? {});
      if (new TextEncoder().encode(input).length > 48 * 1024) fail("resource_request_invalid");
      input = JSON.parse(input);
    } catch { fail("resource_request_invalid"); }
    const owner = { runtimeId: target.instanceId, sessionId: target.sessionId,
      pluginId: instance.plugin.id, capabilityId: params.capabilityId };
    calls.set(params.toolCallId, { owner });
    try {
      let result;
      try { result = await gateway.invokeResource(owner, { ...params, input }); }
      catch (error) {
        // A transport failure may leave real work running. Request bounded Host cancellation.
        void gateway.cancelResource(owner, params.toolCallId).catch(() => {});
        safeError(error);
      }
      if (!current()) fail("resource_view_changed");
      const source = result?.source;
      if (result?.schemaVersion !== 1 || !UUID.test(result.operationId ?? "") ||
          source?.pluginId !== owner.pluginId || source?.capabilityId !== owner.capabilityId ||
          source?.contentVersion !== params.contentVersion || source?.profile !== "resource.wasi.input.draft2" ||
          typeof source?.packageVersion !== "string" || source.packageVersion.length > 128 ||
          result.result == null || new TextEncoder().encode(JSON.stringify(result.result)).length > 1024 * 1024)
        fail("resource_response_invalid");
      const resources = normalizeResourceOutputs(result, params);
      const response = { schemaVersion: 1, operationId: result.operationId,
        source: { pluginId: owner.pluginId, capabilityId: owner.capabilityId,
          packageVersion: source.packageVersion, contentVersion: params.contentVersion, profile: source.profile },
        result: result.result };
      if (resources !== null) {
        response.outputProfile = result.outputProfile;
        response.resources = resources;
      }
      // Rendering failure must not turn a completed execution into an automatic retry.
      try { onOutputs(resources ?? [], owner); } catch { /* Parent rendering is independent. */ }
      return response;
    } finally { calls.delete(params.toolCallId); }
  }
  return { invoke, cancel, destroy() {
    destroyed = true;
    for (const [id, call] of calls) void gateway.cancelResource(call.owner, id).catch(() => {});
    calls.clear();
  } };
}
