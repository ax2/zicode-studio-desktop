import { resourceViewTarget } from "./plugin-view-resource.js";
import { normalizeResourceOutputs } from "./plugin-resource-outputs.js";
import { normalizeResourceAdmission, normalizeResourceReconciliation } from "./resource-call-admission.js";

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const RESOURCE_INPUT_PROFILES = new Set(["resource.wasi.input.draft2", "resource.host.image-input.v1", "resource.host.ocr-input.v1", "resource.host.text-input.v1"]);
const CODES = new Set([
  "resource_worker_busy", "resource_confirmation_required", "permission_denied",
  "runtime_stopped", "resource_unavailable", "resource_authorization_changed",
  "resource_profile_unsupported", "invalid_parameters", "worker_cancelled",
  "worker_timeout", "worker_failed", "worker_cleanup_failed", "worker_protocol_error",
  "worker_fuel_exhausted", "worker_memory_trap", "worker_stack_exhausted", "worker_trapped", "worker_exit_failed",
  "resource_plugin_unavailable", "broker_token_invalid", "resource_budget_exceeded", "resource_output_profile_unsupported", "invalid_output", "result_too_large",
  "resource_call_host_changed", "resource_status_unavailable",
  "resource_call_used", "resource_call_not_admissible", "resource_call_changed", "resource_call_budget_exceeded",
  "resource_input_too_large",
  "resource_input_invalid",
  "resource_input_type_unsupported",
  "resource_ocr_failed",
  "resource_journal_unavailable", "resource_journal_full", "resource_journal_pending",
]);
const fail = (code) => { throw new Error(`[${code}]`); };

