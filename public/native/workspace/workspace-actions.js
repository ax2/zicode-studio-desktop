/**
 * Workspace actions — bridge UI controls to native Tauri commands that manage
 * workspace windows. Currently wires the "Open folder as workspace" button to
 * the native folder picker, which spawns a dedicated window + pi runtime for
 * the chosen directory.
 */
import { getSelectedSceneId } from "../react/settings.js";


/**
 * Resolve the Tauri `invoke` function exposed via `withGlobalTauri`.
 * Returns null when running outside the native Tauri shell (e.g. a remote
 * browser client), so callers can degrade gracefully.
 */
function resolveInvoke() {
  return globalThis.__TAURI__?.core?.invoke ?? null;
}

/**
 * Create a new session via the host HTTP API (used by LAN/remote clients that
 * cannot invoke Tauri native commands). Spawns a fresh temporary runtime on
 * the server and navigates the current page to the new session URL.
 *
 * @param {string} workspaceId
 * @returns {Promise<void>}
 */
export async function createSessionViaHost(
  workspaceId,
  sceneId = getSelectedSceneId(),
  fetchImpl = globalThis.fetch,
) {
  const response = await fetchImpl("/v2/new-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, sceneId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error ?? `Server error ${response.status}`);
  }
  const target = await response.json();
  const { workspaceId: wid, sessionId: sid } = target;
  if (!wid || !sid) throw new Error("Server returned an invalid session target");
  window.location.href = `/app/workspaces/${encodeURIComponent(wid)}/sessions/${encodeURIComponent(sid)}`;
}

/**
 * Spawn a fresh headless runtime for `workspaceId` via the host HTTP API and
 * return its runtime target WITHOUT navigating the page. Unlike
 * `createSessionViaHost`, this is used for background dispatch (Agent Inbox):
 * the caller keeps the returned target and drives it over `/v2/ws` while the
 * current window stays on its own session.
 *
 * @param {string} workspaceId
 * @returns {Promise<{workspaceId: string, sessionId: string, instanceId: string}>}
 */
export async function spawnSessionViaHost(
  workspaceId,
  sceneId = getSelectedSceneId(),
  fetchImpl = globalThis.fetch,
) {
  const response = await fetchImpl("/v2/new-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, sceneId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error ?? `Server error ${response.status}`);
  }
  const target = await response.json();
  if (!target?.workspaceId || !target?.sessionId || !target?.instanceId) {
    throw new Error("Server returned an invalid session target");
  }
  return target;
}

/**
 * Resolve a project path to its stable workspace id via the host HTTP API
 * (`POST /v2/resolve-workspace`), registering the workspace on the server so
 * `/v2/bootstrap` can lazily resume its sessions. Used by LAN/remote clients
 * that cannot invoke Tauri native commands.
 *
 * @param {string} projectPath
 * @returns {Promise<string>} the resolved workspace id
 */
export async function resolveWorkspaceViaHost(projectPath, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl("/v2/resolve-workspace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectPath }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error ?? `Server error ${response.status}`);
  }
  const { workspaceId } = await response.json();
  if (!workspaceId) throw new Error("Server returned an invalid workspace id");
  return workspaceId;
}

/**
 * Open an existing session that belongs to a different project via the host
 * HTTP API. Resolves the target project's workspace id, then navigates the
 * current page to that session's route (the page re-bootstraps). Used by
 * LAN/mobile clients switching across projects without a Tauri window.
 *
 * @param {{ projectPath: string, id: string, workspaceId?: string }} session
 * @returns {Promise<void>}
 */
export async function openSessionInProjectViaHost(session, fetchImpl = globalThis.fetch) {
  const workspaceId =
    session.workspaceId || (await resolveWorkspaceViaHost(session.projectPath, fetchImpl));
  window.location.href = `/app/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(session.id)}`;
}

/**
 * Wire the "+ New Session" button to open a fresh session in the current
 * workspace. On native Tauri it calls `open_new_session_in_workspace`; on
 * LAN/remote clients it falls back to the host HTTP API (`POST /v2/new-session`).
 *
 * @param {object} options
 * @param {import('./data-gateway.js').HostDataGateway} options.data
 * @param {string} options.workspaceId
 * @param {(error: Error) => void} [options.onError]
 * @returns {boolean}
 */
export function setupNewSessionButton({ data, workspaceId, onError, fetchImpl } = {}) {
  const button = document.getElementById("new-session-btn");
  if (!button) return false;

  const invoke = resolveInvoke();

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      if (invoke) {
        const response = await data.workspaceInfo(workspaceId);
        const path = response?.info?.path;
        if (!path) throw new Error("Workspace path is unavailable");
        await invoke("open_new_session_in_workspace", {
          projectPath: path,
          sceneId: getSelectedSceneId(),
        });
      } else {
        await createSessionViaHost(workspaceId, getSelectedSceneId(), fetchImpl);
      }
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      button.disabled = false;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (!isNewSessionShortcut(event)) return;
    event.preventDefault();
    if (!button.disabled) button.click();
  });
  return true;
}

