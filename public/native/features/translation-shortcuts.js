// Navigation only. Opening translation never reads the clipboard or calls a model.
export function setupTranslationShortcuts({ activate, getActivePluginId, focusInput, listen, onError = () => {} }) {
  let disposed = false, unlisten;
  const open = async () => {
    try {
      await activate("com.zicode.translate");
      if (!disposed && getActivePluginId() === "com.zicode.translate") focusInput();
    } catch (error) { if (!disposed) onError(error); }
  };
  const requested = () => { if (!disposed) void open(); };
  const keydown = event => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || !(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== "y") return;
    if (event.target instanceof Element && event.target.closest('dialog[open], [role="dialog"]')) return;
    event.preventDefault(); requested();
  };
  document.addEventListener("keydown", keydown);
  window.addEventListener("zicode:open-translation", requested);
  if (listen) Promise.resolve(listen("studio-open-translation", requested)).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(onError);
  return { destroy() { if (disposed) return; disposed = true; document.removeEventListener("keydown", keydown); window.removeEventListener("zicode:open-translation", requested); unlisten?.(); } };
}
