import { t } from "../../i18n.js";
import { createPluginResourceSelection } from "./plugin-resource-selection.js";
import { createMultiResourceSelection } from "./plugin-multi-resource-selection.js";
import { createPluginDirectoryResourceSelection } from "./plugin-directory-resource-selection.js";
import { createResourceComputation } from "./plugin-view-resource-compute.js";
import { createResourcePreview } from "./plugin-resource-preview.js";
import { createResourceTransfer } from "./plugin-resource-transfer.js";
import { createResourceSave } from "./plugin-resource-save.js";
import { readPluginViewResource, resourceViewTarget } from "./plugin-view-resource.js";
import { resourceCallRecoveryMessage } from "./resource-call-recovery-message.js";
import { createResourceInputModes } from "./plugin-resource-input-modes.js";
import { createImageMetadataResult } from "./image-metadata-result.js";
import { createMarkdownResultDetails } from "./markdown-result-details.js";
import { loadImageReportNoteMaterial } from "./image-report-note-material.js";
import { createFileDigestManifestReview } from "./file-digest-manifest-review.js";
import { createFileDigestResult } from "./file-digest-result.js";
import { createFileDigestNoteMaterial } from "./file-digest-note-material.js";

const hostResourceReceivers = new Map([
  ["com.zicode.resource-inspector/image.inspect", "resource.host.image-input.v1"],
  ["com.zicode.ocr/ocr.resource-text", "resource.host.ocr-input.v1"],
  ["com.zicode.text-inspector/text.inspect", "resource.host.text-input.v1"],
]);

