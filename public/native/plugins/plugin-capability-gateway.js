import { createSavedOutputGateway } from "./saved-output-gateway.js";
import { createResourceCallJournal } from "./resource-call-journal.js";
const DEFAULT_TIMEOUT_MS = 30_000;

export class PluginCapabilityGateway {
  #fetch;
  #location;
  #timeoutMs;

  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    location = globalThis.location,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pickProjectFile = globalThis.__TAURI__?.core?.invoke
      ? workspaceId => globalThis.__TAURI__.core.invoke("select_project_resource_file", { workspaceId })
      : null,
    getProjectFileEntry = globalThis.__TAURI__?.core?.invoke
      ? workspaceId => globalThis.__TAURI__.core.invoke("get_project_resource_entry", { workspaceId })
      : null,
    getProjectFileEntries = globalThis.__TAURI__?.core?.invoke
      ? workspaceId => globalThis.__TAURI__.core.invoke("get_project_resource_entries", { workspaceId })
      : null,
    pickProjectDirectory = globalThis.__TAURI__?.core?.invoke
      ? workspaceId => globalThis.__TAURI__.core.invoke("select_project_resource_directory", { workspaceId })
      : null,
    getProjectDirectoryEntry = globalThis.__TAURI__?.core?.invoke
      ? workspaceId => globalThis.__TAURI__.core.invoke("get_project_directory_entry", { workspaceId })
      : null,
  } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new Error("Plugin capability gateway requires fetch");
    }
    this.#fetch = fetchImpl;
    this.#location = location;
    this.#timeoutMs = timeoutMs;
    this.savedOutputs = createSavedOutputGateway({ fetchImpl, location, timeoutMs });
    this.resourceCalls = createResourceCallJournal();
    this.projectFiles = typeof pickProjectFile === "function" ? {
      choose: pickProjectFile,
      entry: getProjectFileEntry,
      entries: getProjectFileEntries,
      prepare: (owner, relativePath) => this.#request(this.#url("/v2/plugin-resources/prepare-local-file"), { method: "POST", body: JSON.stringify({ schemaVersion: 1, owner, relativePath }) }),
      commit: (owner, grantId) => this.#request(this.#url("/v2/plugin-resources/commit-local-file"), { method: "POST", body: JSON.stringify({ schemaVersion: 1, owner, grantId, confirmed: true }) }),
      cancel: (owner, grantId) => this.#request(this.#url("/v2/plugin-resources/cancel-local-file"), { method: "POST", body: JSON.stringify({ schemaVersion: 1, owner, grantId }) }),
      status: (owner, grantId) => this.#request(this.#url("/v2/plugin-resources/status-local-file"), { method: "POST", body: JSON.stringify({ schemaVersion: 1, owner, grantId }) }),
    } : null;
    this.projectDirectories = typeof pickProjectDirectory === "function" ? {
      choose: pickProjectDirectory,
      entry: getProjectDirectoryEntry,
      prepare: (owner, relativePath) => this.#request(this.#url("/v2/plugin-resources/prepare-local-directory"), { method: "POST", body: JSON.stringify({ schemaVersion: 1, owner, relativePath }) }),
      commit: (owner, grantId) => this.#request(this.#url("/v2/plugin-resources/commit-local-directory"), { method: "POST", body: JSON.stringify({ schemaVersion: 1, owner, grantId, confirmed: true }) }),
      cancel: (owner, grantId) => this.#request(this.#url("/v2/plugin-resources/cancel-local-directory"), { method: "POST", body: JSON.stringify({ schemaVersion: 1, owner, grantId }) }),
    } : null;
  }

  list(sceneId) {
    const url = this.#url("/v2/plugin-capabilities");
    url.searchParams.set("sceneId", sceneId);
    return this.#request(url);
  }

  searchTools(sceneId, { query = "", offset = 0, revision = null, view = "all", workspaceId, accessRevision = null, pluginId, categoryId, resourceOnly = false, directoryOnly = false, fileName, selectedFileCount, fileNames } = {}) {
    const url = this.#url("/v2/plugin-tool-directory");
    url.searchParams.set("sceneId", sceneId);
    url.searchParams.set("query", query);
    url.searchParams.set("offset", String(offset));
    if (revision !== null) url.searchParams.set("revision", revision);
    if (pluginId) url.searchParams.set("pluginId", pluginId);
    if (categoryId) url.searchParams.set("categoryId", categoryId);
    if (resourceOnly) url.searchParams.set("resourceOnly", "true");
    if (directoryOnly) url.searchParams.set("directoryOnly", "true");
    if (resourceOnly && fileName) url.searchParams.set("fileName", fileName);
    if (resourceOnly && selectedFileCount !== undefined) url.searchParams.set("selectedFileCount", String(selectedFileCount));
    if (resourceOnly && fileNames) url.searchParams.set("fileNames", JSON.stringify(fileNames));
    if (view !== "all") {
      url.searchParams.set("view", view);
      if (workspaceId) url.searchParams.set("workspaceId", workspaceId);
      if (accessRevision !== null) url.searchParams.set("accessRevision", String(accessRevision));
    }
    return this.#request(url);
  }

  loadTool(sceneId, { pluginId, capabilityId, revision }) {
    const url = this.#url("/v2/plugin-tool-directory/detail");
    url.searchParams.set("sceneId", sceneId);
    url.searchParams.set("pluginId", pluginId);
    url.searchParams.set("capabilityId", capabilityId);
    url.searchParams.set("revision", revision);
    return this.#request(url);
  }

  callProtocol() {
    return this.#request(this.#url("/v2/plugin-capabilities/call-protocol"));
  }

  prepareCall(request) {
    return this.#request(this.#url("/v2/plugin-capabilities/prepare-call"), {
      method: "POST", body: JSON.stringify(request),
    });
  }

  cancelCall(scope, callId) {
    return this.#request(this.#url("/v2/plugin-capabilities/cancel-call"), {
      method: "POST", body: JSON.stringify({ schemaVersion: 1, scope, callId }),
    });
  }

  callStatus(scope, callId) {
    return this.#request(this.#url("/v2/plugin-capabilities/call-status"), {
      method: "POST", body: JSON.stringify({ schemaVersion: 1, scope, callId }),
    });
  }

  reconcileCall(scope, callId, hostInstanceId) {
    return this.#request(this.#url("/v2/plugin-capabilities/reconcile-call"), {
      method: "POST", body: JSON.stringify({ schemaVersion: 1, scope, callId, hostInstanceId }),
    });
  }

  resourceCallStatus(owner, toolCallId, hostInstanceId) {
    return this.#request(this.#url("/v2/plugin-resources/call-status"), {
      method: "POST",
      body: JSON.stringify({ schemaVersion: 1, owner, toolCallId, ...(hostInstanceId ? { hostInstanceId } : {}) }),
    });
  }

  prepareResourceCall(owner, { resourceId, contentVersion, additionalResources = [], input = {} }) {
    return this.#request(this.#url("/v2/plugin-resources/prepare-call"), {
      method: "POST", body: JSON.stringify({ schemaVersion: 1,
        access: { schemaVersion: 1, owner, resourceId, contentVersion },
        ...(additionalResources.length ? { additionalAccesses: additionalResources.map(resource => ({ schemaVersion: 1, owner,
          resourceId: resource.resourceId, contentVersion: resource.contentVersion })) } : {}), input }),
    });
  }

  invokeResourceCall(owner, { resourceId, contentVersion, additionalResources = [], input = {} }, { callId, hostInstanceId }) {
    return this.#request(this.#url("/v2/plugin-resources/invoke-call"), {
      method: "POST", body: JSON.stringify({ access: { schemaVersion: 1, owner, resourceId, contentVersion },
        ...(additionalResources.length ? { additionalAccesses: additionalResources.map(resource => ({ schemaVersion: 1, owner,
          resourceId: resource.resourceId, contentVersion: resource.contentVersion })) } : {}),
        input, callId, hostInstanceId }),
    });
  }

  reconcileResourceCall(owner, { callId, hostInstanceId }) {
    return this.#request(this.#url("/v2/plugin-resources/reconcile-call"), {
      method: "POST", body: JSON.stringify({ schemaVersion: 1, owner, callId, hostInstanceId }),
    });
  }

  invokeResource(owner, { resourceId, contentVersion, toolCallId, input = {}, hostInstanceId }) {
    return this.#request(this.#url("/v2/plugin-resources/invoke-view"), {
      method: "POST",
      body: JSON.stringify({
        access: { schemaVersion: 1, owner, resourceId, contentVersion },
        toolCallId,
        input,
        ...(hostInstanceId ? { hostInstanceId } : {}),
      }),
    });
  }

  cancelResource(owner, toolCallId) {
    return this.#request(this.#url("/v2/plugin-resources/cancel-view"), {
      method: "POST",
      body: JSON.stringify({ schemaVersion: 1, owner, toolCallId }),
    });
  }

  readResource(owner, { resourceId, contentVersion, offset, length }) {
    return this.#request(this.#url("/v2/plugin-resources/read-view"), {
      method: "POST",
      body: JSON.stringify({
        access: { schemaVersion: 1, owner, resourceId, contentVersion },
        offset,
        length,
      }),
    });
  }

  prepareResource(request) {
    return this.#request(this.#url("/v2/plugin-resources/prepare"), {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  prepareResourceTransfer(source, target) {
    return this.#request(this.#url("/v2/plugin-resources/prepare-transfer"), {
      method: "POST", body: JSON.stringify({ schemaVersion: 1, source, target }),
    });
  }

  prepareResourceSave(source) {
    return this.#request(this.#url("/v2/plugin-resources/prepare-save"), {
      method: "POST", body: JSON.stringify({ schemaVersion: 1, source }),
    });
  }

  commitResourceSave(source, grantId) {
    return this.#request(this.#url("/v2/plugin-resources/commit-save"), {
      method: "POST", body: JSON.stringify({ schemaVersion: 1, source, grantId, confirmed: true }),
    });
  }

  commitResourceTransfer(source, grantId) {
    return this.#request(this.#url("/v2/plugin-resources/commit-transfer"), {
      method: "POST", body: JSON.stringify({ schemaVersion: 1, source, grantId, confirmed: true }),
    });
  }

  appendResource(access, offset, dataBase64) {
    return this.#request(this.#url("/v2/plugin-resources/append"), {
      method: "POST",
      body: JSON.stringify({ access, offset, dataBase64 }),
    });
  }

  commitResource(access) {
    return this.#request(this.#url("/v2/plugin-resources/commit"), {
      method: "POST",
      body: JSON.stringify({ access, confirmed: true }),
    });
  }

  revokeResource(access) {
    return this.#request(this.#url("/v2/plugin-resources/revoke"), {
      method: "POST",
      body: JSON.stringify(access),
    });
  }

  invoke(sceneId, workspaceId, pluginId, capabilityId, input = {}, options = {}) {
    return this.#request(this.#url("/v2/plugin-capabilities/invoke"), {
      method: "POST",
      body: JSON.stringify({
        sceneId,
        workspaceId,
        pluginId,
        capabilityId,
        input,
        ...(options.captureResult ? { captureResult: true } : {}),
        ...(options.catalogRevision ? { catalogRevision: options.catalogRevision } : {}),
        ...(options.callId ? { callId: options.callId } : {}),
      }),
    });
  }

  prepareSave(scope, resultId, title) {
    return this.#request(this.#url("/v2/plugin-results/prepare-save"), {
      method: "POST",
      body: JSON.stringify({ scope, resultId, title }),
    });
  }

  commitSave(scope, grantId) {
    return this.#request(this.#url("/v2/plugin-results/commit-save"), {
      method: "POST",
      body: JSON.stringify({ scope, grantId, confirmed: true }),
    });
  }

  searchTargets(scope, resultId, query = "", offset = 0, revision = null, { view = "all", accessRevision = null } = {}) {
    return this.#request(this.#url("/v2/plugin-results/targets"), {
      method: "POST",
      body: JSON.stringify({ scope, resultId, query, offset, revision,
        ...(view !== "all" ? { view, ...(accessRevision !== null ? { accessRevision } : {}) } : {}), }),
    });
  }

  prepareTransfer(scope, resultId, target, field, inputs = {}) {
    return this.#request(this.#url("/v2/plugin-results/prepare-transfer"), {
      method: "POST",
      body: JSON.stringify({ scope, resultId, target, field,
        ...(Object.keys(inputs).length ? { inputs } : {}), }),
    });
  }

  commitTransfer(scope, grantId) {
    return this.#request(this.#url("/v2/plugin-results/commit-transfer"), {
      method: "POST",
      body: JSON.stringify({ scope, grantId, confirmed: true }),
    });
  }

  #url(path) {
    return new URL(path, this.#location?.origin ?? globalThis.location?.origin);
  }

  async #request(url, options = {}) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(url, {
        ...options,
        headers: {
          accept: "application/json",
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...options.headers,
        },
        signal: controller?.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(
          body?.error?.message || body?.error?.code || `HTTP ${response.status}`,
        );
        error.code = body?.error?.code;
        throw error;
      }
      return body;
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeout = new Error("Plugin capability request timed out");
        timeout.code = "plugin_capability_timeout";
        throw timeout;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
