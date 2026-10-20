/**
 * Workspace actions — bridge UI controls to native Tauri commands that manage
 * workspace windows. The workspace bar shows the current workspace as a
 * passive label; the switcher menu lists every registered workspace and also
 * offers "Open folder as workspace" for the native folder picker.
 */

import { t } from "../../i18n.js";
import { getSelectedSceneId } from "../react/settings.js";

const WORKSPACE_TRASH_RETENTION_DAYS = 30;
const DAY_SECS = 24 * 60 * 60;

/**
 * Map raw Rust errors from workspace trash commands to friendly localized
 * messages so users see understandable feedback instead of internal strings.
 */
function friendlyTrashError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const fallbacks = [
    [
      /original project folder no longer exists/i,
      t("Restore failed: the original project folder no longer exists."),
    ],
    [
      /already has a \.zicode folder/i,
      t("Restore failed: the project already has app data (.zicode)."),
    ],
    [
      /cannot delete workspace trash entry|cannot read workspace trash/i,
      t("Trash operation failed. Check the recycle bin folder and try again."),
    ],
  ];
  for (const [pattern, friendly] of fallbacks) {
    if (pattern.test(message)) return new Error(friendly);
  }
  return error instanceof Error ? error : new Error(String(error));
}


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
  pluginId = null,
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
  const appQuery = pluginId ? `?app=${encodeURIComponent(pluginId)}` : "";
  window.location.href = `/app/workspaces/${encodeURIComponent(wid)}/sessions/${encodeURIComponent(sid)}${appQuery}`;
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
 * (`POST /v2/resolve-workspace`). The host only resolves workspaces already
 * registered by the desktop. Used by LAN/remote clients that cannot invoke
 * Tauri native commands.
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
 * Pick the finance session a user should be taken back to, if any.
 * The session list carries `target.sceneId` and an `isCurrentWorkspace` flag;
 * we ignore sessions from other workspaces and the currently active session.
 *
 * @param {Array<{ target?: { sceneId?: string }, isCurrentWorkspace?: boolean, id?: string }>} sessions
 * @param {string} currentSessionId
 */
