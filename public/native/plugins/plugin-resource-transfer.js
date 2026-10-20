import { t } from "../../i18n.js";
import { createResourceComputation } from "./plugin-view-resource-compute.js";
import { createResourcePreview } from "./plugin-resource-preview.js";
import { readPluginViewResource, resourceViewTarget } from "./plugin-view-resource.js";
import { resourceAccess, transferGrant, transferredReference } from "./plugin-resource-transfer-protocol.js";
import { resourceCallRecoveryMessage } from "./resource-call-recovery-message.js";
import { toolCategoryTitle } from "./tool-category-title.js";

const WASI_INPUT_PROFILE = "resource.wasi.input.draft2";
const HOST_IMAGE_INPUT_PROFILE = "resource.host.image-input.v1";
const HOST_IMAGE_RECEIVER = { pluginId: "com.zicode.resource-inspector", capabilityId: "image.inspect" };
const HOST_OCR_INPUT_PROFILE = "resource.host.ocr-input.v1";
const HOST_OCR_RECEIVER = { pluginId: "com.zicode.ocr", capabilityId: "ocr.resource-text" };
const HOST_TEXT_INPUT_PROFILE = "resource.host.text-input.v1";
const HOST_TEXT_RECEIVER = { pluginId: "com.zicode.text-inspector", capabilityId: "text.inspect" };

const defaultInputs = async (container, schema) => {
  const { mountResourceInputs } = await import("../react/tool-center.js");
  return mountResourceInputs(container, schema);
};
const node = (tag, text, className) => {
  const item = document.createElement(tag);
  if (text) item.textContent = text;
  if (className) item.className = className;
  return item;
};
const button = (text, action) => {
  const item = node("button", t(text), "ui-button ui-button--secondary");
  item.type = "button"; item.onclick = action; return item;
};
function executionMessage(error) {
  const code = error?.message;
  if (code === "[resource_input_invalid]") return t("This resource is invalid or exceeds the receiver's format or size limits.");
  if (code === "[resource_ocr_failed]") return t("Local OCR could not recognize this image. Check that a Windows OCR language pack is installed.");
  if (code === "[worker_timeout]") return t("Tool timed out. Inputs are kept; review before running again.");
  if (code === "[worker_cancelled]") return t("Tool execution was cancelled. Inputs are kept.");
  if (["[permission_denied]", "[resource_authorization_changed]", "[resource_unavailable]", "[resource_plugin_unavailable]", "[runtime_stopped]"].includes(code))
    return t("Tool access expired or changed. Refresh tools and confirm sharing again.");
  return t("Tool did not finish successfully. Inputs are kept; review access or cancellation before running again.");
}

