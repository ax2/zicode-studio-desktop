import { t } from "../../i18n.js";
import { createPluginResourceSelection } from "./plugin-resource-selection.js";
import { createPluginResultActions } from "./plugin-result-actions.js";
import { publicViewError } from "./plugin-view-errors.js";
import { readPluginViewResource, resourceViewTarget } from "./plugin-view-resource.js";
import { createResourceComputation } from "./plugin-view-resource-compute.js";
import { createResourcePreview } from "./plugin-resource-preview.js";
import { createResourceTransfer } from "./plugin-resource-transfer.js";
import { createResourceSave } from "./plugin-resource-save.js";
import { invokeViewCapability } from "./plugin-view-capability-call.js";
import { createViewCallRecovery } from "./plugin-view-call-recovery.js";

const MESSAGE_NAMESPACE = "zicode-plugin-view";
const MAX_MESSAGE_CHARS = 64 * 1024;
const MAX_ACTIVE_REQUESTS = 32;

export function setupPluginViewHost({
  gateway,
  allowExternalViews = true,
  capabilityGateway = null,
  toolAccessStore = null,
  getTarget = () => null,
  notify = () => {},
  executeCommand = () => {},
  confirmDiscard = (message) => globalThis.confirm?.(message) ?? false,
  confirmModelGeneration = () => false,
  confirmHttpGet = () => false,
} = {}) {
  if (!gateway) return null;

  const instances = new Map();
  const dirtyPlugins = new Set();
  const toolOpenIntents = new Map();
  const recoveryByView = new Map();
  let generation = 0;
  let toolOpenSequence = 0;
  const warnPendingCalls = (event) => {
    if (![...recoveryByView.values()].some(({ calls }) =>
      [...calls.values()].some(call => call.locked))) return;
    event.preventDefault();
    event.returnValue = "";
  };

  function clearToolOpen(pluginId) {
    const intent = toolOpenIntents.get(pluginId);
    if (intent) clearTimeout(intent.timeout);
    toolOpenIntents.delete(pluginId);
  }

  function currentToolOpenTarget(intent) {
    const target = getTarget();
    return intent.sceneId === (target?.sceneId ?? "programming") &&
      intent.resourceTarget === resourceViewTarget(target);
  }

  function deliverToolOpen(instance) {
    const intent = toolOpenIntents.get(instance.plugin.id);
    if (!intent || intent.sent || instance.location !== "main" || !instance.ready) return;
    if (intent.kind === "view-operation" && instance.view.id !== intent.viewId) return;
    if (!currentToolOpenTarget(intent) || intent.sceneId !== instance.sceneId ||
      intent.resourceTarget !== instance.resourceTarget || (intent.isCurrent && !intent.isCurrent())) {
      clearToolOpen(instance.plugin.id);
      return;
    }
    if (intent.pluginVersion !== instance.plugin.version) return;
    intent.sent = true;
    intent.instanceKey = instance.instanceKey;
    post(instance, intent.kind === "view-operation"
      ? { type: "openViewOperation", requestId: intent.requestId, operationId: intent.operationId }
      : { type: "openTool", requestId: intent.requestId, capabilityId: intent.capabilityId });
  }

  function openViewOperation(plugin, operationId, viewId, onOpened, isCurrent = () => true) {
    if (!allowExternalViews) {
      notify(t("External plugin views are available in the desktop app."));
      return false;
    }
    if (!plugin?.viewOperationDirectoryProfile || !plugin.enabled ||
      !(plugin.viewOperations ?? []).some(operation => operation.id === operationId && operation.viewId === viewId) ||
      !(plugin.views ?? []).some(view => view.id === viewId && view.location === "main")) {
      notify(t("This application does not support opening that operation directly."));
      return false;
    }
    const target = getTarget();
    const sceneId = target?.sceneId ?? "programming";
    const resourceTarget = resourceViewTarget(target);
    clearToolOpen(plugin.id);
    const intent = {
      kind: "view-operation", operationId, viewId, pluginVersion: plugin.version,
      sceneId, resourceTarget, onOpened, isCurrent,
      requestId: `view-operation-open-${++toolOpenSequence}`,
      sent: false,
      timeout: setTimeout(() => {
        if (toolOpenIntents.get(plugin.id) !== intent) return;
        const stillCurrent = currentToolOpenTarget(intent) && intent.isCurrent();
        clearToolOpen(plugin.id);
        if (stillCurrent) notify(t("The application did not confirm the requested operation location."));
      }, 5_000),
    };
    toolOpenIntents.set(plugin.id, intent);
    for (const instance of instances.values()) {
      if (instance.plugin.id === plugin.id) deliverToolOpen(instance);
    }
    return true;
  }

  function openTool(plugin, capabilityId, onOpened) {
    if (!allowExternalViews) {
      notify(t("External plugin views are available in the desktop app."));
      return false;
    }
    if (!plugin?.toolOpenProfile || !plugin.enabled ||
      !(plugin.capabilities ?? []).some((capability) => capability.id === capabilityId) ||
      !(plugin.views ?? []).some((view) => view.location === "main")) {
      notify(t("This application does not support opening that tool directly."));
      return false;
    }
    const target = getTarget();
    const sceneId = target?.sceneId ?? "programming";
    const resourceTarget = resourceViewTarget(target);
    clearToolOpen(plugin.id);
    const intent = {
      capabilityId, pluginVersion: plugin.version, sceneId, resourceTarget,
      onOpened,
      requestId: `tool-open-${++toolOpenSequence}`,
      sent: false,
      timeout: setTimeout(() => {
        if (toolOpenIntents.get(plugin.id) !== intent) return;
        const stillCurrent = currentToolOpenTarget(intent);
        clearToolOpen(plugin.id);
        if (stillCurrent) notify(t("The application did not confirm the requested tool location."));
      }, 5_000),
    };
    toolOpenIntents.set(plugin.id, intent);
    for (const instance of instances.values()) {
      if (instance.plugin.id === plugin.id) deliverToolOpen(instance);
    }
    return true;
  }

  function renderNavigation(container, plugin) {
    renderLocation(container, plugin, "sidebar");
  }

  function renderContent(container, plugin, viewId = null) {
    if (container) container.scrollTop = 0;
    if (viewId) {
      for (const [key, instance] of instances) {
        if (instance.plugin.id === plugin?.id && instance.location === "main") disposeInstance(key);
      }
      container?.replaceChildren();
    }
    renderLocation(container, plugin, "main", viewId);
  }

  function renderLocation(container, plugin, location, requestedViewId = null) {
    if (!container || (plugin?.origin !== "developer" && plugin?.origin !== "signed")) return;
    if (!allowExternalViews) {
      const notice = document.createElement("p");
      notice.className = "plugin-view-empty";
      notice.textContent = t("External plugin views are available in the desktop app.");
      container.append(notice);
      return;
    }
    const views = (plugin.views ?? []).filter(
      (view) => view.location === location && typeof view.entry === "string" &&
        (!requestedViewId || view.id === requestedViewId),
    );
    if (location === "main" && views.length > 1) views.splice(1);
    if (!views.length) {
      const empty = document.createElement("p");
      empty.className = "plugin-view-empty";
      empty.textContent = t(
        location === "main"
          ? "This plugin does not contribute a main view."
          : "This plugin does not contribute a function view.",
      );
      container.append(empty);
      return;
    }
    for (const view of views) {
      const frameContainer = document.createElement("section");
      frameContainer.className = `plugin-view-frame-container plugin-view-frame-container--${location}`;
      if (location === "sidebar") {
        const title = document.createElement("h2");
        title.className = "plugin-view-frame-title";
        title.textContent = view.title || view.id;
        frameContainer.append(title);
      }
      const loading = document.createElement("p");
      loading.className = "plugin-view-loading";
      loading.textContent = t("Loading plugin view…");
      frameContainer.append(loading);
      container.append(frameContainer);
      void mount(frameContainer, plugin, view, location);
    }
  }

  async function mount(container, plugin, view, location) {
    const instanceKey = `${plugin.id}:${view.id}:${location}`;
    disposeInstance(instanceKey);
    const mountGeneration = generation;
    try {
      const response = await gateway.viewSource(
        getTarget()?.sceneId ?? "programming",
        plugin.id,
        view.id,
      );
      if (mountGeneration !== generation || !container.isConnected) return;
      const document = response.view;
      if (
        document?.pluginId !== plugin.id ||
        document?.viewId !== view.id ||
        document?.location !== location ||
        typeof document?.html !== "string"
      ) {
        throw new Error(t("Plugin view response did not match its declaration."));
      }
      const inert = globalThis.document.createElement("template");
      inert.innerHTML = document.html;
      if (inert.content.querySelector("script[src], link[rel~='stylesheet'][href]")) {
        throw new Error(t("Plugin view must include its scripts and styles in the HTML file."));
      }
      const channel = crypto.randomUUID();
      const iframe = globalThis.document.createElement("iframe");
      iframe.className = "plugin-view-frame";
      iframe.title = document.title || view.title || plugin.name;
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.setAttribute("referrerpolicy", "no-referrer");
      iframe.dataset.pluginChannel = channel;
      iframe.srcdoc = buildSandboxDocument(document.html, channel);
      const instance = {
        channel,
        iframe,
        instanceKey,
        location,
        plugin,
        catalogRevision: response.catalogRevision,
        requests: 0,
        sceneId: getTarget()?.sceneId ?? "programming",
        resourceTarget: resourceViewTarget(getTarget()),
        view,
      };
      instances.set(instanceKey, instance);
      container.replaceChildren(iframe);
      if (capabilityGateway) {
        const recoveryKey = JSON.stringify([instanceKey, instance.sceneId, instance.resourceTarget]);
        instance.recoveryKey = recoveryKey;
        let recovery = recoveryByView.get(recoveryKey);
        if (!recovery) {
          recovery = { calls: new Map(), listeners: new Set() };
          recoveryByView.set(recoveryKey, recovery);
        }
        instance.callRecovery = createViewCallRecovery({ container, gateway: capabilityGateway,
          isCurrent: () => instances.get(instanceKey) === instance && iframe.isConnected &&
            instance.resourceTarget === resourceViewTarget(getTarget()),
          ...recovery,
        });
      }
      if (location === "main" && typeof capabilityGateway?.readResource === "function") {
        const isCurrent = () => instances.get(instanceKey) === instance && iframe.isConnected &&
          instance.resourceTarget === resourceViewTarget(getTarget());
        if (typeof capabilityGateway.prepareResourceTransfer === "function") {
          instance.resourceTransfer = createResourceTransfer({ gateway: capabilityGateway, getTarget, isCurrent,
            onSave: typeof capabilityGateway.prepareResourceSave === "function" ? (...args) => instance.resourceSave?.open(...args) : undefined,
            onSaveClear: () => instance.resourceSave?.clear(),
            onReceiverExecuted: toolAccessStore ? async (tool, currentTarget) => {
              if (!isCurrent() || !tool?.accessId || !currentTarget?.workspaceId) return;
              await toolAccessStore.mutate({ sceneId: currentTarget.sceneId ?? "programming", workspaceId: currentTarget.workspaceId },
                { kind: "recentRecord", id: tool.accessId });
            } : undefined,
          });
        }
        if (typeof capabilityGateway.prepareResourceSave === "function") {
          instance.resourceSave = createResourceSave({ gateway: capabilityGateway, getTarget, isCurrent, notify });
        }
        instance.resourcePreview = createResourcePreview({ container, plugin, isCurrent,
          onTransfer: instance.resourceTransfer ? (...args) => instance.resourceTransfer.open(...args) : undefined,
          onSave: instance.resourceSave ? (...args) => instance.resourceSave.open(...args) : undefined,
          onClear: () => { instance.resourceTransfer?.clear(); instance.resourceSave?.clear(); },
          read: (owner, resource, offset, length, valid) => readPluginViewResource({ instance,
            gateway: capabilityGateway, target: getTarget(), isCurrent: () => isCurrent() && valid(),
            params: { capabilityId: owner.capabilityId, resourceId: resource.resourceId,
              contentVersion: resource.contentVersion, offset, length } }),
        });
      }
      if (
        location === "main" &&
        plugin.permissions?.["resource.read"] === true &&
        getTarget()?.instanceId &&
        getTarget()?.sessionId &&
        typeof capabilityGateway?.prepareResource === "function"
      ) {
        instance.resourceSelection = createPluginResourceSelection({
          container,
          plugin,
          target: getTarget(),
          gateway: capabilityGateway,
          isCurrent: () =>
            instances.get(instanceKey) === instance &&
            iframe.isConnected &&
            instance.resourceTarget === resourceViewTarget(getTarget()),
          onResource: (resource) => { if (!resource) instance.resourcePreview?.clear(); post(instance, { type: "resource", resource }); },
        });
      }
      if (typeof capabilityGateway?.prepareSave === "function") {
        instance.resultActions = createPluginResultActions({
          container,
          gateway: capabilityGateway,
          isCurrent: (scope) =>
            instances.get(instanceKey) === instance &&
            container.isConnected &&
            scope?.workspaceId === (getTarget()?.workspaceId ?? "") &&
            scope?.sceneId === (getTarget()?.sceneId ?? "programming"),
        });
      }
    } catch (error) {
      if (mountGeneration !== generation || !container.isConnected) return;
      if (location === "main") {
        const intent = toolOpenIntents.get(plugin.id);
        if (intent?.sceneId === (getTarget()?.sceneId ?? "programming") &&
          intent.resourceTarget === resourceViewTarget(getTarget())) clearToolOpen(plugin.id);
      }
      const panel = document.createElement("div");
      panel.className = "plugin-view-error";
      const title = document.createElement("strong");
      title.textContent = t("Plugin view could not be loaded");
      const detail = document.createElement("p");
      detail.textContent = error?.message ?? String(error);
      panel.append(title, detail);
      container.replaceChildren(panel);
    }
  }

  function onMessage(event) {
    const data = event.data;
    if (
      !data ||
      data.namespace !== MESSAGE_NAMESPACE ||
      typeof data.channel !== "string" ||
      !safeMessageSize(data)
    ) {
      return;
    }
    const instance = [...instances.values()].find(
      (candidate) =>
        candidate.channel === data.channel && candidate.iframe.contentWindow === event.source,
    );
    if (!instance) return;
    if (instance.resourceTarget !== resourceViewTarget(getTarget())) {
      if (data.type === "cancelRequest" && typeof data.requestId === "string") {
        void instance.requestCancellations?.get(data.requestId)?.();
      } else if (data.type === "request" && typeof data.requestId === "string") {
        respond(instance, data.requestId, null,
          data.method === "readResource" ? "[resource_view_changed]" : new Error("Plugin runtime changed"));
      } else if (data.type === "openToolResult" || data.type === "openViewOperationResult") {
        const intent = toolOpenIntents.get(instance.plugin.id);
        if (intent?.requestId === data.requestId && intent.instanceKey === instance.instanceKey &&
          (intent.kind === "view-operation") === (data.type === "openViewOperationResult")) {
          clearToolOpen(instance.plugin.id);
        }
      }
      return;
    }
    if (data.type === "ready") {
      instance.ready = true;
      post(instance, {
        type: "context",
        context: viewContext(instance),
      });
      deliverToolOpen(instance);
      return;
    }
    if (data.type === "openToolResult" || data.type === "openViewOperationResult") {
      const intent = toolOpenIntents.get(instance.plugin.id);
      if (!intent || intent.requestId !== data.requestId || intent.instanceKey !== instance.instanceKey ||
        intent.pluginVersion !== instance.plugin.version ||
        (intent.kind === "view-operation") !== (data.type === "openViewOperationResult")) return;
      clearToolOpen(instance.plugin.id);
      if (!currentToolOpenTarget(intent) || (intent.isCurrent && !intent.isCurrent())) return;
      if (data.status === "opened") {
        try { intent.onOpened?.(); } catch { /* A history callback must not disrupt the View. */ }
      } else notify(t(intent.kind === "view-operation"
        ? "The application did not confirm the requested operation location."
        : "The application did not confirm the requested tool location."));
      return;
    }
    if (data.type === "dirty") {
      if (data.dirty === true) dirtyPlugins.add(instance.plugin.id);
      else dirtyPlugins.delete(instance.plugin.id);
      return;
    }
    if (data.type === "cancelRequest" && typeof data.requestId === "string") {
      void instance.requestCancellations?.get(data.requestId)?.();
      return;
    }
    if (data.type !== "request" || typeof data.requestId !== "string") return;
    // A second frame with the same live ID must not start another operation or
    // replace the first operation's cancellation handle.
    if (instance.activeRequestIds?.has(data.requestId)) return;
    const counter = data.method === "cancelResource" ? "cancelRequests" : "requests";
    const limit = counter === "cancelRequests" ? 2 : MAX_ACTIVE_REQUESTS;
    if ((instance[counter] ?? 0) >= limit) {
      respond(instance, data.requestId, null, "Too many active plugin view requests");
      return;
    }
    instance[counter] = (instance[counter] ?? 0) + 1;
    instance.activeRequestIds ??= new Set();
    instance.activeRequestIds.add(data.requestId);
    const requestState = ["generateModel", "httpGet", "invokeCapability"].includes(data.method)
      ? { cancel: null, cancelled: false } : null;
    if (requestState) {
      instance.requestCancellations ??= new Map();
      instance.requestCancellations.set(data.requestId, async () => {
        await requestState.cancel?.();
      });
    }
    void handleRequest(instance, data, requestState)
      .then((result) => respond(instance, data.requestId, result))
      .catch((error) =>
        respond(instance, data.requestId, null, error ?? new Error("Plugin request failed")),
      )
      .finally(() => {
        instance.requestCancellations?.delete(data.requestId);
        instance.activeRequestIds?.delete(data.requestId);
        instance[counter] = Math.max(0, instance[counter] - 1);
      });
  }

  async function handleRequest(instance, request, requestState = null) {
    switch (request.method) {
      case "invokeResource":
      case "cancelResource": {
        instance.resourceComputation ??= createResourceComputation({
          instance,
          gateway: capabilityGateway,
          getTarget,
          isCurrent: () =>
            instances.get(instance.instanceKey) === instance && instance.iframe.isConnected,
          onOutputs: (resources, owner) => instance.resourcePreview?.show(resources, owner),
        });
        return request.method === "invokeResource"
          ? instance.resourceComputation.invoke(request.params)
          : instance.resourceComputation.cancel(request.params);
      }
      case "readResource":
        return readPluginViewResource({
          instance,
          gateway: capabilityGateway,
          target: getTarget(),
          params: request.params,
          isCurrent: () =>
            instances.get(instance.instanceKey) === instance &&
            instance.iframe.isConnected &&
            instance.resourceTarget === resourceViewTarget(getTarget()),
        });
      case "listServiceModels": {
        if (typeof capabilityGateway?.listServiceModels !== "function") {
          throw new Error("Plugin model catalog is unavailable");
        }
        const target = getTarget();
        if (
          instances.get(instance.instanceKey) !== instance ||
          !instance.iframe.isConnected ||
          instance.resourceTarget !== resourceViewTarget(target) ||
          !target?.instanceId ||
          !target?.sessionId
        ) {
          throw new Error("Plugin runtime changed");
        }
        const cursor = request.params?.cursor ?? null;
        if (cursor !== null && (typeof cursor !== "string" || !/^\d{1,4}$/.test(cursor))) {
          throw new Error("Model catalog cursor is invalid");
        }
        return capabilityGateway.listServiceModels({
          runtimeId: target.instanceId,
          sessionId: target.sessionId,
          pluginId: instance.plugin.id,
        }, cursor);
      }
      case "generateModel": {
        if (typeof capabilityGateway?.prepareModelGeneration !== "function" ||
          typeof capabilityGateway?.commitModelGeneration !== "function" ||
          typeof capabilityGateway?.cancelModelGeneration !== "function") {
          throw new Error("Plugin model generation is unavailable");
        }
        const target = getTarget();
        const isCurrent = () => instances.get(instance.instanceKey) === instance &&
          instance.iframe.isConnected && instance.resourceTarget === resourceViewTarget(getTarget());
        if (!isCurrent() || !target?.instanceId || !target?.sessionId) {
          throw new Error("Plugin runtime changed");
        }
        const input = request.params;
        if (!input || typeof input !== "object" || typeof input.modelRef !== "string" ||
          typeof input.goal !== "string" || !Array.isArray(input.materials)) {
          throw new Error("Model generation input is invalid");
        }
        const owner = { workspaceId: target.workspaceId, runtimeId: target.instanceId,
          sessionId: target.sessionId, pluginId: instance.plugin.id };
        const operationId = crypto.randomUUID();
        let cancellationRequested = false;
        let prepared = false;
        let dismissConfirmation;
        const confirmationDismissed = new Promise((resolve) => { dismissConfirmation = resolve; });
        requestState.cancel = async () => {
          cancellationRequested = true;
          dismissConfirmation();
          if (prepared) {
            await capabilityGateway.cancelModelGeneration(owner, operationId).catch(() => {});
          }
        };
        const preview = await capabilityGateway.prepareModelGeneration(owner, input, operationId);
        prepared = true;
        if (preview?.operationId !== operationId) {
          await capabilityGateway.commitModelGeneration(owner, preview?.grantId, false,
            Number(input.deadlineMs) || 30_000, operationId).catch(() => {});
          throw new Error("Model operation identity did not match");
        }
        if (!isCurrent()) {
          await capabilityGateway.commitModelGeneration(owner, preview.grantId, false,
            Number(input.deadlineMs) || 30_000, operationId).catch(() => {});
          throw new Error("Plugin runtime changed");
        }
        if (cancellationRequested) {
          await capabilityGateway.commitModelGeneration(owner, preview.grantId, false,
            Number(input.deadlineMs) || 30_000, operationId).catch(() => {});
          throw Object.assign(new Error("Model request cancelled"), { code: "model_request_cancelled" });
        }
        const approved = await confirmModelGeneration(preview, instance.plugin.name, confirmationDismissed);
        if (cancellationRequested) {
          await capabilityGateway.commitModelGeneration(owner, preview.grantId, false,
            Number(input.deadlineMs) || 30_000, operationId).catch(() => {});
          throw Object.assign(new Error("Model request cancelled"), { code: "model_request_cancelled" });
        }
        if (!approved || !isCurrent()) {
          await capabilityGateway.commitModelGeneration(owner, preview.grantId, false,
            Number(input.deadlineMs) || 30_000, operationId).catch(() => {});
          throw Object.assign(new Error("Model request cancelled"), { code: "model_request_cancelled" });
        }
        instance.resultActions?.clear();
        const response = await capabilityGateway.commitModelGeneration(owner, preview.grantId, true,
          Number(input.deadlineMs) || 30_000, operationId);
        if (!isCurrent()) throw new Error("Plugin runtime changed");
        const scope = {
          workspaceId: target.workspaceId,
          sceneId: target.sceneId ?? "programming",
          pluginId: instance.plugin.id,
          capabilityId: "model.generate.v1",
        };
        if (response?.resultRef) instance.resultActions?.show(response, scope);
        const viewResponse = { ...(response ?? {}) };
        delete viewResponse.resultRef;
        delete viewResponse.resultCaptureError;
        return viewResponse;
      }
      case "httpGet": {
        if (typeof capabilityGateway?.prepareHttpGet !== "function" ||
          typeof capabilityGateway?.commitHttpGet !== "function" ||
          typeof capabilityGateway?.cancelHttpGet !== "function") {
          throw new Error("Plugin HTTP service is unavailable");
        }
        if (instance.plugin.permissions?.["service.http.read"] !== true) {
          throw Object.assign(new Error("Grant service.http.read permission before using this service."), {
            code: "permission_denied",
          });
        }
        const target = getTarget();
        const isCurrent = () => instances.get(instance.instanceKey) === instance &&
          instance.iframe.isConnected && instance.resourceTarget === resourceViewTarget(getTarget());
        const input = request.params;
        if (!isCurrent() || !target?.instanceId || !target?.sessionId ||
          !input || typeof input !== "object" || Array.isArray(input) ||
          typeof input.origin !== "string" || input.origin.length > 2048 ||
          !["health", "info", "metrics"].includes(input.endpoint)) {
          throw new Error("Plugin HTTP service input is invalid");
        }
        const owner = { workspaceId: target.workspaceId, runtimeId: target.instanceId,
          sessionId: target.sessionId, pluginId: instance.plugin.id };
        const operationId = crypto.randomUUID();
        let cancellationRequested = false;
        let prepared = false;
        let dismissConfirmation;
        const confirmationDismissed = new Promise((resolve) => { dismissConfirmation = resolve; });
        requestState.cancel = async () => {
          cancellationRequested = true;
          dismissConfirmation();
          if (prepared) await capabilityGateway.cancelHttpGet(owner, operationId).catch(() => {});
        };
        const preview = await capabilityGateway.prepareHttpGet(owner, input, operationId);
        prepared = true;
        const decline = async () => capabilityGateway.commitHttpGet(
          owner, preview?.grantId, false, operationId,
        ).catch(() => {});
        if (preview?.operationId !== operationId || typeof preview?.grantId !== "string") {
          await decline();
          throw new Error("HTTP service operation identity did not match");
        }
        if (cancellationRequested || !isCurrent()) {
          await decline();
          throw Object.assign(new Error("HTTP service request cancelled"), { code: "http_service_request_cancelled" });
        }
        const approved = await confirmHttpGet(preview, instance.plugin.name, confirmationDismissed);
        if (cancellationRequested || !approved || !isCurrent()) {
          await decline();
          throw Object.assign(new Error("HTTP service request cancelled"), { code: "http_service_request_cancelled" });
        }
        instance.resultActions?.clear();
        const response = await capabilityGateway.commitHttpGet(owner, preview.grantId, true, operationId);
        if (!isCurrent()) throw new Error("Plugin runtime changed");
        const scope = { workspaceId: target.workspaceId, sceneId: target.sceneId ?? "programming",
          pluginId: instance.plugin.id, capabilityId: "service.http.get.v1" };
        if (response?.resultRef) instance.resultActions?.show(response, scope);
        const viewResponse = { ...(response ?? {}) };
        delete viewResponse.resultRef;
        delete viewResponse.resultCaptureError;
        return viewResponse;
      }
      case "notify": {
        const message = request.params?.message;
        if (typeof message !== "string" || !message.trim() || message.length > 1_000) {
          throw new Error("Plugin notification is invalid");
        }
        notify(message.trim());
        return true;
      }
      case "executeCommand": {
        const commandId = request.params?.commandId;
        if (
          typeof commandId !== "string" ||
          !(instance.plugin.commands ?? []).some((command) => command.id === commandId)
        ) {
          throw new Error("Plugin command is not declared");
        }
        return executeCommand(commandId, request.params?.args);
      }
      case "invokeCapability": {
        if (!capabilityGateway) throw new Error("Plugin capability gateway is unavailable");
        const capabilityId = request.params?.capabilityId;
        if (typeof capabilityId !== "string" || !capabilityId.trim()) {
          throw new Error("Plugin capability identifier is invalid");
        }
        instance.activeCapabilityIds ??= new Set();
        if (instance.activeCapabilityIds.has(capabilityId)) {
          throw Object.assign(new Error("Plugin call is running"), { code: "plugin_call_budget_exceeded" });
        }
        if (instance.callRecovery?.locked(capabilityId)) {
          throw Object.assign(new Error("Plugin call outcome is unknown"), { code: "view_call_outcome_unknown" });
        }
        const isCurrent = () => instances.get(instance.instanceKey) === instance &&
          instance.iframe.isConnected && instance.resourceTarget === resourceViewTarget(getTarget());
        if (!isCurrent()) throw new Error("Plugin runtime changed");
        instance.activeCapabilityIds.add(capabilityId);
        instance.callRecovery?.clearSettled(capabilityId);
        // The Rust Host is authoritative for current Scene enablement and the
        // plugin's declared capabilities. Keeping this check there avoids a
        // stale frontend Registry snapshot rejecting a newly reloaded Worker.
        const target = getTarget();
        const scope = {
          sceneId: target?.sceneId ?? "programming",
          workspaceId: target?.workspaceId ?? "",
          pluginId: instance.plugin.id,
          capabilityId,
        };
        const invocation = (instance.invocation ?? 0) + 1;
        instance.invocation = invocation;
        instance.resultActions?.clear();
        try {
          const response = await invokeViewCapability({
            gateway: capabilityGateway,
            scope,
            input: request.params?.input ?? {},
            captureResult: Boolean(instance.resultActions),
            pluginVersion: instance.plugin.version,
            boundRevision: instance.catalogRevision,
            cancelRequired: request.params?.cancelRequired === true,
            requestState,
            isCurrent,
            onIssued: (call) => instance.callRecovery?.issued(call),
            onDelivered: (call) => instance.callRecovery?.delivered(call),
            onUncertain: (call) => instance.callRecovery?.uncertain(call),
          });
          if (!isCurrent()) throw new Error("Plugin runtime changed");
          if (instance.invocation === invocation) instance.resultActions?.show(response, scope);
          return response?.result;
        } finally {
          instance.activeCapabilityIds.delete(capabilityId);
        }
      }
      case "getContext":
        return viewContext(instance);
      default:
        throw new Error("Unsupported plugin view request");
    }
  }

  async function canDeactivate(pluginId) {
    if (!dirtyPlugins.has(pluginId)) return true;
    const discard = await confirmDiscard(t("Discard unsaved plugin changes?"));
    if (discard) dirtyPlugins.delete(pluginId);
    return discard;
  }

  function deactivate(pluginId) {
    clearToolOpen(pluginId);
    for (const [key, instance] of instances) {
      if (instance.plugin.id === pluginId) disposeInstance(key);
    }
    dirtyPlugins.delete(pluginId);
  }

  function setTarget() {
    generation += 1;
    for (const pluginId of toolOpenIntents.keys()) clearToolOpen(pluginId);
    for (const key of [...instances.keys()]) disposeInstance(key);
    dirtyPlugins.clear();
  }

  window.addEventListener("message", onMessage);
  window.addEventListener("beforeunload", warnPendingCalls);
  return {
    canDeactivate,
    deactivate,
    openTool,
    openViewOperation,
    renderContent,
    renderNavigation,
    setTarget,
    destroy() {
      setTarget();
      recoveryByView.clear();
      window.removeEventListener("message", onMessage);
      window.removeEventListener("beforeunload", warnPendingCalls);
    },
  };

  function disposeInstance(key) {
    const instance = instances.get(key);
    for (const cancel of instance?.requestCancellations?.values() ?? []) void cancel();
    instance?.resourceComputation?.destroy();
    instance?.resourceTransfer?.destroy();
    instance?.resourceSave?.destroy();
    instance?.resourcePreview?.destroy();
    instance?.resourceSelection?.destroy();
    instance?.resultActions?.destroy();
    instance?.callRecovery?.destroy();
    if (instance?.recoveryKey && recoveryByView.get(instance.recoveryKey)?.calls.size === 0)
      recoveryByView.delete(instance.recoveryKey);
    instance?.iframe.remove();
    instances.delete(key);
  }
}

