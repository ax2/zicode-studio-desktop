import { t } from "../../i18n.js";

import { decorateBrowserCommands } from "./browser-menu-icons.js";

export function createBrowserOptions(startup, selectAll, { reopen = () => {}, canReopen = () => false, windows, bookmarks, downloads, history, siteSettings, searchTabs, pageControls, find, fullscreen, searchSettings, pin, reader, openLocalPdf, translateSelection, screenshot, savePdf, print, developerTools, userAgentSettings, proxySettings, websiteShortcuts } = {}) {
  const menu = document.createElement("details"); menu.className = "browser-options";
  const trigger = document.createElement("summary"); trigger.className = "ui-icon-button ui-icon-button--sm ui-icon-button--ghost";
  trigger.title = t("Browser options"); trigger.setAttribute("aria-label", t("Browser options"));
  trigger.setAttribute("data-i18n-title", "Browser options");
  trigger.setAttribute("data-i18n-aria-label", "Browser options");
  trigger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
  const panel = document.createElement("div"); panel.className = "browser-options-panel ui-panel";
  function group() {
    const section = document.createElement("div");
    section.className = "browser-menu-group";
    panel.append(section);
    return section;
  }
  const tabs = group();
  const library = group();
  const page = group();
  const settings = group();
  settings.classList.add("browser-menu-settings");
  if (openLocalPdf) {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "ui-button ui-button--secondary browser-open-local-pdf";
    open.dataset.i18nText = "Open local PDF…";
    open.textContent = t("Open local PDF…");
    open.addEventListener("click", () => { menu.open = false; void openLocalPdf(trigger); });
    tabs.append(open);
  }
  if (websiteShortcuts) {
    const shortcuts = document.createElement("div");
    shortcuts.hidden = true;
    shortcuts.setAttribute("role", "group");
    shortcuts.setAttribute("aria-label", t("Website shortcuts"));
    library.append(shortcuts);
    const add = websiteShortcuts.add && document.createElement("button");
    const available = () => websiteShortcuts.available?.() !== false;
    if (add) {
      const label = "Add website shortcut";
      add.type = "button";
      add.className = "ui-button ui-button--secondary";
      add.dataset.i18nText = label;
      add.textContent = t(label);
      add.hidden = true;
      add.addEventListener("click", () => {
        if (!menu.open || !available()) return;
        menu.open = false;
        void websiteShortcuts.add(trigger);
      });
      library.append(add);
    }
    let revision = 0;
    menu.addEventListener("toggle", async () => {
      const request = ++revision;
      shortcuts.replaceChildren(); shortcuts.hidden = true;
      const show = menu.open && available();
      if (add) add.hidden = !show;
      if (!show) return;
      try {
        const items = await websiteShortcuts.list();
        if (!menu.open || revision !== request || !available() || !items.length) return;
        const label = document.createElement("strong"); label.textContent = t("Website shortcuts");
        shortcuts.append(label);
        for (const item of items) {
          const button = document.createElement("button");
          button.type = "button"; button.className = "ui-button ui-button--secondary browser-site-shortcut";
          button.textContent = item.title; button.title = item.url;
          button.addEventListener("click", () => { menu.open = false; websiteShortcuts.open(item); });
          shortcuts.append(button);
        }
        shortcuts.hidden = false;
      } catch (error) {
        if (menu.open && request === revision) websiteShortcuts.report(error);
      }
    });
  }
  const select = document.createElement("button"); select.type = "button"; select.className = "ui-button ui-button--secondary"; select.textContent = t("Select all page text");
  select.dataset.i18nText = "Select all page text";
  select.addEventListener("click", () => { menu.open = false; selectAll(); });
  const label = document.createElement("label");
  const labelText = document.createElement("span");
  labelText.textContent = t("Start Studio in");
  labelText.dataset.i18nText = "Start Studio in";
  label.append(labelText, startup);
  const restore = document.createElement("button"); restore.type = "button"; restore.className = "ui-button ui-button--secondary browser-reopen";
  restore.textContent = t("Reopen closed tab"); restore.disabled = !canReopen();
  restore.dataset.i18nText = "Reopen closed tab";
  restore.title = `${t("Restore the latest closed tab. The last 50 are kept after restart.")} (Ctrl+Shift+T)`; restore.setAttribute("aria-keyshortcuts", "Control+Shift+t");
  restore.addEventListener("click", () => { menu.open = false; reopen(); });
  menu.addEventListener("toggle", () => { restore.disabled = !canReopen(); });
  if (windows) {
    const addWindowButton = (label, action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ui-button ui-button--secondary";
      button.dataset.i18nText = label;
      button.textContent = t(label);
      button.addEventListener("click", () => { menu.open = false; windows(action); });
      tabs.append(button);
      return button;
    };
    addWindowButton("New browser window", "new");
    addWindowButton("Browser profiles", "profiles").classList.add("browser-regular-option");
    addWindowButton("New private window", "private").classList.add("browser-regular-option");
    const privacy=document.createElement("p");privacy.className="browser-private-notice";
    privacy.textContent=t("Private tabs, browsing history and site data are discarded when this window closes. Files you choose to save are kept.");
    tabs.append(privacy);
    const reopenWindow = addWindowButton("Reopen closed window", "reopen");
    reopenWindow.disabled = true;
    menu.addEventListener("toggle", async () => {
      if (menu.open) reopenWindow.disabled = !await windows("canReopen");
    });
  }
  if (pageControls) { page.append(pageControls.element); menu.addEventListener("toggle", () => { if (menu.open) void pageControls.refresh(); }); }
  if (find) {
    const search = document.createElement("button"); search.type = "button"; search.className = "ui-button ui-button--secondary browser-find-open"; search.textContent = t("Find in page"); search.setAttribute("aria-keyshortcuts", "Control+f");
    search.dataset.i18nText = "Find in page";
    search.addEventListener("click", () => { menu.open = false; find(); }); page.append(search);
  }
  if (fullscreen) { page.append(fullscreen.element); menu.addEventListener("toggle", () => { if (menu.open) void fullscreen.refresh(); }); }
  page.append(select); tabs.append(restore);
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
    refresh(); tabs.append(button);
  }
  for (const [name, open] of [["Search tabs", searchTabs], ["Bookmarks", bookmarks], ["Downloads", downloads], ["Browsing history", history], ["Site permissions and storage", siteSettings]]) {
    if (!open) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-button ui-button--secondary";
    button.textContent = t(name);
    button.dataset.i18nText = name;
    if (name === "Search tabs") {
      button.setAttribute("aria-keyshortcuts", "Control+Shift+a");
      button.title = `${t(name)} (Ctrl+Shift+A)`;
    } else if (name === "Downloads") {
      button.setAttribute("aria-keyshortcuts", "Control+j");
    } else if (name === "Browsing history") {
      button.setAttribute("aria-keyshortcuts", "Control+h");
      button.title = `${t(name)} (Ctrl+H)`;
    }
    button.addEventListener("click", async () => { await open(); menu.open = false; });
    (name === "Site permissions and storage" ? settings : library).append(button);
  }
  for (const [name, action] of [["Reading mode", reader], ["Translate selected text", translateSelection], ["Save viewport PNG to Downloads", screenshot], ["Print page…", print], ["Save page PDF to Downloads", savePdf], ["Developer tools", developerTools?.open]]) {
    if (!action) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-button ui-button--secondary";
    button.textContent = t(name);
    button.dataset.i18nText = name;
    if (action === print) { button.title = `${t(name)} (Ctrl+P)`; button.setAttribute("aria-keyshortcuts", "Control+p"); }
    button.addEventListener("click", () => { menu.open = false; action(); });
    page.append(button);
    if (name === "Developer tools") {
      const context = document.createElement("p");
      context.id = "browser-developer-tools-context";
      context.className = "browser-developer-tools-context";
      button.setAttribute("aria-describedby", context.id);
      page.append(context);
      const refresh = () => {
        const { target, description } = developerTools.state();
        button.disabled = !target;
        if (context.textContent !== description) context.textContent = description;
      };
      menu.refreshDeveloperTools = refresh;
      menu.addEventListener("toggle", () => { if (menu.open) refresh(); });
      refresh();
    }
  }
  if (userAgentSettings) settings.append(userAgentSettings);
  if (proxySettings) settings.append(proxySettings);
  if (searchSettings) settings.append(searchSettings.element);
  settings.append(label); menu.append(trigger, panel);
  decorateBrowserCommands(panel);
  menu.addEventListener("keydown", event => {
    if (event.key === "Escape" && menu.open && !event.isComposing) { event.preventDefault(); event.stopPropagation(); menu.open = false; trigger.focus(); }
  });
  const dismiss = event => { if (menu.open && !menu.contains(event.target)) menu.open = false; };
  // The Browser view is retained for the window lifetime, just like its tabs.
  document.addEventListener("pointerdown", dismiss);
  document.addEventListener("focusin", dismiss);
  return menu;
}
