import { t } from "../../i18n.js";
import { createPluginResourceSelection } from "./plugin-resource-selection.js";
import { createPluginResultActions } from "./plugin-result-actions.js";
import { publicViewError } from "./plugin-view-errors.js";
import { readPluginViewResource, resourceViewTarget } from "./plugin-view-resource.js";
import { createResourceComputation } from "./plugin-view-resource-compute.js";
import { createResourcePreview } from "./plugin-resource-preview.js";
import { createResourceTransfer } from "./plugin-resource-transfer.js";
import { createResourceSave } from "./plugin-resource-save.js";

const MESSAGE_NAMESPACE = "zicode-plugin-view";
const MAX_MESSAGE_CHARS = 64 * 1024;
const MAX_ACTIVE_REQUESTS = 32;

export function setupPluginViewHost({
  gateway,
  allowExternalViews = true,
  capabilityGateway = null,
  getTarget = () => null,
  notify = () => {},
  executeCommand = () => {},
  confirmDiscard = (message) => globalThis.confirm?.(message) ?? false,
  confirmModelGeneration = () => false,
} = {}) {
  if (!gateway) return null;

  const instances = new Map();
  const dirtyPlugins = new Set();
  let generation = 0;

  function renderNavigation(container, plugin) {
    renderLocation(container, plugin, "sidebar");
  }

  function renderContent(container, plugin) {
    if (container) container.scrollTop = 0;
    renderLocation(container, plugin, "main");
  }

  function renderLocation(container, plugin, location) {
    if (!container || (plugin?.origin !== "developer" && plugin?.origin !== "signed")) return;
    if (!allowExternalViews) {
      const notice = document.createElement("p");
      notice.className = "plugin-view-empty";
      notice.textContent = t("External plugin views are available in the desktop app.");
      container.append(notice);
      return;
    }
    const views = (plugin.views ?? []).filter(
      (view) => view.location === location && typeof view.entry === "string",
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
        requests: 0,
        sceneId: getTarget()?.sceneId ?? "programming",
        resourceTarget: resourceViewTarget(getTarget()),
        view,
      };
      instances.set(instanceKey, instance);
      container.replaceChildren(iframe);
      if (location === "main" && typeof capabilityGateway?.readResource === "function") {
        const isCurrent = () => instances.get(instanceKey) === instance && iframe.isConnected &&
          instance.resourceTarget === resourceViewTarget(getTarget());
        if (typeof capabilityGateway.prepareResourceTransfer === "function") {
          instance.resourceTransfer = createResourceTransfer({ gateway: capabilityGateway, getTarget, isCurrent,
            onSave: typeof capabilityGateway.prepareResourceSave === "function" ? (...args) => instance.resourceSave?.open(...args) : undefined,
            onSaveClear: () => instance.resourceSave?.clear(),
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
    if (data.type === "ready") {
      post(instance, {
        type: "context",
        context: viewContext(instance),
      });
      return;
    }
    if (data.type === "dirty") {
      if (data.dirty === true) dirtyPlugins.add(instance.plugin.id);
      else dirtyPlugins.delete(instance.plugin.id);
      return;
    }
    if (data.type !== "request" || typeof data.requestId !== "string") return;
    const counter = data.method === "cancelResource" ? "cancelRequests" : "requests";
    const limit = counter === "cancelRequests" ? 2 : MAX_ACTIVE_REQUESTS;
    if ((instance[counter] ?? 0) >= limit) {
      respond(instance, data.requestId, null, "Too many active plugin view requests");
      return;
    }
    instance[counter] = (instance[counter] ?? 0) + 1;
    void handleRequest(instance, data)
      .then((result) => respond(instance, data.requestId, result))
      .catch((error) =>
        respond(instance, data.requestId, null, error ?? new Error("Plugin request failed")),
      )
      .finally(() => {
        instance[counter] = Math.max(0, instance[counter] - 1);
      });
  }

  async function handleRequest(instance, request) {
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
          typeof capabilityGateway?.commitModelGeneration !== "function") {
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
        const owner = { runtimeId: target.instanceId, sessionId: target.sessionId,
          pluginId: instance.plugin.id };
        const preview = await capabilityGateway.prepareModelGeneration(owner, input);
        if (!isCurrent()) throw new Error("Plugin runtime changed");
        const approved = await confirmModelGeneration(preview, instance.plugin.name);
        if (!approved || !isCurrent()) {
          await capabilityGateway.commitModelGeneration(owner, preview.grantId, false).catch(() => {});
          throw Object.assign(new Error("Model request cancelled"), { code: "model_request_cancelled" });
        }
        const result = await capabilityGateway.commitModelGeneration(owner, preview.grantId, true,
          Number(input.deadlineMs) || 30_000);
        if (!isCurrent()) throw new Error("Plugin runtime changed");
        return result;
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
        // The Rust Host is authoritative for current Scene enablement and the
        // plugin's declared capabilities. Keeping this check there avoids a
        // stale frontend Registry snapshot rejecting a newly reloaded Worker.
        const scope = {
          sceneId: getTarget()?.sceneId ?? "programming",
          workspaceId: getTarget()?.workspaceId ?? "",
          pluginId: instance.plugin.id,
          capabilityId,
        };
        const invocation = (instance.invocation ?? 0) + 1;
        instance.invocation = invocation;
        instance.resultActions?.clear();
        const response = await capabilityGateway.invoke(
          scope.sceneId,
          scope.workspaceId,
          instance.plugin.id,
          capabilityId,
          request.params?.input ?? {},
          ...(instance.resultActions ? [{ captureResult: true }] : []),
        );
        if (instance.invocation === invocation) instance.resultActions?.show(response, scope);
        return response?.result;
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
    for (const [key, instance] of instances) {
      if (instance.plugin.id === pluginId) disposeInstance(key);
    }
    dirtyPlugins.delete(pluginId);
  }

  function setTarget() {
    generation += 1;
    for (const key of [...instances.keys()]) disposeInstance(key);
    dirtyPlugins.clear();
  }

  window.addEventListener("message", onMessage);
  return {
    canDeactivate,
    deactivate,
    renderContent,
    renderNavigation,
    setTarget,
    destroy() {
      setTarget();
      window.removeEventListener("message", onMessage);
    },
  };

  function disposeInstance(key) {
    const instance = instances.get(key);
    instance?.resourceComputation?.destroy();
    instance?.resourceTransfer?.destroy();
    instance?.resourceSave?.destroy();
    instance?.resourcePreview?.destroy();
    instance?.resourceSelection?.destroy();
    instance?.resultActions?.destroy();
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

function sandboxBridge(channel) {
  const namespace = "zicode-plugin-view";
  const pending = new Map();
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
  function request(method, params) {
    const cancellation = method === "cancelResource";
    const cancelCount = [...pending.values()].filter((entry) => entry.cancellation).length;
    if (cancellation ? cancelCount >= 2 : pending.size - cancelCount >= 32)
      return Promise.reject(failure("Too many active plugin view requests", "plugin_view_busy"));
    const requestId = `view-${++sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(failure("Plugin view request timed out", "plugin_view_timeout"));
      }, method === "generateModel" ? 150_000 : 30_000);
      pending.set(requestId, { reject, resolve, timeout, cancellation });
      send({ type: "request", requestId, method, params });
    });
  }
  window.addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const message = event.data;
    if (message?.namespace !== namespace || message.channel !== channel) return;
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
    ui: Object.freeze({ showInformation: (message) => request("notify", { message }) }),
    commands: Object.freeze({
      execute: (commandId, args) => request("executeCommand", { commandId, args }),
    }),
    capabilities: Object.freeze({
      invoke: (capabilityId, input = {}) => request("invokeCapability", { capabilityId, input }),
    }),
    services: Object.freeze({
      models: Object.freeze({
        list: (cursor = null) => request("listServiceModels", { cursor }),
        generate: (input) => request("generateModel", input),
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
