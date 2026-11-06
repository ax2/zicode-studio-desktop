// Current product policy. Retain the multi-project implementation behind one
// explicit extension point instead of scattering cosmetic path redactions.
export const MULTI_PROJECT_UI_ENABLED = false;
export function isWorkspaceApplicationVisible(pluginId) {
  return MULTI_PROJECT_UI_ENABLED || pluginId !== "com.zicode.projects";
}
export async function resolveDefaultWorkspacePath(fallback = "") {
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (typeof invoke !== "function") return fallback;
  try {
    const entries = await invoke("list_workspaces");
    return Array.isArray(entries) && entries.length === 1 && typeof entries[0]?.path === "string" ? entries[0].path : fallback;
  } catch { return fallback; }
}

export function isWorkspaceEntryVisible(entryId) { return isWorkspaceApplicationVisible(String(entryId).split(":")[0]); }
