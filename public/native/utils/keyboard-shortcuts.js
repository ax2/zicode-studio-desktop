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
    if (meta && (key === "k" || (key === "p" && event.shiftKey))) {
      event.preventDefault();
      openCommandPalette?.();
      return;
    }

    if (event.key === "/" && !isEditableElement(document.activeElement)) {
      event.preventDefault();
      input?.focus();
    }
  });
}
