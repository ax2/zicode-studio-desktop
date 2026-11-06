import { t } from "../../i18n.js";

export function createBrowserOptions(startup, selectAll, { reopen = () => {}, canReopen = () => false, bookmarks, history, pageControls, find } = {}) {
  const menu = document.createElement("details"); menu.className = "browser-options";
  const trigger = document.createElement("summary"); trigger.className = "ui-icon-button ui-icon-button--sm ui-icon-button--ghost";
  trigger.title = t("Browser options"); trigger.setAttribute("aria-label", t("Browser options"));
  trigger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
  const panel = document.createElement("div"); panel.className = "browser-options-panel ui-panel";
  const select = document.createElement("button"); select.type = "button"; select.className = "ui-button ui-button--secondary"; select.textContent = t("Select all page text");
  select.addEventListener("click", () => { menu.open = false; selectAll(); });
  const label = document.createElement("label"); label.textContent = t("Start Studio in"); label.append(startup);
  const restore = document.createElement("button"); restore.type = "button"; restore.className = "ui-button ui-button--secondary browser-reopen";
  restore.textContent = t("Reopen closed tab"); restore.disabled = !canReopen();
  restore.title = t("Restore the latest closed tab. The last 50 are kept after restart.");
  restore.addEventListener("click", () => { menu.open = false; reopen(); });
  menu.addEventListener("toggle", () => { restore.disabled = !canReopen(); });
  if (pageControls) { panel.append(pageControls.element); menu.addEventListener("toggle", () => { if (menu.open) void pageControls.refresh(); }); }
  if (find) {
    const search = document.createElement("button"); search.type = "button"; search.className = "ui-button ui-button--secondary browser-find-open"; search.textContent = t("Find in page"); search.setAttribute("aria-keyshortcuts", "Control+f");
    search.addEventListener("click", () => { menu.open = false; find(); }); panel.append(search);
  }
  panel.append(select, restore);
  if (bookmarks) {
    const saved = document.createElement("button"); saved.type = "button"; saved.className = "ui-button ui-button--secondary"; saved.textContent = t("Bookmarks");
    saved.addEventListener("click", () => { menu.open = false; bookmarks(); }); panel.append(saved);
  }
  if (history) {
    const visits = document.createElement("button"); visits.type = "button"; visits.className = "ui-button ui-button--secondary"; visits.textContent = t("Browsing history");
    visits.addEventListener("click", () => { menu.open = false; history(); }); panel.append(visits);
  }
  panel.append(label); menu.append(trigger, panel);
  menu.addEventListener("keydown", event => {
    if (event.key === "Escape" && menu.open && !event.isComposing) { event.preventDefault(); event.stopPropagation(); menu.open = false; trigger.focus(); }
  });
  const dismiss = event => { if (menu.open && !menu.contains(event.target)) menu.open = false; };
  // The Browser view is retained for the window lifetime, just like its tabs.
  document.addEventListener("pointerdown", dismiss);
  document.addEventListener("focusin", dismiss);
  return menu;
}
