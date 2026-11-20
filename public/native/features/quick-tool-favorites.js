// Host favorites contain at most 512 identities. Disabled entries still occupy
// directory pages, so read only as far as the menu (or requested identity) needs.
export async function loadQuickToolFavorites(api, owner, isCurrent, selectedId) {
  let offset = 0, revision = null, accessRevision = null;
  const items = [], seen = new Set();
  while (isCurrent()) {
    const page = await api.searchTools(owner.sceneId, {
      workspaceId: owner.workspaceId, view: "favorites", query: "", offset, revision,
      ...(offset ? { accessRevision } : {}), includeViewOperations: true,
    });
    if (!isCurrent()) return null;
    if (offset && (page.revision !== revision || page.accessRevision !== accessRevision)) {
      throw new Error("quick_tools_snapshot_changed");
    }
    revision = page.revision; accessRevision = page.accessRevision;
    for (const tool of page.items) {
      if (!tool.enabled || seen.has(tool.accessId)) continue;
      seen.add(tool.accessId);
      if (selectedId) {
        if (tool.accessId === selectedId) return { items: [tool], revision };
      } else {
        items.push(tool);
        if (items.length === 8) return { items, revision };
      }
    }
    const next = page.nextOffset;
    if (next === null || next === undefined) return { items, revision };
    if (!Number.isSafeInteger(next) || next <= offset || next >= 512 ||
        !page.items.length || typeof revision !== "string" || !revision.length ||
        !Number.isSafeInteger(accessRevision) || accessRevision < 0) {
      throw new Error("quick_tools_page_invalid");
    }
    offset = next;
  }
  return null;
}
