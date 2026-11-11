import { t } from "../../i18n.js";

export function setupBrowserTabMenu(host, { available, actionsFor, focusTab }) {
  const doc = host.ownerDocument;
  const view = doc.defaultView;
  const menu = doc.createElement("div");
  menu.className = "browser-tab-menu ui-panel";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  doc.body.append(menu);
  let tabId;

  function close(restoreFocus = false) {
    if (menu.hidden) return;
    const previous = tabId;
    tabId = undefined;
    menu.hidden = true;
    menu.replaceChildren();
    if (restoreFocus) focusTab(previous);
  }

  const enabledItems = () => [...menu.querySelectorAll("button:not(:disabled)")];

  function open(event, keyboard) {
    const row = event.target.closest?.("[data-browser-tab-id]");
    if (!row || !host.contains(row)) return;
    close();
    if (!available()) return;
    const id = row.dataset.browserTabId;
    const actions = actionsFor(id);
    if (!actions.length) return;

    event.preventDefault();
    event.stopPropagation();
    tabId = id;
    menu.setAttribute("aria-label", t("Tab actions"));
    for (const { label, action, disabled, hint } of actions) {
      const item = doc.createElement("button");
      item.type = "button";
      item.className = "ui-button ui-button--sm ui-button--ghost";
      item.setAttribute("role", "menuitem");
      item.tabIndex = -1;
      item.textContent = t(label);
      item.disabled = Boolean(disabled);
      if (hint) item.title = t(hint);
      item.addEventListener("click", () => {
        close(true);
        action();
      });
      menu.append(item);
    }
    menu.hidden = false;
    const anchor = row.getBoundingClientRect();
    const bounds = menu.getBoundingClientRect();
    const edge = 4;
    const x = keyboard ? anchor.left : event.clientX;
    const y = keyboard ? anchor.bottom : event.clientY;
    menu.style.left = `${Math.max(edge, Math.min(x, view.innerWidth - bounds.width - edge))}px`;
    menu.style.top = `${Math.max(edge, Math.min(y, view.innerHeight - bounds.height - edge))}px`;
    enabledItems()[0]?.focus({ preventScroll: true });
  }

  host.addEventListener("contextmenu", event => open(event, false));
  host.addEventListener("keydown", event => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) open(event, true);
  });
  menu.addEventListener("keydown", event => {
    if (event.key === "Tab") { close(true); return; }
    if (event.key === "Escape") close(true);
    else {
      const items = enabledItems();
      const index = items.indexOf(doc.activeElement);
      let target;
      if (event.key === "Home") target = items[0];
      if (event.key === "End") target = items.at(-1);
      if (event.key === "ArrowUp") target = items[(index + items.length - 1) % items.length];
      if (event.key === "ArrowDown") target = items[(index + 1) % items.length];
      if (!target) return;
      target.focus({ preventScroll: true });
    }
    event.preventDefault();
    event.stopPropagation();
  });
  const dismissOutside = event => { if (!menu.contains(event.target)) close(); };
  doc.addEventListener("pointerdown", dismissOutside, true);
  doc.addEventListener("focusin", dismissOutside);
  host.addEventListener("scroll", () => close(true), { passive: true });
  view.addEventListener("resize", () => close(true));
  view.addEventListener("zicode:locale-changed", () => close(true));
  return { close };
}
