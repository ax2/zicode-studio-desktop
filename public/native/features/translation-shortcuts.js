const translationId = "com.zicode.translate";
const sameScope = (a, b) => a.sceneId === b.sceneId && a.workspaceId === b.workspaceId;

// Navigation only. Opening translation never reads the clipboard or calls a model.
export function setupTranslationShortcuts({
  activate, getActivePluginId, getTarget, focusInput, stageSelection, recordRecent, listen, onError = () => {},
}) {
  let disposed = false, unlisten;
  let scopeRevision = 0;
  const readScope = () => {
    const { sceneId, workspaceId } = getTarget();
    return { sceneId, workspaceId };
  };
  let lastScope = readScope();
  const updateScope = () => {
    const scope = readScope();
    if (!sameScope(lastScope, scope)) scopeRevision += 1;
    lastScope = scope;
  };
  const remember = async scope => {
    try {
      await recordRecent?.(scope, { kind: "recentRecord", id: `${translationId}:open` });
    } catch {
      // Navigation has already succeeded. History storage is best effort.
    }
  };
  const open = async (text, options) => {
    if (disposed) return;
    updateScope();
    const scope = lastScope;
    const revision = scopeRevision;
    const activated = await activate(translationId, options);
    updateScope();
    if (disposed || activated === false || scopeRevision !== revision || getActivePluginId() !== translationId) return;
    if (text) stageSelection?.(text);
    focusInput();
    void remember(scope);
  };
  const requested = () => {
    void open().catch(error => { if (!disposed) onError(error); });
  };
  const keydown = event => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || !(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== "y") return;
    if (event.target instanceof Element && event.target.closest('dialog[open], [role="dialog"]')) return;
    event.preventDefault(); requested();
  };
  document.addEventListener("keydown", keydown);
  window.addEventListener("zicode:open-translation", requested);
  window.addEventListener("zicode:tool-target-changed", updateScope);
  if (listen) Promise.resolve(listen("studio-open-translation", requested)).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(onError);
  return {
    open,
    destroy() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener("keydown", keydown);
      window.removeEventListener("zicode:open-translation", requested);
      window.removeEventListener("zicode:tool-target-changed", updateScope);
      unlisten?.();
    },
  };
}
