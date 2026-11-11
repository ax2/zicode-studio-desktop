import { t } from "../../i18n.js";

export function createBackgroundOpenButton(page, { onOpen, run, message }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ui-icon-button ui-icon-button--sm ui-icon-button--secondary";
  button.title = t("Open in background tab");
  button.setAttribute("aria-label", `${button.title}: ${page.title || page.url}`);
  button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="13" height="12" rx="2"/><path d="M8 8V6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3M7 14h5m-2.5-2.5v5"/></svg>';
  button.addEventListener("click", async () => {
    const wasFocused = document.activeElement === button;
    await run(async () => {
      await onOpen(page, { background: true });
      message.textContent = t("Opened in a background tab");
    });
    if (wasFocused && button.isConnected && document.activeElement === document.body) {
      button.focus({ preventScroll: true });
    }
  });
  return button;
}