// Trusted parent UI only. Sharing does not submit tool parameters or start a Worker.
export function createResourceTransfer({ gateway, getTarget, isCurrent, mountInputs = defaultInputs, onSave, onSaveClear, onReceiverExecuted }) {
  let active = true, selection = null;
  const revoke = access => { if (access) void gateway.revokeResource(access).catch(() => {}); };
  function clear() { selection?.dispose(); selection = null; }
  function open(resource, owner, container) {
    clear();
    if (!active || !isCurrent()) return;
    const source = resourceAccess(owner, resource), originalTarget = resourceViewTarget(getTarget());
    const panel = node("dialog", null, "plugin-resource-transfer");
    panel.setAttribute("aria-label", t("Send output to a tool")); container.append(panel);
    let disposed = false, request = 0, page = null, chosen = null, chosenProfile = null, form = null;
    let searchController = null;
    let view = "all", sourceFilter = "", categoryFilter = "";
    let reference = null, computation = null, preview = null, downstreamTransfer = null;
    let running = false, callId = null, grant = null, timer = null;
    const valid = () => !disposed && active && isCurrent() && originalTarget === resourceViewTarget(getTarget());
    const status = node("p"); status.setAttribute("role", "status");
    const search = node("input", null, "ui-input"); search.type = "search"; search.maxLength = 512;
    search.setAttribute("aria-label", t("Search receiving tools"));
    const views = node("fieldset", null, "ui-toolbar");
    views.setAttribute("aria-label", t("Receiver tool views"));
    const workspaceId = getTarget()?.workspaceId;
    if (workspaceId) for (const [id, label] of [["all", "All tools"], ["favorites", "Favorite tools"], ["recent", "Recently used tools"]]) {
      const choice = button(label, () => {
        if (!valid() || running || view === id) return;
        view = id;
        for (const item of views.querySelectorAll("button")) item.setAttribute("aria-pressed", String(item === choice));
        void find(0);
      });
      choice.setAttribute("aria-pressed", String(id === view));
      views.append(choice);
    }
    const filters = node("div", null, "tool-directory-filters");
    const sourceLabel = node("label", t("Tool source"), "tool-input-field");
    const categoryLabel = node("label", t("Tool category"), "tool-input-field");
    const sourceSelect = node("select", null, "ui-select");
    const categorySelect = node("select", null, "ui-select");
    sourceSelect.setAttribute("aria-label", t("Tool source"));
    categorySelect.setAttribute("aria-label", t("Tool category"));
    sourceSelect.onchange = () => { sourceFilter = sourceSelect.value; void find(0); };
    categorySelect.onchange = () => { categoryFilter = categorySelect.value; void find(0); };
    sourceLabel.append(sourceSelect); categoryLabel.append(categorySelect); filters.append(sourceLabel, categoryLabel);
    const list = node("div", null, "plugin-resource-transfer-list");
    const details = node("div"), confirmation = node("div"), result = node("pre");
    const outputs = node("div"), controls = node("div", null, "plugin-resource-preview-row");
    const pager = node("nav", null, "ui-toolbar hidden");
    pager.setAttribute("aria-label", t("Tool pages"));
    const previous = button("Previous page", () => void find(Math.max(0, (page?.offset ?? 0) - 40)));
    const pageSummary = node("span");
    const next = button("Next page", () => void find(page?.nextOffset ?? 0));
    previous.disabled = next.disabled = true;
    pager.append(previous, pageSummary, next);
    search.oninput = () => {
      if (!valid() || running) return;
      searchController?.abort(); searchController = null;
      request++;
      page = null;
      resetChosen();
      list.replaceChildren();
      previous.disabled = next.disabled = true; pager.classList.add("hidden"); pageSummary.textContent = "";
      status.textContent = "";
    };
    const searchButton = button("Search", () => void find(0));
    search.onkeydown = event => { if (event.key === "Enter") { event.preventDefault(); void find(0); } };
    const close = button("Close transfer", clear);
    panel.addEventListener("cancel", event => { event.preventDefault(); clear(); });
    const heading = node("div", null, "plugin-resource-transfer-heading");
    heading.append(node("strong", t("Send output to a tool")), close);
    panel.append(heading,
      node("p", t("Share only this output with one tool in this session. Nothing is saved or run automatically.")),
      views, filters, search, searchButton, list, pager, status, details, confirmation, controls, result, outputs);
    if (typeof panel.showModal === "function") panel.showModal();
    else panel.setAttribute("open", "");
    function resetChosen() {
      clearTimeout(timer); timer = null;
      form?.destroy(); form = null; grant = null; chosen = null; chosenProfile = null;
      downstreamTransfer?.destroy(); downstreamTransfer = null;
      computation?.destroy(); computation = null; preview?.destroy(); preview = null;
      revoke(reference); reference = null;
      details.replaceChildren(); confirmation.replaceChildren(); controls.replaceChildren(); result.textContent = "";
    }
    function error() { status.textContent = t("Transfer unavailable. Refresh the tools and review access before trying again."); }
    function updateFilters(response) {
      const options = (select, all, selected, entries, key, label) => {
        select.replaceChildren(new Option(t(all), ""));
        for (const entry of entries ?? []) if (typeof entry?.[key] === "string")
          select.append(new Option(`${label(entry)} · ${entry.count}`, entry[key]));
        if (selected && ![...select.options].some(option => option.value === selected)) select.append(new Option(selected, selected));
        select.value = selected;
      };
      options(sourceSelect, "All tool sources", sourceFilter, response.sources, "pluginId", item => item.title);
      options(categorySelect, "All tool categories", categoryFilter, response.categories, "id", item => toolCategoryTitle(item.id));
    }
    async function find(offset) {
      if (!valid() || running) return;
      searchController?.abort();
      const controller = new AbortController(); searchController = controller;
      const token = ++request; resetChosen(); list.replaceChildren();
      previous.disabled = next.disabled = true; pager.classList.add("hidden"); pageSummary.textContent = "";
      status.textContent = t("Searching tools…");
      try {
        const response = await gateway.searchTools(getTarget()?.sceneId ?? "programming", {
          resourceOnly: true, resourceMimeType: resource.mimeType, query: search.value, offset, revision: offset ? page?.revision : null,
          excludePluginId: owner.pluginId, excludeCapabilityId: owner.capabilityId,
          ...(sourceFilter ? { pluginId: sourceFilter } : {}), ...(categoryFilter ? { categoryId: categoryFilter } : {}),
          ...(view !== "all" && workspaceId ? { view, workspaceId, accessRevision: offset ? page?.accessRevision : null } : {}),
        }, controller.signal);
        if (!valid() || request !== token) return;
        if (response?.schemaVersion !== 1 || !Array.isArray(response.items) || response.items.length > 40 ||
            typeof response.revision !== "string" || response.offset !== offset ||
            (response.nextOffset !== null && response.nextOffset !== offset + response.items.length)) throw new Error();
        page = response;
        updateFilters(response);
        for (const tool of response.items) {
          const supportedRuntime = tool.runtime === "wasi" || (tool.runtime === "builtin" &&
            ((tool.pluginId === HOST_IMAGE_RECEIVER.pluginId && tool.capabilityId === HOST_IMAGE_RECEIVER.capabilityId) ||
              (tool.pluginId === HOST_OCR_RECEIVER.pluginId && tool.capabilityId === HOST_OCR_RECEIVER.capabilityId) ||
              (tool.pluginId === HOST_TEXT_RECEIVER.pluginId && tool.capabilityId === HOST_TEXT_RECEIVER.capabilityId)));
          if (!tool.enabled || !supportedRuntime || typeof tool.pluginId !== "string" ||
              typeof tool.capabilityId !== "string" || typeof tool.title !== "string" || typeof tool.version !== "string" ||
              !Array.isArray(tool.resourceInputMimeTypes) || !tool.resourceInputMimeTypes.includes(resource.mimeType) ||
              (tool.pluginId === owner.pluginId && tool.capabilityId === owner.capabilityId)) continue;
          list.append(button(`${tool.title} · ${tool.applicationName} · ${tool.version}`, () => void choose(tool)));
        }
        previous.disabled = offset === 0;
        next.disabled = response.nextOffset === null;
        pager.classList.toggle("hidden", offset === 0 && response.nextOffset === null);
        if (Number.isSafeInteger(response.total) && response.total >= 0) pageSummary.textContent = t("Showing {start}–{end} of {total}")
          .replace("{start}", String(offset + (response.items.length ? 1 : 0)))
          .replace("{end}", String(offset + response.items.length))
          .replace("{total}", String(response.total));
        status.textContent = t(list.childElementCount ? "Choose a receiving tool. Parameters load only after selection." : "No compatible receiving tools on this page.");
      } catch { if (valid() && request === token) error(); }
      finally { if (searchController === controller) searchController = null; }
    }
    async function choose(tool) {
      if (!valid() || running) return;
      const token = ++request; resetChosen(); chosen = tool;
      status.textContent = t("Loading tool parameters…");
      try {
        const detail = await gateway.loadTool(getTarget()?.sceneId ?? "programming", {
          ...tool, revision: page.revision, resourceMimeType: resource.mimeType,
        });
        if (!valid() || token !== request) return;
        if (detail?.schemaVersion !== 1 || detail.pluginId !== tool.pluginId || detail.version !== tool.version ||
            detail.revision !== page.revision || !detail.enabled || detail.capability?.id !== tool.capabilityId ||
            !Array.isArray(detail.capability?.resourceInputMimeTypes) || !detail.capability.resourceInputMimeTypes.includes(resource.mimeType) ||
            !detail.permissions?.some(p => p.name === "resource.read" && p.granted)) throw new Error();
        const validProfile = (detail.resourceInputProfile === WASI_INPUT_PROFILE && tool.runtime === "wasi") ||
          (detail.resourceInputProfile === HOST_IMAGE_INPUT_PROFILE && tool.runtime === "builtin" &&
            tool.pluginId === HOST_IMAGE_RECEIVER.pluginId && tool.capabilityId === HOST_IMAGE_RECEIVER.capabilityId) ||
          (detail.resourceInputProfile === HOST_OCR_INPUT_PROFILE && tool.runtime === "builtin" &&
            tool.pluginId === HOST_OCR_RECEIVER.pluginId && tool.capabilityId === HOST_OCR_RECEIVER.capabilityId) ||
          (detail.resourceInputProfile === HOST_TEXT_INPUT_PROFILE && tool.runtime === "builtin" &&
            tool.pluginId === HOST_TEXT_RECEIVER.pluginId && tool.capabilityId === HOST_TEXT_RECEIVER.capabilityId);
        if (!validProfile) throw new Error();
        chosenProfile = detail.resourceInputProfile;
        details.append(node("h3", `${tool.title} · ${tool.version}`));
        const inputs = node("div"); details.append(inputs);
        const mounted = await mountInputs(inputs, detail.capability.inputSchema);
        if (!valid() || token !== request) { mounted.destroy(); return; }
        form = mounted;
        controls.append(button("Review sharing", () => void prepare()));
        status.textContent = t("Review sharing before running this tool.");
      } catch (failure) { if (valid() && token === request) { resetChosen();
        if (failure?.message === "resource_inputs_unsupported") status.textContent = t("This tool's parameter schema is not supported by the generic form. Choose another tool.");
        else error();
      } }
    }
    async function prepare() {
      if (!valid() || !chosen || running || reference || grant) return;
      const token = request, tool = chosen;
      const target = { runtimeId: owner.runtimeId, sessionId: owner.sessionId, pluginId: tool.pluginId, capabilityId: tool.capabilityId };
      grant = "pending"; controls.replaceChildren();
      try {
        const response = await gateway.prepareResourceTransfer(source, target);
        if (!valid() || request !== token) return;
        grant = transferGrant(response, source, target, resource, tool.version);
        confirmation.append(node("p", `${grant.target.pluginName} · ${grant.target.toolTitle} · ${grant.target.pluginVersion}`),
          node("p", `${grant.mimeType} · ${grant.byteLength.toLocaleString()} ${t("bytes")}`),
          node("p", t("Confirm access to this output only. This does not approve saving or running the tool.")),
          button("Confirm sharing", () => void commit(target, token)),
          button("Cancel sharing", () => { grant = null; confirmation.replaceChildren(); controls.replaceChildren(button("Review sharing", () => void prepare())); }));
        status.textContent = t("Sharing confirmation expires in 60 seconds.");
        confirmation.tabIndex = -1; confirmation.focus();
      } catch { if (valid() && request === token) { grant = null; error(); controls.replaceChildren(button("Review sharing", () => void prepare())); } }
    }
    async function commit(target, token) {
      if (!valid() || request !== token || !grant || typeof grant !== "object") return;
      const id = grant.grantId; grant = "pending"; confirmation.replaceChildren();
      try {
        const committed = transferredReference(await gateway.commitResourceTransfer(source, id), target);
        if (!valid() || request !== token) { revoke(committed); return; }
        reference = committed;
        const instance = { plugin: { id: target.pluginId }, resourceTarget: originalTarget, resourceInputProfile: chosenProfile,
          resourceLabel: `${chosen.applicationName} · ${chosen.title}` };
        downstreamTransfer = createResourceTransfer({ gateway, getTarget, isCurrent: valid, mountInputs,
          onSave, onSaveClear, onReceiverExecuted });
        preview = createResourcePreview({ container: outputs, plugin: { capabilities: [chosen] }, isCurrent: valid,
          onTransfer: (...args) => downstreamTransfer?.open(...args),
          onSave, onClear: () => { downstreamTransfer?.clear(); onSaveClear?.(); },
          read: (scope, output, offset, length, current) => readPluginViewResource({ instance, gateway, target: getTarget(),
            isCurrent: () => valid() && current(), params: { capabilityId: scope.capabilityId,
              resourceId: output.resourceId, contentVersion: output.contentVersion, offset, length } }) });
        computation = createResourceComputation({ instance, gateway, getTarget, isCurrent: valid, recoverable: true,
          onOutputs: (items, scope) => preview.show(items, scope) });
        controls.replaceChildren(button("Run receiving tool", () => void run()));
        status.textContent = t("Output shared. Review parameters, then run the tool separately.");
      } catch { if (valid() && request === token) { grant = null; error(); controls.replaceChildren(button("Review sharing", () => void prepare())); } }
    }
    function recoverControls(executor) {
      panel.insertBefore(controls, details);
      const check = button("Stop and recover call", async () => {
        if (!valid() || !executor.unresolved(callId) || check.disabled) return;
        check.disabled = true; status.textContent = t("Sealing or cancelling the call…");
        try {
          const state = await executor.check({ toolCallId: callId });
          if (!valid()) return;
          status.textContent = t(resourceCallRecoveryMessage(state));
          if (state.executionFinished) {
            running = false; callId = null; form.setDisabled(false);
            panel.insertBefore(controls, result);
            search.disabled = searchButton.disabled = false;
            previous.disabled = page.offset === 0; next.disabled = page.nextOffset === null; list.inert = false;
            controls.replaceChildren(button("Run receiving tool", () => void run()));
          }
        } catch (error) { if (valid()) status.textContent = t(resourceCallRecoveryMessage(null, error)); }
        finally { if (valid()) check.disabled = false; }
      });
      controls.replaceChildren(check, button("Cancel execution", () => {
        void executor.cancel({ toolCallId: callId }).then(() => {
          if (valid()) status.textContent = t("Cancellation requested. Waiting for the tool to finish.");
        }).catch(() => { if (valid()) status.textContent = t(resourceCallRecoveryMessage(null, new Error())); });
      }));
    }
    async function run() {
      if (!valid() || running || !reference || !computation) return;
      const prepared = form.prepare();
      if (prepared.error) { status.textContent = t(prepared.error); return; }
      const executor = computation, access = reference;
      clearTimeout(timer); timer = null;
      running = true; form.setDisabled(true); search.disabled = searchButton.disabled = previous.disabled = next.disabled = true; list.inert = true;
      callId = crypto.randomUUID(); result.textContent = ""; preview.clear();
      controls.replaceChildren(button("Cancel execution", () => {
        void executor.cancel({ toolCallId: callId }).then(() => { if (valid()) status.textContent = t("Cancellation requested. Waiting for the tool to finish."); })
          .catch(() => { if (valid()) error(); });
      }));
      status.textContent = t("Running receiving tool…");
      try {
        const response = await executor.invoke({ capabilityId: access.owner.capabilityId, resourceId: access.resourceId,
          contentVersion: access.contentVersion, toolCallId: callId, input: prepared.input });
        if (valid()) {
          result.textContent = chosenProfile === HOST_OCR_INPUT_PROFILE && typeof response.result?.charCount === "number"
            ? t("OCR recognized {count} characters. Review its text resource below to transfer or save.").replace("{count}", response.result.charCount)
            : JSON.stringify(response.result, null, 2);
          status.textContent = t(response.result?.ok === false
            ? "Tool reported an error. Inputs are kept and no result was saved."
            : "Receiving tool finished. Results have not been saved.");
          result.tabIndex = -1; result.focus();
          const token = request;
          const verify = async () => {
            if (!valid() || token !== request) return;
            try {
              await readPluginViewResource({ instance: { plugin: { id: access.owner.pluginId } }, gateway, target: getTarget(),
                isCurrent: () => valid() && token === request,
                params: { capabilityId: access.owner.capabilityId, resourceId: access.resourceId,
                  contentVersion: access.contentVersion, offset: 0, length: 1 } });
              if (valid() && token === request) timer = setTimeout(verify, 5000);
            } catch { if (valid() && token === request) { resetChosen(); error(); } }
          };
          timer = setTimeout(verify, 5000);
        }
        if (valid() && response.result?.ok !== false && onReceiverExecuted) {
          try { await onReceiverExecuted(chosen, getTarget()); }
          catch { if (valid()) status.textContent = t("Tool completed, but history could not be saved."); }
        }
      } catch (failure) { if (valid()) {
        const uncertain = executor.unresolved(callId);
        status.textContent = t(uncertain
          ? "Execution outcome is unknown. Recovery seals an unstarted call or requests cancellation before checking completion."
          : failure?.message === "[resource_journal_pending]" ? "A previous call for this tool still needs recovery. Review tool call records before running again."
          : failure?.message === "[resource_journal_full]" ? "Call recovery records are full. Review or explicitly forget old records before running again."
          : failure?.message === "[resource_journal_unavailable]" ? "Call recovery storage is unavailable. No execution was started. Review existing call records or storage access."
          : failure?.message === "[resource_status_unavailable]" ? "One-use tool calls are unavailable. Update Studio before running this tool." : executionMessage(failure));
        if (uncertain && failure?.message === "[resource_input_invalid]")
          status.textContent += ` ${t("This resource is invalid or exceeds the receiver's format or size limits.")}`;
      } }
      finally {
        running = executor.unresolved(callId);
        if (!running) callId = null;
        if (valid() && running) recoverControls(executor);
        else if (valid()) { form.setDisabled(false); search.disabled = searchButton.disabled = false;
          previous.disabled = page.offset === 0; next.disabled = page.nextOffset === null; list.inert = false;
          controls.replaceChildren(button("Run receiving tool", () => void run())); }
        else revoke(access);
      }
    }
    selection = { dispose() {
      const uncertain = computation?.unresolved(callId);
      disposed = true; request++; searchController?.abort(); searchController = null;
      computation?.destroy(); preview?.destroy(); form?.destroy();
      clearTimeout(timer);
      // Active execution owns this reference until its response/cancellation settles.
      if (!running || uncertain) revoke(reference);
      if (typeof panel.close === "function") panel.close();
      panel.remove();
    } };
    void find(0);
  }
  return { open, clear, destroy() { active = false; clear(); } };
}
