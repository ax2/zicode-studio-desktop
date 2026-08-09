import { t } from "../../i18n.js";

const MESSAGE_NAMESPACE = "zicode-plugin-view";
const MAX_MESSAGE_CHARS = 64 * 1024;
const MAX_ACTIVE_REQUESTS = 32;

export function setupPluginViewHost({
  gateway,
  capabilityGateway = null,
  getTarget = () => null,
  notify = () => {},
  executeCommand = () => {},
  confirmDiscard = (message) => globalThis.confirm?.(message) ?? false,
} = {}) {
  if (!gateway) return null;

  const instances = new Map();
  const dirtyPlugins = new Set();
  let generation = 0;

  function renderNavigation(container, plugin) {
    renderLocation(container, plugin, "sidebar");
  }

  function renderContent(container, plugin) {
    renderLocation(container, plugin, "main");
  }

  function renderLocation(container, plugin, location) {
    if (!container || plugin?.origin !== "developer") return;
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
        view,
      };
      instances.set(instanceKey, instance);
      container.replaceChildren(iframe);
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
    if (instance.requests >= MAX_ACTIVE_REQUESTS) {
      respond(instance, data.requestId, null, "Too many active plugin view requests");
      return;
    }
    instance.requests += 1;
    void handleRequest(instance, data)
      .then((result) => respond(instance, data.requestId, result))
      .catch((error) => respond(instance, data.requestId, null, error?.message ?? String(error)))
      .finally(() => {
        instance.requests = Math.max(0, instance.requests - 1);
      });
  }

  async function handleRequest(instance, request) {
    switch (request.method) {
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
        const response = await capabilityGateway.invoke(
          getTarget()?.sceneId ?? "programming",
          getTarget()?.workspaceId ?? "",
          instance.plugin.id,
          capabilityId,
          request.params?.input ?? {},
        );
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
    ...(error ? { error } : { result }),
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
  let resolveContext;
  const context = new Promise((resolve) => {
    resolveContext = resolve;
  });
  function send(message) {
    parent.postMessage({ namespace, channel, ...message }, "*");
  }
  function request(method, params) {
    const requestId = `view-${++sequence}`;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { reject, resolve });
      send({ type: "request", requestId, method, params });
    });
  }
  window.addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const message = event.data;
    if (message?.namespace !== namespace || message.channel !== channel) return;
    if (message.type === "context") {
      resolveContext(message.context);
      window.dispatchEvent(new CustomEvent("zicode:context", { detail: message.context }));
      return;
    }
    if (message.type !== "response") return;
    const operation = pending.get(message.requestId);
    if (!operation) return;
    pending.delete(message.requestId);
    if (message.error) operation.reject(new Error(message.error));
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
  });
  send({ type: "ready" });
}
