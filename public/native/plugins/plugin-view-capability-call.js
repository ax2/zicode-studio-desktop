// Reuse the Host's single-use Worker call lifecycle for a trusted View request.
// The opaque frame receives neither the Host handle nor the catalog revision.
const REVISION = /^[0-9a-f]{64}$/i;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

export async function invokeViewCapability({ gateway, scope, input, captureResult,
  pluginVersion, boundRevision, cancelRequired = false, requestState, isCurrent,
  onIssued = () => {}, onDelivered = () => {}, onUncertain = () => {} }) {
  let callId = null;
  let cancellationSent = false;
  requestState.cancel = async () => {
    requestState.cancelled = true;
    if (!callId || cancellationSent) return;
    cancellationSent = true;
    // An acknowledgement requests cancellation; the original invoke still owns
    // the terminal result. A failed acknowledgement never proves completion.
    await gateway.cancelCall(scope, callId).catch(() => {});
  };
  const ensureCurrent = () => {
    if (!isCurrent()) throw new Error("Plugin runtime changed");
    if (requestState.cancelled) throw failure("plugin_capability_cancelled", "Plugin capability request cancelled");
  };
  const unavailable = () => failure("view_call_cancel_unavailable", "Plugin capability cancellation is unavailable");
  ensureCurrent();
  const legacy = () => {
    ensureCurrent();
    if (cancelRequired) throw unavailable();
    return gateway.invoke(scope.sceneId, scope.workspaceId, scope.pluginId,
      scope.capabilityId, input, ...(captureResult ? [{ captureResult: true }] : []));
  };
  if (!scope.workspaceId || ["callProtocol", "loadTool", "prepareCall",
    "cancelCall", "invoke"].some(method => typeof gateway?.[method] !== "function")) return legacy();
  let protocol;
  try { protocol = await gateway.callProtocol(); }
  catch { return legacy(); }
  ensureCurrent();
  if (protocol?.schemaVersion !== 1 || protocol.profile !== "manual.tool.call.v1" ||
    protocol.prepareRequired !== true) return legacy();
  let revision = boundRevision;
  if (revision === undefined || revision === null) {
    if (typeof gateway.searchTools !== "function") return legacy();
    const page = await gateway.searchTools(scope.sceneId,
      { query: "", offset: 0, revision: null, pluginId: scope.pluginId });
    ensureCurrent();
    if (page?.schemaVersion !== 1) {
      throw failure("view_call_protocol_invalid", "Plugin capability catalog response is invalid");
    }
    revision = page.revision;
  }
  if (!REVISION.test(revision ?? "")) {
    throw failure("view_call_protocol_invalid", "Plugin capability catalog revision is invalid");
  }
  const detail = await gateway.loadTool(scope.sceneId,
    { pluginId: scope.pluginId, capabilityId: scope.capabilityId, revision });
  ensureCurrent();
  if (detail?.pluginId !== scope.pluginId || detail?.capability?.id !== scope.capabilityId ||
    detail?.revision !== revision || detail?.version !== pluginVersion) {
    throw failure("capability_changed", "Plugin capability changed");
  }
  const options = { catalogRevision: revision,
    ...(captureResult ? { captureResult: true } : {}) };
  let handle;
  try {
    handle = await gateway.prepareCall({ ...scope, input, ...options });
  } catch (error) {
    if (error?.code === "manual_call_runtime_unsupported") return legacy();
    throw error;
  }
  if (handle?.schemaVersion !== 1 || handle.profile !== "manual.tool.call.v1" ||
    !UUID.test(handle.callId ?? "")) {
    throw failure("view_call_protocol_invalid", "Plugin capability call handle is invalid");
  }
  callId = handle.callId;
  if (!isCurrent() || requestState.cancelled) {
    await requestState.cancel();
    ensureCurrent();
  }
  const call = { scope, callId, hostInstanceId: handle.hostInstanceId };
  try { onIssued(call); }
  catch {
    await requestState.cancel();
    throw failure("view_call_protocol_invalid", "Plugin capability call could not be tracked");
  }
  try {
    const response = await gateway.invoke(scope.sceneId, scope.workspaceId, scope.pluginId,
      scope.capabilityId, input, { ...options, callId });
    try { onDelivered(call); } catch { /* Preserve the actual Host response. */ }
    return response;
  } catch (error) {
    await requestState.cancel();
    try { onUncertain(call); }
    catch { /* Recovery UI failure must not turn an unknown call into a retry. */ }
    if (["plugin_capability_timeout", "plugin_capability_cancelled"].includes(error?.code) || !error?.code) {
      throw failure("view_call_outcome_unknown", "Plugin capability outcome is unknown");
    }
    throw error;
  }
}
