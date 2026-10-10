// Host control gateway: sends `host_request` frames over the native /v2/ws
// protocol and resolves the matching `host_response`. This is the write-capable
// counterpart to the read-only HostDataGateway — it covers package management
// and opening external links, which run the embedded `pi` CLI on the Rust host.
//
// Requests are correlated by a `host-` prefixed requestId; frames that don't
// match a pending request are ignored (other gateways share the same adapter).
export class HostControlGateway {
  #adapter;
  #generation = 0;
  #nextRequestId = 1;
  #pending = new Map();

  constructor(adapter) {
    this.#adapter = adapter;
    adapter.setReceiver((frame) => this.#receive(frame));
    adapter.setConnectionListener?.((connected) => {
      if (!connected) this.#disconnect();
    });
  }

  #request(operation, parameters = {}, timeoutMs = 0) {
    const requestId = `host-${this.#nextRequestId++}`;
    const generation = this.#generation;
    return new Promise((resolve, reject) => {
      const timeout =
        timeoutMs > 0
          ? setTimeout(() => {
              this.#pending.delete(requestId);
              reject(new Error("task_request_timed_out"));
            }, timeoutMs)
          : null;
      this.#pending.set(requestId, { resolve, reject, generation, timeout });
      try {
        this.#adapter.send({
          type: "host_request",
          requestId,
          operation,
          ...parameters,
        });
      } catch (error) {
        if (timeout) clearTimeout(timeout);
        this.#pending.delete(requestId);
        reject(error);
      }
    });
  }

  async listPiPackages() {
    const frame = await this.#request("list_pi_packages");
    return Array.isArray(frame?.packages) ? frame.packages : [];
  }

  async toolAccess(scope, mutation) {
    return this.#request(
      mutation ? "tool_access_mutate" : "tool_access_read",
      { schemaVersion: 1, sceneId: scope.sceneId, workspaceId: scope.workspaceId,
        ...(mutation ? { mutation } : {}) },
      15000,
    );
  }

  async startProjectTask(workspaceId, name, fingerprint, directory = "") {
    return this.#request(
      "start_project_task",
      { workspaceId, name, fingerprint, directory },
      15000,
    );
  }

  async stopProjectTask(workspaceId, runId) {
    return this.#request("stop_project_task", { workspaceId, runId }, 15000);
  }

  async clearProjectTaskHistory(workspaceId) {
    return this.#request("clear_project_task_history", { workspaceId }, 15000);
  }

  async workspaceGitStage(workspaceId, file) {
    return this.#request(
      "workspace_git_stage",
      {
        workspaceId,
        path: file.path,
        indexStatus: file.indexStatus,
        worktreeStatus: file.worktreeStatus,
      },
      30000,
    );
  }

  async workspaceGitUnstage(workspaceId, file) {
    return this.#request(
      "workspace_git_unstage",
      {
        workspaceId,
        path: file.path,
        indexStatus: file.indexStatus,
        worktreeStatus: file.worktreeStatus,
      },
      30000,
    );
  }

  async projectTerminal(operation, workspaceId, parameters = {}) {
    if (
      ![
        "terminal_open",
        "terminal_open_directory",
        "terminal_list",
        "terminal_read",
        "terminal_input",
        "terminal_resize",
        "terminal_close",
      ].includes(operation)
    ) {
      throw new Error("terminal_operation_unsupported");
    }
    const { terminalId, cols, rows, offset, data, directory, openIntentId } = parameters;
    return this.#request(
      operation,
      {
        workspaceId,
        terminalId,
        cols,
        rows,
        offset,
        data,
        ...(openIntentId !== undefined ? { openIntentId } : {}),
        ...(operation === "terminal_open_directory" ? { directory } : {}),
      },
      15000,
    );
  }

  async projectEnvironment(workspaceId, settings) {
    if (settings === undefined)
      return this.#request("project_environment_get", { workspaceId }, 15000);
    const { revision, directories, pythonEnvironment } = settings;
    return this.#request(
      "project_environment_save",
      {
        workspaceId,
        revision,
        directories,
        ...(pythonEnvironment !== undefined ? { pythonEnvironment } : {}),
      },
      15000,
    );
  }

  async projectCondaEnvironments(workspaceId) {
    return this.#request("project_environment_discover_conda", { workspaceId }, 15000);
  }

  async installPiPackage(source) {
    await this.#request("install_pi_package", { source });
  }

  async removePiPackage(source) {
    await this.#request("remove_pi_package", { source });
  }

  async listInstalledApps() {
    const frame = await this.#request("list_installed_apps");
    return Array.isArray(frame?.apps) ? frame.apps : [];
  }

  async openInApp(path, { appName = null, command = null } = {}) {
    await this.#request("open_in_app", { path, appName, command });
  }

  async openWorkspaceEntry(workspaceId, relativePath) {
    await this.#request("open_in_app", { workspaceId, relativePath });
  }

  async openWorkspaceDirectory(workspaceId, relativePath) {
    await this.#request("open_workspace_directory", { workspaceId, relativePath });
  }

  async openExternal(url) {
    await this.#request("open_external", { url });
  }

  // Permanently deletes saved sessions (by id) from disk. Best effort: the
  // response's `errors` lists ids that could not be removed; callers should
  // only drop successfully-deleted ids from local state.
  async deleteSessions(sessionIds) {
    const frame = await this.#request("delete_sessions", { sessionIds });
    return {
      deleted: Array.isArray(frame?.deleted) ? frame.deleted : [],
      errors: Array.isArray(frame?.errors) ? frame.errors : [],
    };
  }

  #receive(frame) {
    const pending = this.#pending.get(frame?.requestId);
    if (!pending || pending.generation !== this.#generation) return;
    this.#pending.delete(frame.requestId);
    if (pending.timeout) clearTimeout(pending.timeout);
    if (frame.error) pending.reject(new Error(frame.error.message ?? String(frame.error)));
    else pending.resolve(frame);
  }

  #disconnect() {
    this.#generation += 1;
    for (const pending of this.#pending.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(new Error("Host disconnected before the control request completed"));
    }
    this.#pending.clear();
  }
}