const inputs = async (element, schema) => {
  const form = (await import("../react/tool-center.js")).mountResourceInputs(element, schema);
  return { ...form, destroy: () => queueMicrotask(() => form.destroy()) };
};
function node(tag, text, className) { const el = document.createElement(tag); if (text) el.textContent = t(text); if (className) el.className = className; return el; }
function button(text, action) { const el = node("button", text, "ui-button ui-button--secondary"); el.type = "button"; el.onclick = action; return el; }
// The directory owns the trusted resource UI; no provider view, path, or owner override.
export function createDirectoryResourceRunner({ container, tool, detail, gateway, getTarget, onBusy = () => {}, onSuccess = () => {}, onReceiverExecuted, receiveNoteDraft, mountInputs = inputs }) {
  const target = getTarget?.(), original = resourceViewTarget(target);
  let active = true, reference = null, executionAccess = null, form = null, running = false, reviewBusy = false, callId = null, timer = null, invoking = false, cancelRequested = false;
  const valid = () => active && original === resourceViewTarget(getTarget?.());
  const status = node("p"); status.setAttribute("role", "status");
  const result = node("pre", null, "tool-result"), parameters = node("div"), controls = node("div", null, "ui-toolbar"), outputs = node("div");
  const run = button("Execute tool", () => void execute()), cancel = button("Cancel tool", () => void stop());
  const check = button("Stop and recover call", () => void checkStatus()); check.hidden = true;
  run.disabled = true; cancel.disabled = true; controls.append(run, cancel, check); container.append(parameters, controls, status, result, outputs);
  const required = ["loadTool", "prepareResource", "appendResource", "commitResource", "revokeResource", "invokeResource", "cancelResource", "readResource"];
  const hostResourceProfile = hostResourceReceivers.get(`${tool.pluginId}/${tool.capabilityId}`);
  const supportedResourceTool = (detail.resourceInputProfile === "resource.wasi.input.draft2" && tool.runtime === "wasi") ||
    (tool.runtime === "builtin" && hostResourceProfile !== undefined && detail.resourceInputProfile === hostResourceProfile);
  if (!target?.instanceId || !target?.sessionId || target.workspaceId == null || !supportedResourceTool || !detail.enabled ||
      detail.pluginId !== tool.pluginId || detail.version !== tool.version || detail.capability?.id !== tool.capabilityId ||
      !detail.permissions?.some(p => p.name === "resource.read" && p.granted) || required.some(key => typeof gateway?.[key] !== "function")) {
    status.textContent = t("Resource tool unavailable. Check the live session, plugin permissions and refresh its details.");
    return { destroy() { active = false; container.replaceChildren(); } };
  }
  const metadataResult = createImageMetadataResult({ raw: result, executionProfile: detail.capability.executionProfile, capabilityId: tool.capabilityId,
    onNoteReport: typeof receiveNoteDraft === "function" ? async (resource, owner, current) => {
      const isCurrent = () => valid() && current();
      const material = await loadImageReportNoteMaterial({ resource, owner, read, isCurrent });
      if (!isCurrent()) throw new Error("image_report_unavailable");
      await receiveNoteDraft({ ...material, title: t(material.title) }, isCurrent,
        async () => { await read(owner, resource, 0, 1, isCurrent); });
    } : undefined,
    onSaveReport: typeof gateway.prepareResourceSave === "function" ? (resource, owner, container) => save?.open(resource, owner, container) : undefined }) ??
    createMarkdownResultDetails({ raw: result, executionProfile: detail.capability.executionProfile }) ??
    createFileDigestResult({ raw: result, executionProfile: detail.capability.executionProfile, capabilityId: tool.capabilityId,
      onNoteReport: typeof receiveNoteDraft === "function" ? async (value, names, input, current) => {
        const source = reference;
        const isCurrent = () => valid() && current() && source !== null && reference === source;
        const verify = async () => {
          if (!isCurrent()) throw new Error("file_report_unavailable");
          for (const resource of [source, ...(source.additionalResources ?? [])])
            await read({ capabilityId: tool.capabilityId }, resource, 0, 1, isCurrent);
          if (!isCurrent()) throw new Error("file_report_unavailable");
        };
        const material = createFileDigestNoteMaterial(value, names, input);
        await verify();
        await receiveNoteDraft({ ...material, title: t(material.title) }, isCurrent, verify);
      } : undefined });
  const instance = { plugin: { id: tool.pluginId }, resourceTarget: original, resourceInputProfile: detail.resourceInputProfile,
    resourceLabel: `${tool.applicationName} · ${tool.title}`, resourceExecutionProfile: detail.capability.executionProfile };
  const read = (owner, resource, offset, length, current = valid) => readPluginViewResource({ instance, gateway, target: getTarget(),
    isCurrent: () => valid() && current(), params: { capabilityId: owner.capabilityId, resourceId: resource.resourceId, contentVersion: resource.contentVersion, offset, length } });
  const manifestReview = detail.capability.executionProfile === "resource.wasi.file-digest.v1" && tool.capabilityId === "devtools.files.hash" && typeof gateway.searchTools === "function"
    ? createFileDigestManifestReview({ container, gateway, getTarget, isCurrent: valid,
      verifySources: async current => {
        const source = reference;
        if (!source || !valid() || !current()) throw new Error("file_report_unavailable");
        for (const resource of [source, ...(source.additionalResources ?? [])])
          await read({ capabilityId: tool.capabilityId }, resource, 0, 1, () => valid() && current() && reference === source);
      },
      onBusy: value => { reviewBusy = value; if (!active) return; onBusy(running || reviewBusy); run.disabled = running || reviewBusy || !reference; form?.setDisabled(running || reviewBusy); selectionContainer.inert = running || reviewBusy; },
    }) : null;
  const save = typeof gateway.prepareResourceSave === "function" ? createResourceSave({ gateway, getTarget, isCurrent: valid }) : null;
  const transfer = typeof gateway.prepareResourceTransfer === "function" ? createResourceTransfer({ gateway, getTarget, isCurrent: valid, mountInputs,
    onSave: save ? (...args) => save.open(...args) : undefined, onSaveClear: () => save?.clear(), onReceiverExecuted }) : null;
  const preview = createResourcePreview({ container: outputs, plugin: { capabilities: [{ id: tool.capabilityId, title: tool.title }] }, executionProfile: detail.capability.executionProfile, isCurrent: valid, read,
    onSave: save ? (...args) => save.open(...args) : undefined, onTransfer: transfer ? (...args) => transfer.open(...args) : undefined,
    onClear: () => { save?.clear(); transfer?.clear(); } });
  const computation = createResourceComputation({ instance, gateway, getTarget, isCurrent: valid, recoverable: true, onOutputs: (items, owner, labels, reportResource) => {
    if (!valid() || reference !== executionAccess) return;
    metadataResult?.setReportResource?.(reportResource, owner);
    if (["resource.wasi.image.metadata.v1", "resource.wasi.markdown.v1"].includes(detail.capability.executionProfile)) preview.show(items, owner, items.map(item => item.outputLabel));
    else if (detail.capability.executionProfile === "resource.wasi.regex.review.v1") preview.show(items, owner, labels);
    else preview.show(items, owner);
  } });
  const selectionContainer = node("div"); container.prepend(selectionContainer);
  const acceptedTypes = detail.capability.resourceInputMimeTypes;
  if (Array.isArray(acceptedTypes) && acceptedTypes.length) {
    const types = node("p");
    types.textContent = detail.capability.executionProfile === "resource.wasi.file-digest.v1" && tool.capabilityId === "devtools.files.hash"
      ? t("Any file type") : t("Accepted file types: {types}").replace("{types}", acceptedTypes.join(", "));
    selectionContainer.before(types);
  }
  const maxResources = detail.capability.resourceInputMax;
  const markdownDraftMode = detail.capability.executionProfile === "resource.wasi.markdown.v1" &&
    JSON.stringify(detail.capability.inputSchema?.properties?.sourceMode?.enum) === '["file","draft"]';
  const select = Number.isInteger(maxResources) && maxResources >= 2 && maxResources <= 4
    ? createMultiResourceSelection : createPluginResourceSelection;
  const plugin = { id: tool.pluginId, name: tool.applicationName, version: tool.version, capabilities: [{ id: tool.capabilityId, title: tool.title }] };
  const selectionOptions = { container: selectionContainer, plugin, target, gateway, catalogRevision: detail.revision, maxResources,
    markdownDraftMode,
    readInput: (resource, offset, length, current) => read({ capabilityId: tool.capabilityId }, resource, offset, length, current),
    minResources: detail.capability.resourceInputMin ?? 1, resourceLabels: detail.capability.resourceInputLabels ?? [],
    isCurrent: () => valid() && !running,
    onResource: value => {
      clearTimeout(timer); reference = value; result.textContent = ""; metadataResult?.clear(); manifestReview?.clear(); preview.clear();
      run.disabled = !value || !form || running || reviewBusy;
    } };
  const directoryAvailable = detail.permissions.some(p => p.name === "resource.directory.read" && p.granted) &&
    ["choose", "prepare", "commit", "cancel"].every(key => typeof gateway.projectDirectories?.[key] === "function");
  const selectInputs = options => createResourceInputModes(options, select, acceptedTypes, detail.capability.executionProfile);
  let selection = selectInputs(selectionOptions);
  if (directoryAvailable) {
    const mode = node("div", null, "ui-toolbar");
    const files = button("Files", () => switchMode("files"));
    const directory = button("Folder", () => switchMode("directory"));
    files.setAttribute("aria-pressed", "true"); directory.setAttribute("aria-pressed", "false");
    mode.append(files, directory); selectionContainer.prepend(mode);
    function switchMode(next) {
      if (!valid() || running || (next === "files" && files.getAttribute("aria-pressed") === "true") ||
          (next === "directory" && directory.getAttribute("aria-pressed") === "true")) return;
      selection.destroy(); reference = null; run.disabled = true; result.textContent = ""; metadataResult?.clear(); manifestReview?.clear(); preview.clear();
      files.setAttribute("aria-pressed", String(next === "files"));
      directory.setAttribute("aria-pressed", String(next === "directory"));
      selection = next === "directory" ? createPluginDirectoryResourceSelection(selectionOptions) : selectInputs(selectionOptions);
    }
  }
  const parameterSchema = markdownDraftMode ? { ...detail.capability.inputSchema, properties: {}, required: [] } : detail.capability.inputSchema;
  void mountInputs(parameters, parameterSchema).then(value => {
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
    if (!valid() || running || reviewBusy || !reference || !form) return;
    const prepared = form.prepare(); if (prepared.error) { status.textContent = t(prepared.error); return; }
    const input = { ...prepared.input, ...selection.getInputOptions?.() };
    const access = reference; executionAccess = access;
    // Names remain in the trusted parent; they are never added to the Worker request.
    const displayNames = selection.getDisplayNames?.() ?? [];
    clearTimeout(timer); result.textContent = ""; metadataResult?.clear(); manifestReview?.clear(); preview.clear();
    running = true; cancelRequested = false; callId = crypto.randomUUID(); check.hidden = true; run.disabled = true; cancel.disabled = false; form.setDisabled(true); selectionContainer.inert = true; onBusy(true);
    status.textContent = t("Running…");
    try {
      const refreshed = await gateway.loadTool(target.sceneId ?? "programming", { pluginId: tool.pluginId, capabilityId: tool.capabilityId, revision: detail.revision });
      if (cancelRequested) throw new Error("[worker_cancelled]");
      if (!valid() || reference !== access || refreshed.version !== tool.version || refreshed.revision !== detail.revision || !refreshed.enabled) throw new Error();
      invoking = true;
      const response = await computation.invoke({ ...access, toolCallId: callId, input });
      if (!valid() || reference !== access) return;
      const text = response.result?.data?.text ?? response.result?.text;
      result.textContent = typeof text === "string" ? text : JSON.stringify(response.result, null, 2);
      metadataResult?.show(response.result, displayNames, input);
      manifestReview?.show(response.result, displayNames);
      status.textContent = t(response.result?.ok === false
        ? "Tool reported an error. Inputs are kept and no result was saved."
        : detail.capability.executionProfile === "resource.wasi.file-digest.v1" && tool.capabilityId === "devtools.files.hash"
        ? "File checks completed. Original files were not changed."
        : "Tool finished. Review the result and save any output files explicitly.");
      try { if (response.result?.ok !== false) await onSuccess(response); } catch { if (valid()) status.textContent = t("Tool completed, but history could not be saved."); }
      const verify = async () => {
        if (!valid() || running || reference !== access) return;
        try {
          for (const resource of [access, ...(access.additionalResources ?? [])])
            await read({ capabilityId: tool.capabilityId }, resource, 0, 1);
          if (valid() && reference === access) timer = setTimeout(verify, 5000);
        }
        catch { if (valid() && reference === access) { reference = null; run.disabled = true; result.textContent = ""; metadataResult?.clear(); manifestReview?.clear(); preview.clear(); status.textContent = t("Tool access expired or changed. Refresh tools and confirm sharing again."); } }
      };
      timer = setTimeout(verify, 5000);
    } catch (failure) {
      if (valid() && reference === access) {
        const uncertain = computation.unresolved(callId);
        // Computation exposes only fixed public error codes. Never render a raw
        // Host message, input, or plugin exception in this trusted parent UI.
        const publicCode = /^\[(resource_[a-z_]+|worker_[a-z_]+|invalid_parameters|permission_denied|runtime_stopped|result_too_large|invalid_output)\]$/.exec(failure?.message ?? "")?.[1];
        const typeMismatch = publicCode === "resource_input_type_unsupported";
        const invalidInput = publicCode === "resource_input_invalid";
        status.textContent = t(uncertain
        ? "Execution outcome is unknown. Recovery seals an unstarted call or requests cancellation before checking completion."
        : failure?.message === "[resource_journal_pending]" ? "A previous call for this tool still needs recovery. Review tool call records before running again."
        : failure?.message === "[resource_journal_full]" ? "Call recovery records are full. Review or explicitly forget old records before running again."
        : failure?.message === "[resource_journal_unavailable]" ? "Call recovery storage is unavailable. No execution was started. Review existing call records or storage access."
        : failure?.message === "[resource_status_unavailable]" ? "One-use tool calls are unavailable. Update Studio before running this tool."
        : failure?.message === "[worker_cancelled]" ? "Tool execution was cancelled. Inputs are kept." : "Tool did not finish successfully. Inputs are kept; review access or cancellation before running again.") +
          (typeMismatch ? ` ${t("This tool does not accept the shared file type. Resolve this call before choosing a compatible file.")}` : "") +
          (invalidInput ? ` ${t("This resource is invalid or exceeds the receiver's format or size limits.")}` : "") +
          (uncertain && publicCode ? ` (${publicCode})` : "");
      }
    } finally {
      running = computation.unresolved(callId); invoking = false; executionAccess = null; onBusy(running || reviewBusy);
      if (!running) callId = null;
      if (valid()) { form.setDisabled(running || reviewBusy); selectionContainer.inert = running || reviewBusy; run.disabled = running || reviewBusy || !reference; cancel.disabled = !running; check.hidden = !running; }
    }
  }
  return { destroy() {
    if (!active) return;
    active = false; clearTimeout(timer); computation.destroy(); selection.destroy(); preview.destroy(); manifestReview?.destroy(); metadataResult?.destroy(); transfer?.destroy(); save?.destroy(); form?.destroy();
    container.replaceChildren();
  } };
}
