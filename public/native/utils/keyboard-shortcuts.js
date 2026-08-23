function isEditableElement(element) {
  const tag = element?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || element?.isContentEditable;
}

function isVisible(element) {
  return Boolean(element && !element.classList.contains("hidden"));
}

function overlayOwnsEscape() {
  return (
    isVisible(document.getElementById("settings-panel")) ||
    isVisible(document.getElementById("model-dropdown-menu")) ||
    isVisible(document.getElementById("lan-qr-modal")) ||
    isVisible(document.getElementById("command-palette")) ||
    document.querySelector(".image-lightbox.open")
  );
}

export function setupAppKeyboardShortcuts({
  input,
  abort,
  isWorking,
  openCommandPalette,
  openModelDropdown,
  cycleThinking,
  newSession,
  switchWorkspace,
  openSettings,
  toggleFiles,
}) {
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (overlayOwnsEscape()) return;
      if (isWorking()) {
        event.preventDefault();
        abort();
      }
      return;
    }

    const meta = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    // Ctrl/Cmd+K is owned by the session search dialog (its trigger advertises
    // the shortcut); the command palette is reachable via Ctrl/Cmd+Shift+P so
    // the two overlays never fight over one keystroke.
    if (meta && key === "p" && event.shiftKey) {
      event.preventDefault();
      openCommandPalette?.();
      return;
    }
    if (meta && key === "m") {
      event.preventDefault();
      openModelDropdown?.();
      return;
    }
    if (meta && key === "t") {
      event.preventDefault();
      cycleThinking?.();
      return;
    }
    if (meta && key === "n" && event.shiftKey) {
      event.preventDefault();
      newSession?.();
      return;
    }
    if (meta && key === "o" && event.shiftKey) {
      event.preventDefault();
      switchWorkspace?.();
      return;
    }
    if (meta && key === ",") {
      event.preventDefault();
      openSettings?.();
      return;
    }
    if (meta && key === "f" && event.shiftKey) {
      event.preventDefault();
      toggleFiles?.();
      return;
    }

    if (event.key === "/" && !isEditableElement(document.activeElement)) {
      event.preventDefault();
      input?.focus();
    }
  });
}