export function findFinanceSession(sessions, currentSessionId) {
  const candidates = (Array.isArray(sessions) ? sessions : []).filter(
    (session) =>
      session?.target?.sceneId === "finance" &&
      session?.isCurrentWorkspace !== false &&
      session?.id !== currentSessionId,
  );
  if (candidates.length === 0) return null;
  // Prefer the most recently modified finance session when several exist.
  return candidates.sort((left, right) => {
    const a = Number(left?.modifiedAtMs) || 0;
    const b = Number(right?.modifiedAtMs) || 0;
    return b - a;
  })[0];
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
export async function createSessionInApp({
  data,
  workspaceId,
  sceneId = getSelectedSceneId(),
  pluginId = null,
  fetchImpl = globalThis.fetch,
}) {
  const invoke = resolveInvoke();
  if (invoke) {
    const response = await data.workspaceInfo(workspaceId);
    const path = response?.info?.path;
    if (!path) throw new Error("Workspace path is unavailable");
    await invoke("open_new_session_in_workspace", {
      projectPath: path,
      sceneId,
      pluginId,
    });
  } else {
    await createSessionViaHost(workspaceId, sceneId, fetchImpl, pluginId);
  }
}

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

/**
 * Workspace switcher: list every registered workspace and ask the native host
 * to open the selected project. In explicit tools-only mode the host opens a
 * separate project window; AI sessions can navigate the current window. It
 * also renders the shared workspace bar (current project name + path) as a
 * passive label and offers "Open
 * folder as workspace" inside the switcher menu so the folder picker stays
 * reachable without a dedicated button. Falls back to a hidden control on
 * remote/browser clients that cannot invoke native window navigation.
 */
export function setupWorkspaceSwitcher({ onError, resolveWorkspacePath, notify, openPath } = {}) {
  const button = document.getElementById("workspace-switcher-btn");
  const menu = document.getElementById("workspace-switcher-menu");
  const label = document.getElementById("workspace-bar-label");
  const nameEl = document.getElementById("workspace-bar-name");
  const pathEl = document.getElementById("workspace-bar-path");
  if (!button || !menu || !label) return false;

  const invoke = resolveInvoke();

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

  const activePluginId = () =>
    document.body.dataset.activePlugin || "core.chat";

  const setLabel = (path) => {
    if (nameEl) nameEl.textContent = projectName(path);
    if (pathEl) pathEl.textContent = displayPath(path);
    label.title = displayPath(path);
  };

  const refreshWorkspaceLabel = async () => {
    const current = currentWorkspaceId();
    if (!invoke) {
      // LAN/mobile clients have no Tauri `list_workspaces`; resolve the
      // current workspace from the caller-provided path source (the sidebar
      // session list) so the label stays visible instead of disappearing.
      const path = resolveWorkspacePath?.(current);
      if (path) setLabel(path);
      return;
    }
    try {
      const workspaces = (await invoke("list_workspaces")) ?? [];
      const active =
        workspaces.find((workspace) => workspace.id === current) ??
        (workspaces.length > 0 ? workspaces[0] : null);
      if (active) {
        setLabel(active.path);
      }
    } catch {
      // Keep the placeholder; the switcher still lists workspaces on open.
    }
  };

  if (!invoke) {
    button.style.setProperty("display", "none");
    void refreshWorkspaceLabel();
    return { refreshWorkspaceLabel };
  }

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
        empty.textContent = t("No other workspaces yet");
        menu.append(empty);
      } else {
        const global = workspaces.find((workspace) => {
          const path = displayPath(workspace.path).replace(/[\\/]+$/, "");
          return path.toLowerCase().endsWith(".zicode");
        });
        const ordered = global
          ? [global, ...workspaces.filter((workspace) => workspace !== global)]
          : workspaces;
        for (const workspace of ordered) {
          const isGlobal = (() => {
            const path = displayPath(workspace.path).replace(/[\\/]+$/, "");
            return path.toLowerCase().endsWith(".zicode");
          })();
          const isCurrent = workspace.id === current;
          const row = document.createElement("div");
          row.className = "workspace-switcher-row";
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
              await invoke("switch_window_workspace", {
                projectPath: workspace.path,
                pluginId: activePluginId(),
              });
            } catch (error) {
              onError?.(error instanceof Error ? error : new Error(String(error)));
            }
          });
          row.append(item);
          if (!isCurrent && !isGlobal) {
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "workspace-switcher-delete";
            remove.title = t("Delete project (move app data to trash)");
            remove.setAttribute(
              "aria-label",
              `${t("Delete project")} ${projectName(workspace.path)}`,
            );
            remove.textContent = "🗑";
            remove.addEventListener("click", async (event) => {
              event.stopPropagation();
              const confirmed = globalThis.confirm?.(
                t(
                  'Delete project "{name}"? Its ZiCode app data (.zicode) moves to the trash, is kept for 30 days, and can be restored during that time; your project files are never deleted.',
                ).replace("{name}", projectName(workspace.path)),
              );
              if (!confirmed) return;
              try {
                const trashPath = await invoke("delete_workspace", {
                  workspaceId: workspace.id,
                });
                notify?.({
                  title: t("Project moved to trash"),
                  message: `${t("Recoverable at {path}").replace(
                    "{path}",
                    trashPath,
                  )} · ${t("Kept for 30 days")}`,
                  type: "info",
                  action:
                    typeof openPath === "function"
                      ? {
                          label: t("Open trash folder"),
                          run: () => openPath(trashPath),
                        }
                      : undefined,
                });
                await openMenu();
              } catch (error) {
                onError?.(error instanceof Error ? error : new Error(String(error)));
              }
            });
            row.append(remove);
          }
          menu.append(row);
        }
      }
      const trashEntries = (await invoke("list_workspace_trash")) ?? [];
      if (trashEntries.length > 0) {
        const divider = document.createElement("div");
        divider.className = "workspace-switcher-divider";
        menu.append(divider);
        const heading = document.createElement("div");
        heading.className = "workspace-switcher-trash-heading";
        const headingText = document.createElement("span");
        headingText.textContent = `${t("Recycle bin")} · ${t("Kept for 30 days")}`;
        heading.append(headingText);
        const emptyTrash = document.createElement("button");
        emptyTrash.type = "button";
        emptyTrash.className = "workspace-switcher-empty-trash";
        emptyTrash.textContent = t("Empty trash");
        emptyTrash.setAttribute("aria-label", t("Empty trash"));
        emptyTrash.addEventListener("click", async (event) => {
          event.stopPropagation();
          const confirmed = globalThis.confirm?.(
            t("Empty the recycle bin? {count} entries will be permanently deleted.").replace(
              "{count}",
              String(trashEntries.length),
            ),
          );
          if (!confirmed) return;
          try {
            await invoke("empty_workspace_trash");
            notify?.({ title: t("Recycle bin emptied"), type: "success" });
            await openMenu();
          } catch (error) {
            onError?.(friendlyTrashError(error));
          }
        });
        heading.append(emptyTrash);
        menu.append(heading);
        for (const entry of trashEntries) {
          const row = document.createElement("div");
          row.className = "workspace-switcher-row workspace-switcher-trash-row";
          const info = document.createElement("div");
          info.className = "workspace-switcher-item workspace-switcher-trash-item";
          const name = document.createElement("strong");
          name.textContent = entry.name;
          const path = document.createElement("span");
          path.textContent = entry.original_root || entry.dir;
          info.append(name, path);
          const nowSecs = Math.floor(Date.now() / 1000);
          const remainingSecs =
            entry.deleted_at + WORKSPACE_TRASH_RETENTION_DAYS * DAY_SECS - nowSecs;
          const remainingDays = Math.max(0, Math.ceil(remainingSecs / DAY_SECS));
          const expiry = document.createElement("span");
          expiry.className = "workspace-switcher-trash-expiry";
          expiry.textContent =
            remainingDays > 0
              ? t("Auto-purges in {count} days").replace(
                  "{count}",
                  String(remainingDays),
                )
              : t("Auto-purges today");
          info.append(expiry);
          row.append(info);
          const restore = document.createElement("button");
          restore.type = "button";
          restore.className = "workspace-switcher-restore";
          restore.textContent = t("Restore");
          restore.setAttribute("aria-label", `${t("Restore")} ${entry.name}`);
          restore.addEventListener("click", async (event) => {
            event.stopPropagation();
            const confirmed = globalThis.confirm?.(
              t(
                'Restore project "{name}"? Its app data (.zicode) returns to the original folder.',
              ).replace("{name}", entry.name),
            );
            if (!confirmed) return;
            try {
              const restoredId = await invoke("restore_workspace", {
                trashDir: entry.dir,
              });
              notify?.({
                title: t("Project restored"),
                message: t("Restored workspace {id}").replace("{id}", restoredId),
                type: "success",
              });
              await openMenu();
            } catch (error) {
              onError?.(friendlyTrashError(error));
            }
          });
          row.append(restore);
          const deleteEntry = document.createElement("button");
          deleteEntry.type = "button";
          deleteEntry.className = "workspace-switcher-delete workspace-switcher-trash-delete";
          deleteEntry.textContent = "🗑";
          deleteEntry.title = t("Delete permanently");
          deleteEntry.setAttribute(
            "aria-label",
            `${t("Delete permanently")} ${entry.name}`,
          );
          deleteEntry.addEventListener("click", async (event) => {
            event.stopPropagation();
            const confirmed = globalThis.confirm?.(
              t('Permanently delete the recycle bin entry "{name}"? This cannot be undone.').replace(
                "{name}",
                entry.name,
              ),
            );
            if (!confirmed) return;
            try {
              await invoke("delete_workspace_trash_entry", {
                trashDir: entry.dir,
              });
              notify?.({
                title: t("Trash entry permanently deleted"),
                message: entry.name,
                type: "success",
              });
              await openMenu();
            } catch (error) {
              onError?.(friendlyTrashError(error));
            }
          });
          row.append(deleteEntry);
          menu.append(row);
        }
      }
      appendOpenFolderAction();
    } catch (error) {
      menu.textContent = "";
      const failed = document.createElement("div");
      failed.className = "workspace-switcher-item";
      failed.textContent = error instanceof Error ? error.message : String(error);
      menu.append(failed);
      appendOpenFolderAction();
    }
  };

  const appendOpenFolderAction = () => {
    const divider = document.createElement("div");
    divider.className = "workspace-switcher-divider";
    menu.append(divider);
    const openFolder = document.createElement("button");
    openFolder.type = "button";
    openFolder.className = "workspace-switcher-item workspace-switcher-open-folder";
    openFolder.textContent = t("Open folder as workspace");
    openFolder.setAttribute("role", "menuitem");
    openFolder.addEventListener("click", async () => {
      closeMenu();
      try {
        await invoke("open_folder_as_workspace", {
          pluginId: activePluginId(),
        });
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    });
    menu.append(openFolder);
  };

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
