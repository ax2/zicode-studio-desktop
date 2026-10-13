import { t } from "../../i18n.js";
import { createPluginResourceSelection } from "./plugin-resource-selection.js";
import { createMultiResourceSelection } from "./plugin-multi-resource-selection.js";
import { createResourceComputation } from "./plugin-view-resource-compute.js";
import { createResourcePreview } from "./plugin-resource-preview.js";
import { createResourceTransfer } from "./plugin-resource-transfer.js";
import { createResourceSave } from "./plugin-resource-save.js";
import { readPluginViewResource, resourceViewTarget } from "./plugin-view-resource.js";
import { resourceCallRecoveryMessage } from "./resource-call-recovery-message.js";

const inputs = async (element, schema) => {
  const form = (await import("../react/tool-center.js")).mountResourceInputs(element, schema);
  return { ...form, destroy: () => queueMicrotask(() => form.destroy()) };
};
function node(tag, text, className) { const el = document.createElement(tag); if (text) el.textContent = t(text); if (className) el.className = className; return el; }
function button(text, action) { const el = node("button", text, "ui-button ui-button--secondary"); el.type = "button"; el.onclick = action; return el; }
// The directory owns the trusted resource UI; no provider view, path, or owner override.
export function createDirectoryResourceRunner({ container, tool, detail, gateway, getTarget, onBusy = () => {}, onSuccess = () => {}, mountInputs = inputs }) {
  const target = getTarget?.(), original = resourceViewTarget(target);
  let active = true, reference = null, form = null, running = false, callId = null, timer = null, invoking = false, cancelRequested = false;
  const valid = () => active && original === resourceViewTarget(getTarget?.());
  const status = node("p"); status.setAttribute("role", "status");
  const result = node("pre", null, "tool-result"), parameters = node("div"), controls = node("div", null, "ui-toolbar"), outputs = node("div");
  const run = button("Execute tool", () => void execute()), cancel = button("Cancel tool", () => void stop());
  const check = button("Stop and recover call", () => void checkStatus()); check.hidden = true;
  run.disabled = true; cancel.disabled = true; controls.append(run, cancel, check); container.append(parameters, controls, status, result, outputs);
  const required = ["loadTool", "prepareResource", "appendResource", "commitResource", "revokeResource", "invokeResource", "cancelResource", "readResource"];
  if (!target?.instanceId || !target?.sessionId || target.workspaceId == null || detail.resourceInputProfile !== "resource.wasi.input.draft2" || tool.runtime !== "wasi" || !detail.enabled ||
      detail.pluginId !== tool.pluginId || detail.version !== tool.version || detail.capability?.id !== tool.capabilityId ||
      !detail.permissions?.some(p => p.name === "resource.read" && p.granted) || required.some(key => typeof gateway?.[key] !== "function")) {
    status.textContent = t("Resource tool unavailable. Check the live session, plugin permissions and refresh its details.");
    return { destroy() { active = false; container.replaceChildren(); } };
  }
  const instance = { plugin: { id: tool.pluginId }, resourceTarget: original, resourceLabel: `${tool.applicationName} · ${tool.title}` };
  const read = (owner, resource, offset, length, current = valid) => readPluginViewResource({ instance, gateway, target: getTarget(),
    isCurrent: () => valid() && current(), params: { capabilityId: owner.capabilityId, resourceId: resource.resourceId, contentVersion: resource.contentVersion, offset, length } });
  const save = typeof gateway.prepareResourceSave === "function" ? createResourceSave({ gateway, getTarget, isCurrent: valid }) : null;
  const transfer = typeof gateway.prepareResourceTransfer === "function" ? createResourceTransfer({ gateway, getTarget, isCurrent: valid, mountInputs,
    onSave: save ? (...args) => save.open(...args) : undefined, onSaveClear: () => save?.clear() }) : null;
  const preview = createResourcePreview({ container: outputs, plugin: { capabilities: [{ id: tool.capabilityId, title: tool.title }] }, isCurrent: valid, read,
    onSave: save ? (...args) => save.open(...args) : undefined, onTransfer: transfer ? (...args) => transfer.open(...args) : undefined,
    onClear: () => { save?.clear(); transfer?.clear(); } });
  const computation = createResourceComputation({ instance, gateway, getTarget, isCurrent: valid, recoverable: true, onOutputs: (items, owner) => preview.show(items, owner) });
  const selectionContainer = node("div"); container.prepend(selectionContainer);
  const maxResources = detail.capability.resourceInputMax;
  const select = Number.isInteger(maxResources) && maxResources >= 2 && maxResources <= 4
    ? createMultiResourceSelection : createPluginResourceSelection;
  const selection = select({ container: selectionContainer, plugin: { id: tool.pluginId, name: tool.applicationName, version: tool.version, capabilities: [{ id: tool.capabilityId, title: tool.title }] }, target, gateway, catalogRevision: detail.revision, maxResources, isCurrent: () => valid() && !running,
    onResource: value => {
      clearTimeout(timer); reference = value; result.textContent = ""; preview.clear();
      run.disabled = !value || !form || running;
    } });
  void mountInputs(parameters, detail.capability.inputSchema).then(value => {
    if (!valid()) { value.destroy(); return; } form = value; run.disabled = !reference;
  }).catch(() => { if (valid()) status.textContent = t("This tool's parameter schema is not supported by the generic form. Choose another tool."); });
  async function stop() {
    if (!callId || !valid()) return;
    cancelRequested = true;
    cancel.disabled = true;
    if (!invoking && !computation.unresolved(callId)) { status.textContent = t("Cancellation requested. Waiting for the tool to finish."); return; }
    try { await computation.cancel({ toolCallId: callId }); if (valid()) status.textContent = t("Cancellation requested. Waiting for the tool to finish."); }
    catch { if (valid()) status.textContent = t("Cancellation could not be confirmed. Wait before running again."); }
  }
  async function checkStatus() {
    if (!valid() || !callId || !computation.unresolved(callId) || check.disabled) return;
    check.disabled = true; status.textContent = t("Sealing or cancelling the call…");
    try {
      const state = await computation.check({ toolCallId: callId });
      if (!valid()) return;
      status.textContent = t(resourceCallRecoveryMessage(state));
      if (state.executionFinished) {
        running = false; callId = null; onBusy(false); check.hidden = true;
        form.setDisabled(false); selectionContainer.inert = false; run.disabled = !reference; cancel.disabled = true;
      }
    } catch (error) { if (valid()) status.textContent = t(resourceCallRecoveryMessage(null, error)); }
    finally { if (valid()) check.disabled = false; }
  }
  async function execute() {
    if (!valid() || running || !reference || !form) return;
    const prepared = form.prepare(); if (prepared.error) { status.textContent = t(prepared.error); return; }
    const access = reference; clearTimeout(timer); result.textContent = ""; preview.clear();
    running = true; cancelRequested = false; callId = crypto.randomUUID(); check.hidden = true; run.disabled = true; cancel.disabled = false; form.setDisabled(true); selectionContainer.inert = true; onBusy(true);
    status.textContent = t("Running…");
    try {
      const refreshed = await gateway.loadTool(target.sceneId ?? "programming", { pluginId: tool.pluginId, capabilityId: tool.capabilityId, revision: detail.revision });
      if (cancelRequested) throw new Error("[worker_cancelled]");
      if (!valid() || refreshed.version !== tool.version || refreshed.revision !== detail.revision || !refreshed.enabled) throw new Error();
      invoking = true;
      const response = await computation.invoke({ ...access, toolCallId: callId, input: prepared.input });
      if (!valid()) return;
      const text = response.result?.data?.text ?? response.result?.text;
      result.textContent = typeof text === "string" ? text : JSON.stringify(response.result, null, 2); status.textContent = t("Receiving tool finished. Results have not been saved.");
      try { if (response.result?.ok !== false) await onSuccess(response); } catch { if (valid()) status.textContent = t("Tool completed, but history could not be saved."); }
      const verify = async () => {
        if (!valid() || running || reference !== access) return;
        try {
          for (const resource of [access, ...(access.additionalResources ?? [])])
            await read({ capabilityId: tool.capabilityId }, resource, 0, 1);
          if (valid() && reference === access) timer = setTimeout(verify, 5000);
        }
        catch { if (valid() && reference === access) { reference = null; run.disabled = true; result.textContent = ""; preview.clear(); status.textContent = t("Tool access expired or changed. Refresh tools and confirm sharing again."); } }
      };
      timer = setTimeout(verify, 5000);
    } catch (failure) {
      if (valid()) status.textContent = t(computation.unresolved(callId)
        ? "Execution outcome is unknown. Recovery seals an unstarted call or requests cancellation before checking completion."
        : failure?.message === "[resource_journal_pending]" ? "A previous call for this tool still needs recovery. Review tool call records before running again."
        : failure?.message === "[resource_journal_full]" ? "Call recovery records are full. Review or explicitly forget old records before running again."
        : failure?.message === "[resource_journal_unavailable]" ? "Call recovery storage is unavailable. No execution was started. Review existing call records or storage access."
        : failure?.message === "[resource_status_unavailable]" ? "One-use tool calls are unavailable. Update Studio before running this tool."
        : failure?.message === "[worker_cancelled]" ? "Tool execution was cancelled. Inputs are kept." : "Tool did not finish successfully. Inputs are kept; review access or cancellation before running again.");
    } finally {
      running = computation.unresolved(callId); invoking = false; onBusy(running);
      if (!running) callId = null;
      if (valid()) { form.setDisabled(running); selectionContainer.inert = running; run.disabled = running || !reference; cancel.disabled = !running; check.hidden = !running; }
    }
  }
  return { destroy() {
    if (!active) return;
    active = false; clearTimeout(timer); computation.destroy(); selection.destroy(); preview.destroy(); transfer?.destroy(); save?.destroy(); form?.destroy();
    container.replaceChildren();
  } };
}