function isNewSessionShortcut(event) {
  if (event.defaultPrevented || event.isComposing) return false;
  if (isTypingTarget(event.target)) return false;
  if (event.altKey || event.shiftKey || event.key.toLowerCase() !== "n") return false;
  return event.metaKey || event.ctrlKey;
}

function isTypingTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select")) return true;
  return target.closest('[contenteditable="true"]') !== null;
}

export function setupOpenFolderButton({ onError } = {}) {
  const button = document.getElementById("open-folder-btn");
  if (!button) return false;

  const invoke = resolveInvoke();
  if (!invoke) {
    // Remote/browser clients cannot open native windows; hide the control
    // rather than leave a button that silently does nothing.
    button.style.setProperty("display", "none");
    return false;
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await invoke("open_folder_as_workspace");
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      button.disabled = false;
    }
  });
  return true;
}

/**
 * Workspace switcher: list every registered workspace and switch the current
 * window to the selected project in place. Also renders the shared workspace
 * bar (current project name + path) and wires the project row to the native
 * folder picker. Falls back to a hidden control on remote/browser clients
 * that cannot invoke native window navigation.
 */
export function setupWorkspaceSwitcher({ onError } = {}) {
  const button = document.getElementById("workspace-switcher-btn");
  const menu = document.getElementById("workspace-switcher-menu");
  const projectButton = document.getElementById("workspace-bar-project");
  const nameEl = document.getElementById("workspace-bar-name");
  const pathEl = document.getElementById("workspace-bar-path");
  if (!button || !menu || !projectButton) return false;

  const invoke = resolveInvoke();
  if (!invoke) {
    button.style.setProperty("display", "none");
    projectButton.style.setProperty("display", "none");
    return false;
  }

  const currentWorkspaceId = () => {
    const match = window.location.pathname.match(/^\/app\/workspaces\/([^/]+)\//);
    return match ? decodeURIComponent(match[1]) : "";
  };

  const closeMenu = () => {
    menu.classList.add("hidden");
    button.setAttribute("aria-expanded", "false");
  };

  const displayPath = (path) => {
    // Windows canonicalization prefixes paths with the verbatim marker.
    return String(path || "").replace(/^\\\\\?\\/, "").replace(/^\\\?\\/, "");
  };

  const projectName = (path) => {
    const parts = displayPath(path).split(/[\\/]/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : path || "";
  };

  const refreshWorkspaceLabel = async () => {
    const current = currentWorkspaceId();
    try {
      const workspaces = (await invoke("list_workspaces")) ?? [];
      const active = workspaces.find((workspace) => workspace.id === current);
      if (active) {
        if (nameEl) nameEl.textContent = projectName(active.path);
        if (pathEl) pathEl.textContent = displayPath(active.path);
      } else if (workspaces.length > 0) {
        if (nameEl) nameEl.textContent = projectName(workspaces[0].path);
        if (pathEl) pathEl.textContent = displayPath(workspaces[0].path);
      }
    } catch {
      // Keep the placeholder; the switcher still lists workspaces on open.
    }
  };

  const openMenu = async () => {
    button.setAttribute("aria-expanded", "true");
    menu.classList.remove("hidden");
    menu.textContent = "";
    const current = currentWorkspaceId();
    try {
      const workspaces = (await invoke("list_workspaces")) ?? [];
      if (workspaces.length === 0) {
        const empty = document.createElement("div");
        empty.className = "workspace-switcher-item";
        empty.textContent = "No other workspaces yet";
        menu.append(empty);
        return;
      }
      for (const workspace of workspaces) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = `workspace-switcher-item${workspace.id === current ? " current" : ""}`;
        item.setAttribute("role", "menuitem");
        const name = document.createElement("strong");
        name.textContent = projectName(workspace.path);
        const path = document.createElement("span");
        path.textContent = displayPath(workspace.path);
        item.append(name, path);
        item.addEventListener("click", async () => {
          closeMenu();
          try {
            await invoke("open_new_session_in_workspace", {
              projectPath: workspace.path,
            });
          } catch (error) {
            onError?.(error instanceof Error ? error : new Error(String(error)));
          }
        });
        menu.append(item);
      }
    } catch (error) {
      menu.textContent = "";
      const failed = document.createElement("div");
      failed.className = "workspace-switcher-item";
      failed.textContent = error instanceof Error ? error.message : String(error);
      menu.append(failed);
    }
  };

  projectButton.addEventListener("click", async () => {
    projectButton.disabled = true;
    try {
      await invoke("open_folder_as_workspace");
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      projectButton.disabled = false;
    }
  });
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu.classList.contains("hidden")) {
      void openMenu();
    } else {
      closeMenu();
    }
  });
  document.addEventListener("click", (event) => {
    if (!menu.contains(event.target) && event.target !== button) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.classList.contains("hidden")) {
      closeMenu();
      button.focus({ preventScroll: true });
    }
  });
  void refreshWorkspaceLabel();
  return true;
}