function viewContext(instance) {
  return {
    apiVersion: "1.0",
    locale: document.documentElement.lang || "en",
    pluginId: instance.plugin.id,
    pluginVersion: instance.plugin.version,
    sceneId: instance.sceneId,
    theme: document.documentElement.dataset.theme || "system",
    viewId: instance.view.id,
    viewLocation: instance.location,
  };
}

function respond(instance, requestId, result, error = null) {
  post(instance, {
    type: "response",
    requestId,
    ...(error ? publicViewError(error) : { result }),
  });
}

function post(instance, message) {
  instance.iframe.contentWindow?.postMessage(
    {
      namespace: MESSAGE_NAMESPACE,
      channel: instance.channel,
      ...message,
    },
    "*",
  );
}

function safeMessageSize(value) {
  try {
    return JSON.stringify(value).length <= MAX_MESSAGE_CHARS;
  } catch {
    return false;
  }
}

function buildSandboxDocument(pluginHtml, channel) {
  const csp =
    "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; " +
    "style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; " +
    "frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'";
  const bridge = `(${sandboxBridge.toString()})(${JSON.stringify(channel)});`;
  const prefix = [
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<script>${bridge}</script>`,
  ].join("");
  const head = /<head(?:\s[^>]*)?>/i;
  if (head.test(pluginHtml)) return pluginHtml.replace(head, (match) => `${match}${prefix}`);
  const html = /<html(?:\s[^>]*)?>/i;
  if (html.test(pluginHtml)) {
    return pluginHtml.replace(html, (match) => `${match}<head>${prefix}</head>`);
  }
  return `<!doctype html><html><head>${prefix}</head><body>${pluginHtml}</body></html>`;
}

export function sandboxBridge(channel) {
  const namespace = "zicode-plugin-view";
  const pending = new Map();
  const pendingToolOpens = new Map();
  const pendingViewOperationOpens = new Map();
  let toolOpenHandler = null;
  let viewOperationOpenHandler = null;
  let sequence = 0;
  let selectedResource = null;
  function failure(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
  let resolveContext;
  const context = new Promise((resolve) => {
    resolveContext = resolve;
  });
  function send(message) {
    parent.postMessage({ namespace, channel, ...message }, "*");
  }
  function request(method, params, options = {}) {
    const signal = options?.signal;
    if (signal && (typeof signal.addEventListener !== "function" ||
      typeof signal.aborted !== "boolean")) {
      return Promise.reject(failure("Plugin request cancellation signal is invalid", "plugin_request_invalid"));
    }
    if (signal?.aborted) {
      return Promise.reject(failure("Plugin request cancelled",
        method === "httpGet" ? "http_service_request_cancelled"
          : method === "invokeCapability" ? "plugin_capability_cancelled" : "model_request_cancelled"));
    }
    const cancellation = method === "cancelResource";
    const cancelCount = [...pending.values()].filter((entry) => entry.cancellation).length;
    if (cancellation ? cancelCount >= 2 : pending.size - cancelCount >= 32)
      return Promise.reject(failure("Too many active plugin view requests", "plugin_view_busy"));
    const requestId = `view-${++sequence}`;
    return new Promise((resolve, reject) => {
      const cancellable = method === "generateModel" || method === "httpGet" || method === "invokeCapability";
      let cancellationSent = false;
      const cancelRequest = () => {
        if (!cancellable || cancellationSent) return;
        cancellationSent = true;
        send({ type: "cancelRequest", requestId });
      };
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        if (operation.onAbort) signal?.removeEventListener("abort", operation.onAbort);
        cancelRequest();
        reject(failure("Plugin view request timed out", "plugin_view_timeout"));
      }, method === "generateModel" ? 255_000 : method === "httpGet" ? 75_000 : 30_000);
      const onAbort = cancellable && signal ? cancelRequest : null;
      const operation = { reject, resolve, timeout, cancellation, onAbort, signal };
      pending.set(requestId, operation);
      send({ type: "request", requestId, method, params });
      if (onAbort) {
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }
    });
  }
  function finishToolOpen(requestId, status) {
    const operation = pendingToolOpens.get(requestId);
    if (!operation) return;
    clearTimeout(operation.timeout);
    pendingToolOpens.delete(requestId);
    send({ type: "openToolResult", requestId, status });
  }
  function dispatchToolOpen(requestId) {
    const operation = pendingToolOpens.get(requestId);
    if (!operation || operation.started || !toolOpenHandler) return;
    operation.started = true;
    Promise.resolve().then(() => toolOpenHandler(Object.freeze({ capabilityId: operation.capabilityId })))
      .then((status) => finishToolOpen(requestId, ["opened", "not_found", "unsupported"].includes(status)
        ? status : "unsupported"))
      .catch(() => finishToolOpen(requestId, "unsupported"));
  }
  function finishViewOperationOpen(requestId, status) {
    const operation = pendingViewOperationOpens.get(requestId);
    if (!operation) return;
    clearTimeout(operation.timeout);
    pendingViewOperationOpens.delete(requestId);
    send({ type: "openViewOperationResult", requestId, status });
  }
  function dispatchViewOperationOpen(requestId) {
    const operation = pendingViewOperationOpens.get(requestId);
    if (!operation || operation.started || !viewOperationOpenHandler) return;
    operation.started = true;
    Promise.resolve().then(() => viewOperationOpenHandler(Object.freeze({ operationId: operation.operationId })))
      .then(status => finishViewOperationOpen(requestId, ["opened", "not_found", "unsupported"].includes(status)
        ? status : "unsupported"))
      .catch(() => finishViewOperationOpen(requestId, "unsupported"));
  }
  window.addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const message = event.data;
    if (message?.namespace !== namespace || message.channel !== channel) return;
    if (message.type === "openTool") {
      if (typeof message.requestId !== "string" || message.requestId.length > 128 ||
        typeof message.capabilityId !== "string" || !message.capabilityId || message.capabilityId.length > 256 ||
        pendingToolOpens.size >= 8 || pendingToolOpens.has(message.requestId)) return;
      pendingToolOpens.set(message.requestId, {
        capabilityId: message.capabilityId,
        started: false,
        timeout: setTimeout(() => finishToolOpen(message.requestId, "unsupported"), 4_000),
      });
      dispatchToolOpen(message.requestId);
      return;
    }
    if (message.type === "openViewOperation") {
      if (typeof message.requestId !== "string" || message.requestId.length > 128 ||
        typeof message.operationId !== "string" || !message.operationId || message.operationId.length > 256 ||
        pendingViewOperationOpens.size >= 8 || pendingViewOperationOpens.has(message.requestId)) return;
      pendingViewOperationOpens.set(message.requestId, {
        operationId: message.operationId,
        started: false,
        timeout: setTimeout(() => finishViewOperationOpen(message.requestId, "unsupported"), 4_000),
      });
      dispatchViewOperationOpen(message.requestId);
      return;
    }
    if (message.type === "resource") {
      selectedResource = message.resource ? Object.freeze({ ...message.resource }) : null;
      window.dispatchEvent(new CustomEvent("zicode:resource", { detail: selectedResource }));
      return;
    }
    if (message.type === "context") {
      resolveContext(message.context);
      window.dispatchEvent(new CustomEvent("zicode:context", { detail: message.context }));
      return;
    }
    if (message.type !== "response") return;
    const operation = pending.get(message.requestId);
    if (!operation) return;
    pending.delete(message.requestId);
    clearTimeout(operation.timeout);
    if (operation.onAbort) {
      // The signal belongs to this operation and remains private to the plugin frame.
      operation.signal?.removeEventListener("abort", operation.onAbort);
    }
    if (message.error)
      operation.reject(
        failure(
          message.error,
          typeof message.errorCode === "string" && /^[a-z_]{1,64}$/.test(message.errorCode)
            ? message.errorCode
            : "plugin_request_failed",
        ),
      );
    else operation.resolve(message.result);
  });
  window.zicode = Object.freeze({
    ready: () => context,
    setDirty: (dirty) => send({ type: "dirty", dirty: dirty === true }),
    context: Object.freeze({ get: () => request("getContext") }),
    navigation: Object.freeze({
      onOpenTool: (handler) => {
        if (typeof handler !== "function") throw new TypeError("Tool open handler must be a function");
        toolOpenHandler = handler;
        for (const requestId of pendingToolOpens.keys()) dispatchToolOpen(requestId);
        return { dispose: () => { if (toolOpenHandler === handler) toolOpenHandler = null; } };
      },
      onOpenViewOperation: (handler) => {
        if (typeof handler !== "function") throw new TypeError("View operation open handler must be a function");
        viewOperationOpenHandler = handler;
        for (const requestId of pendingViewOperationOpens.keys()) dispatchViewOperationOpen(requestId);
        return { dispose: () => { if (viewOperationOpenHandler === handler) viewOperationOpenHandler = null; } };
      },
    }),
    ui: Object.freeze({ showInformation: (message) => request("notify", { message }) }),
    commands: Object.freeze({
      execute: (commandId, args) => request("executeCommand", { commandId, args }),
    }),
    capabilities: Object.freeze({
      invoke: (capabilityId, input = {}, options = {}) => request("invokeCapability",
        { capabilityId, input, cancelRequired: Boolean(options?.signal) }, options),
    }),
    services: Object.freeze({
      models: Object.freeze({
        list: (cursor = null) => request("listServiceModels", { cursor }),
        generate: (input, options = {}) => request("generateModel", input, options),
      }),
      http: Object.freeze({
        get: (input, options = {}) => request("httpGet", input, options),
      }),
    }),
    resources: Object.freeze({
      invoke: (options) => request("invokeResource", options),
      cancel: (toolCallId) => request("cancelResource", { toolCallId }),
      read: (options) => request("readResource", options),
      getSelected: () => selectedResource,
      onAvailable: (listener) => {
        const handler = (event) => listener(event.detail);
        window.addEventListener("zicode:resource", handler);
        return { dispose: () => window.removeEventListener("zicode:resource", handler) };
      },
    }),
  });
  send({ type: "ready" });
}
