import { t } from "../../i18n.js";

const paths = {
  connected: '<path d="M8 12a4 4 0 0 1 4-4h4a4 4 0 0 1 0 8h-1"/><path d="M16 12a4 4 0 0 1-4 4H8a4 4 0 0 1 0-8h1"/>',
  disconnected: '<path d="m3 3 18 18M10 8h6a4 4 0 0 1 2.8 6.8M14 16H8a4 4 0 0 1-2.8-6.8"/>',
  waiting: '<path d="M12 4a8 8 0 1 1-8 8"/><path d="M12 8v4l3 2"/>',
};

export function setupCompactHeader(doc = document) {
  const slot = doc.getElementById("page-header-actions");
  const text = doc.getElementById("status-text");
  const indicator = doc.getElementById("status-indicator");
  const status = text?.parentElement;
  const syncStatus = () => {
    if (!status || !indicator || !text) return;
    const label = t(text.textContent || "Connecting...");
    status.title = label; status.setAttribute("aria-label", label);
    const state = indicator.classList.contains("disconnected") ? "disconnected"
      : indicator.classList.contains("connected") ? "connected" : "waiting";
    if (indicator.dataset.icon === state) return;
    indicator.dataset.icon = state;
    indicator.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[state]}</svg>`;
  };
  const syncActions = () => {
    if (!slot) return;
    const owner = doc.body.dataset.activePlugin;
    for (const child of slot.children) child.hidden = child.dataset.pageHeaderOwner !== owner;
    slot.hidden = ![...slot.children].some(child => !child.hidden);
  };
  if (status) { status.setAttribute("role", "status"); status.tabIndex = 0; }
  const statusObserver = new MutationObserver(syncStatus);
  if (text) statusObserver.observe(text, { childList: true, characterData: true, subtree: true });
  if (indicator) statusObserver.observe(indicator, { attributes: true, attributeFilter: ["class"] });
  const slotObserver = new MutationObserver(syncActions);
  if (slot) slotObserver.observe(slot, { childList: true });
  slotObserver.observe(doc.body, { attributes: true, attributeFilter: ["data-active-plugin"] });
  syncStatus(); syncActions();
  return () => { statusObserver.disconnect(); slotObserver.disconnect(); };
}
