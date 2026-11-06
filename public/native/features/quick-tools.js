import { loadQuickToolFavorites } from "./quick-tool-favorites.js";

// Projection of Host-owned favorites. Opening never executes a tool or reads a file.
export function setupQuickTools({ api, accessStore, getTarget, openTool, manage, invoke, onError = () => {} }) {
  let snapshot = { items: [], error: false, loading: true };
  let tools = [], sequence = 0, opening = 0, disposed = false;
  let nativeRevision = 0, nativeWrites = Promise.resolve();
  const scope = () => { const target = getTarget(); return { sceneId: target.sceneId, workspaceId: target.workspaceId }; };
  const key = owner => JSON.stringify(owner);
  let ownerKey = key(scope());
  const current = owner => !disposed && key(owner) === key(scope());
  const publish = () => window.dispatchEvent(new CustomEvent("zicode:quick-tools-changed", { detail: snapshot }));
  const projectNative = items => {
    const revision = ++nativeRevision;
    nativeWrites = nativeWrites.then(async () => {
      if (disposed || revision !== nativeRevision || !invoke) return;
      try { await invoke("set_desktop_tool_shortcuts", { shortcuts: items }); }
      catch (error) { if (!disposed) onError(error); }
    });
    return nativeWrites;
  };
  async function unavailable(error) {
    sequence++; opening++;
    snapshot = { items: [], error: true, loading: false }; tools = []; publish();
    onError(error);
    await projectNative([]);
  }
  async function refresh() {
    if (disposed || !api || !accessStore) return;
    const request = ++sequence, owner = scope();
    if (ownerKey !== key(owner)) {
      ownerKey = key(owner); opening++;
      tools = []; snapshot = { items: [], error: false, loading: true }; publish();
      void projectNative([]);
    }
    try {
      const page = await loadQuickToolFavorites(api, owner, () => request === sequence && current(owner));
      if (!page || request !== sequence || !current(owner)) return;
      tools = page.items;
      snapshot = { items: tools.map(tool => ({ id: tool.accessId, title: tool.title })), error: false, loading: false };
      publish();
      await projectNative(snapshot.items);
    } catch (error) {
      if (request !== sequence || !current(owner)) return;
      await unavailable(error);
    }
  }
  async function open(event) {
    const id = event.detail;
    if (disposed || typeof id !== "string" || !tools.some(tool => tool.accessId === id)) return;
    const request = ++opening, owner = scope();
    try {
      const page = await loadQuickToolFavorites(api, owner, () => request === opening && current(owner), id);
      if (!page || request !== opening || !current(owner)) return;
      const tool = page.items.find(tool => tool.accessId === id && tool.enabled);
      if (!tool) { await refresh(); return; }
      await openTool(tool, page.revision, owner);
    } catch (error) { if (request === opening && current(owner)) await unavailable(error); }
  }
  const openManaged = () => { Promise.resolve().then(() => !disposed && manage()).catch(error => { if (!disposed) onError(error); }); };
  const refreshRequested = event => {
    if (event.type === "zicode:tool-access-changed") opening++;
    void refresh();
  };
  const events = ["zicode:tool-access-changed", "zicode:tool-target-changed", "zicode:locale-changed", "zicode:quick-tools-retry"];
  for (const name of events) window.addEventListener(name, refreshRequested);
  window.addEventListener("focus", refreshRequested);
  window.addEventListener("zicode:quick-tools-request", publish);
  window.addEventListener("zicode:open-quick-tool", open);
  window.addEventListener("zicode:manage-quick-tools", openManaged);
  void refresh();
  return { refresh, destroy() {
    disposed = true; sequence++; opening++; nativeRevision++;
    for (const name of events) window.removeEventListener(name, refreshRequested);
    window.removeEventListener("focus", refreshRequested);
    window.removeEventListener("zicode:quick-tools-request", publish);
    window.removeEventListener("zicode:open-quick-tool", open);
    window.removeEventListener("zicode:manage-quick-tools", openManaged);
  } };
}
