export function closeOnSearchEscape(dialog, search, requestClose = () => dialog.close()) {
  search.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.isComposing || event.keyCode === 229 || !dialog.open) return;
    // Chromium otherwise uses Escape to clear a nonempty search field first.
    event.preventDefault();
    event.stopPropagation();
    void requestClose();
  });
}
