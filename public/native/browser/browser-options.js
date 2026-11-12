import { t } from "../../i18n.js";

export function createBrowserOptions(startup, selectAll, { reopen = () => {}, canReopen = () => false, bookmarks, history, searchTabs, pageControls, find, fullscreen, searchSettings, pin, reader, translateSelection, screenshot, savePdf } = {}) {
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
  restore.title = `${t("Restore the latest closed tab. The last 50 are kept after restart.")} (Ctrl+Shift+T)`; restore.setAttribute("aria-keyshortcuts", "Control+Shift+t");
  restore.addEventListener("click", () => { menu.open = false; reopen(); });
  menu.addEventListener("toggle", () => { restore.disabled = !canReopen(); });
  if (pageControls) { panel.append(pageControls.element); menu.addEventListener("toggle", () => { if (menu.open) void pageControls.refresh(); }); }
  if (find) {
    const search = document.createElement("button"); search.type = "button"; search.className = "ui-button ui-button--secondary browser-find-open"; search.textContent = t("Find in page"); search.setAttribute("aria-keyshortcuts", "Control+f");
    search.addEventListener("click", () => { menu.open = false; find(); }); panel.append(search);
  }
  if (fullscreen) { panel.append(fullscreen.element); menu.addEventListener("toggle", () => { if (menu.open) void fullscreen.refresh(); }); }
  panel.append(select, restore);
  if (pin) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "ui-button ui-button--secondary browser-pin-tab";
    const refresh = () => {
      const { pinned, enabled, available } = pin.state();
      button.hidden = available === false;
      button.textContent = t(pinned ? "Unpin tab" : "Pin tab");
      button.title = !enabled && !pinned ? t("Pin up to four tabs") : "";
      button.disabled = !enabled;
    };
    button.addEventListener("click", () => { menu.open = false; pin.toggle(); });
    menu.addEventListener("toggle", () => { if (menu.open) refresh(); });
    refresh(); panel.append(button);
  }
  for (const [name, open] of [["Search tabs", searchTabs], ["Bookmarks", bookmarks], ["Browsing history", history]]) {
    if (!open) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-button ui-button--secondary";
    button.textContent = t(name);
    if (name === "Search tabs") {
      button.setAttribute("aria-keyshortcuts", "Control+Shift+a");
      button.title = `${t(name)} (Ctrl+Shift+A)`;
    } else if (name === "Browsing history") {
      button.setAttribute("aria-keyshortcuts", "Control+h");
      button.title = `${t(name)} (Ctrl+H)`;
    }
    button.addEventListener("click", async () => { await open(); menu.open = false; });
    panel.append(button);
  }
  for (const [name, action] of [["Reading mode", reader], ["Translate selected text", translateSelection], ["Save viewport PNG to Downloads", screenshot], ["Save page PDF to Downloads", savePdf]]) {
    if (!action) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-button ui-button--secondary";
    button.textContent = t(name);
    button.addEventListener("click", () => { menu.open = false; action(); });
    panel.append(button);
  }
  if (searchSettings) panel.append(searchSettings.element);
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