// Each View owns its calls and immutable parent-derived identity; no child owner/path overrides.
export function createResourceComputation({ instance, gateway, getTarget, isCurrent, onOutputs = () => {}, recoverable = false }) {
  const calls = new Map();
  let destroyed = false;
  const current = () => !destroyed && isCurrent() &&
    instance.resourceTarget === resourceViewTarget(getTarget());
  const safeError = (error) => {
    if (error?.message === "[resource_response_invalid]") fail("resource_response_invalid");
    fail(CODES.has(error?.code) ? error.code : "resource_execution_failed");
  };
  function validate(params, invoke) {
    const keys = new Set(invoke
      ? ["capabilityId", "resourceId", "contentVersion", "additionalResources", "toolCallId", "input"]
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
    if (recoverable && !call.ticket) {
      call.cancelBeforeStart = true;
      return { schemaVersion: 1, status: "pending", executionFinished: false };
    }
    // Independent request: never reuse the executing request's cancellation signal.
    let result;
    try { result = recoverable ? await reconcile(call) : await gateway.cancelResource(call.owner, params.toolCallId); }
    catch (error) { safeError(error); }
    if (!current()) fail("resource_view_changed");
    if (recoverable) return { schemaVersion: 1, status: result.executionFinished ? "finished" : "requested",
      executionFinished: result.executionFinished };
    if (result?.schemaVersion !== 1 || !["pending", "requested", "finished"].includes(result.status) ||
        typeof result.executionFinished !== "boolean") fail("resource_response_invalid");
    return { schemaVersion: 1, status: result.status, executionFinished: result.executionFinished };
  }
  async function reconcile(call) {
    const response = await gateway.reconcileResourceCall(call.owner, call.ticket);
    return normalizeResourceReconciliation(response, call.owner, call.ticket);
  }
  async function check(params) {
    validate(params, false);
    const call = calls.get(params.toolCallId);
    if (!recoverable || !call?.uncertain || call.checking) fail("resource_call_unavailable");
    call.checking = true;
    try {
      let response;
      try { response = await reconcile(call); }
      catch (error) { safeError(error); }
      if (!current()) fail("resource_view_changed");
      const status = response;
      if (status.executionFinished) {
        await gateway.resourceCalls.remove(call.record);
        calls.delete(params.toolCallId);
      }
      return status;
    } finally { call.checking = false; }
  }
  async function invoke(params) {
    validate(params, true);
    params = { ...params };
    const target = { ...getTarget() };
    if (!target?.instanceId || !target?.sessionId || typeof params.capabilityId !== "string" ||
        !params.capabilityId.trim() || params.capabilityId.length > 128 ||
        !UUID.test(params.resourceId ?? "") || !/^[0-9a-f]{64}$/.test(params.contentVersion ?? ""))
      fail("resource_request_invalid");
    const additional = params.additionalResources ?? [];
    const expectedProfile = instance.resourceInputProfile ?? "resource.wasi.input.draft2";
    if (!RESOURCE_INPUT_PROFILES.has(expectedProfile)) fail("resource_profile_unsupported");
    if (!Array.isArray(additional) || additional.length > 3 || (additional.length && !recoverable) ||
        new Set([params.resourceId, ...additional.map(resource => resource?.resourceId)]).size !== additional.length + 1 ||
        additional.some(resource => !resource || Object.keys(resource).some(key => !["resourceId", "contentVersion"].includes(key)) ||
          !UUID.test(resource.resourceId ?? "") || !/^[0-9a-f]{64}$/.test(resource.contentVersion ?? "")))
      fail("resource_request_invalid");
    if (additional.length) params.additionalResources = additional.map(resource => ({ ...resource }));
    if (recoverable ? ["prepareResourceCall", "invokeResourceCall", "reconcileResourceCall"].some(key => typeof gateway?.[key] !== "function") ||
      typeof gateway?.resourceCalls?.keep !== "function" || typeof gateway?.resourceCalls?.remove !== "function"
      : typeof gateway?.invokeResource !== "function" || typeof gateway?.cancelResource !== "function")
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
    const call = { owner, issued: false, uncertain: false };
    calls.set(params.toolCallId, call);
    try {
      if (recoverable) {
        let response;
        try { response = await gateway.prepareResourceCall(owner, { ...params, input }); }
        catch { fail("resource_status_unavailable"); }
        call.ticket = normalizeResourceAdmission(response, owner);
        if (!current()) fail("resource_view_changed");
        if (call.cancelBeforeStart) fail("worker_cancelled");
        try { call.record = await gateway.resourceCalls.keep(target, owner, call.ticket, instance.resourceLabel); }
        catch (error) {
          if (error?.message === "[resource_journal_pending]") fail("resource_journal_pending");
          if (error?.message === "[resource_journal_full]") fail("resource_journal_full");
          fail("resource_journal_unavailable");
        }
        if (!current()) fail("resource_view_changed");
        if (call.cancelBeforeStart) fail("worker_cancelled");
      }
      let result;
      call.issued = true;
      try { result = recoverable ? await gateway.invokeResourceCall(owner, { ...params, input }, call.ticket)
        : await gateway.invokeResource(owner, { ...params, input }); }
      catch (error) {
        // This Host rejection is emitted before acquiring a call lease. It is
        // not a lost outcome; no cancellation tombstone or recovery lock is needed.
        if (recoverable && error?.code === "resource_worker_busy") {
          call.completed = true; call.seal = true;
          safeError(error);
        }
        // A transport failure may leave real work running. Request bounded Host cancellation.
        if (recoverable) void reconcile(call).catch(() => {});
        else void gateway.cancelResource(owner, params.toolCallId).catch(() => {});
        safeError(error);
      }
      if (!current()) fail("resource_view_changed");
      const source = result?.source;
      if (result?.schemaVersion !== 1 || !UUID.test(result.operationId ?? "") ||
          source?.pluginId !== owner.pluginId || source?.capabilityId !== owner.capabilityId ||
          source?.contentVersion !== params.contentVersion ||
          source?.profile !== expectedProfile ||
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
      call.completed = true;
      // A failed record cleanup must not turn a completed execution into a retry.
      if (recoverable) await gateway.resourceCalls.remove(call.record).catch(() => {});
      return response;
    } finally {
      // Also seal tickets obtained after cancellation, teardown or a definite busy rejection.
      if (recoverable && call.ticket && (!call.issued || call.seal))
        void reconcile(call).catch(() => {});
      call.uncertain = recoverable && call.issued && !call.completed;
      if (!call.uncertain) calls.delete(params.toolCallId);
    }
  }
  return { invoke, cancel, check, unresolved: id => calls.get(id)?.uncertain === true, destroy() {
    destroyed = true;
    for (const [id, call] of calls) {
      if (recoverable) { if (call.ticket) void reconcile(call).catch(() => {}); }
      else void gateway.cancelResource(call.owner, id).catch(() => {});
    }
    calls.clear();
  } };
}
