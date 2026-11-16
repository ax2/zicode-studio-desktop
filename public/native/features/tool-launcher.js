import { isWorkspaceEntryVisible } from "../workspace/workspace-mode.js";

// Every catalog result belongs to the exact target and catalog generation
// that produced it. The browser launcher opens tools through the same native
// shell and permission checks as the full directory.
export const launcherInvalidations = [
  "zicode:tool-target-changed", "zicode:plugin-catalog-changed", "zicode:tool-access-changed",
];

export function createToolLauncher({ api, accessStore, applications, scope, current, openTool, generation }) {
  const changed = () => Object.assign(new Error("tool_launcher_context_changed"), { code: "catalog_changed" });
  const usable = item => item?.enabled && isWorkspaceEntryVisible(item.accessId);
  const valid = result => current(result.scope) && generation() === result.generation;
  return {
    applications,
    async search(view, query, cursor, signal) {
      const owner = scope(), epoch = generation();
      const [page, access] = await Promise.all([
        api.searchTools(owner.sceneId, { ...cursor, workspaceId: owner.workspaceId, view, query, includeViewOperations: true }, signal),
        accessStore.read(owner).catch(() => null),
      ]);
      const result = { page, scope: owner, generation: epoch, favoriteIds: access?.favorites ?? null,
        recentIds: access?.recent.map(entry => entry.id) ?? [] };
      signal.throwIfAborted();
      if (!valid(result) || (cursor.revision && cursor.revision !== page.revision) ||
          (cursor.offset && view === "recent" && cursor.accessRevision !== page.accessRevision)) throw changed();
      return result;
    },
    async open(item, result) {
      if (!valid(result) || !usable(item) || !result.page.items.includes(item)) throw changed();
      return openTool(item, result.page.revision, result.scope);
    },
    async openApplication(id) {
      const owner = scope();
      const app = applications().find(entry => entry.id === id && !entry.disabled);
      if (!current(owner) || !isWorkspaceEntryVisible(id) || !app?.action) throw changed();
      const opened = await app.action();
      if (opened !== false && current(owner)) {
        // A failed history write must not turn a successful navigation into a failure.
        void accessStore.mutate(owner, { kind: "recentRecord", id }).catch(() => {});
      }
      return opened;
    },
    async setFavorite(id, enabled, result) {
      if (!valid(result) || !result.page.items.some(item => usable(item) && item.accessId === id)) throw changed();
      return accessStore.mutate(result.scope, { kind: "favoriteSet", id, enabled });
    },
  };
}
