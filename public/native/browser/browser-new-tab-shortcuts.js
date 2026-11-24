import { t } from "../../i18n.js";

const visibleLimit = 12;

export function createBrowserNewTabShortcuts({ list, open, manage, onChange }) {
  const panel = document.createElement("section");
  panel.className = "browser-new-tab-shortcuts";
  panel.setAttribute("aria-label", t("Website shortcuts"));
  panel.setAttribute("data-i18n-aria-label", "Website shortcuts");
  let tab = null, revision = 0, bookmarks = [];

  function refresh() {
    if (!tab) return;
    const source = tab, request = ++revision;
    const current = () => revision === request && tab === source;
    void list().then(items => {
      if (!current()) return;
      bookmarks = items;
      panel.replaceChildren();
      if (!bookmarks.length) { onChange(); return; }
      const inner = document.createElement("div");
      const heading = document.createElement("h2");
      heading.textContent = t("Website shortcuts");
      heading.dataset.i18nText = "Website shortcuts";
      const grid = document.createElement("div");
      grid.className = "browser-new-tab-shortcut-grid";
      for (const bookmark of bookmarks.slice(0, visibleLimit)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ui-button ui-button--secondary";
        button.title = bookmark.url;
        const title = document.createElement("strong");
        title.textContent = bookmark.title;
        const host = document.createElement("span");
        host.textContent = new URL(bookmark.url).hostname;
        button.append(title, host);
        button.addEventListener("click", () => { if (current()) open(bookmark, source); });
        grid.append(button);
      }
      inner.append(heading, grid);
      if (bookmarks.length > visibleLimit) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "ui-button ui-button--ghost";
        more.textContent = t("All bookmarks");
        more.dataset.i18nText = "All bookmarks";
        more.addEventListener("click", () => { if (current()) manage(); });
        inner.append(more);
      }
      panel.append(inner);
      onChange();
    }).catch(() => {
      // The address bar and the native blank tab stay available without the library.
      if (!current()) return;
      bookmarks = [];
      panel.replaceChildren();
      onChange();
    });
  }

  return {
    select(id) {
      if (id === tab) return;
      tab = id;
      revision++;
      bookmarks = [];
      panel.remove();
      panel.replaceChildren();
      refresh();
    },
    ready(id) { return !!id && id === tab && bookmarks.length > 0; },
    show(host) { if (panel.parentElement !== host) host.append(panel); },
    clear() { panel.remove(); },
    refresh,
  };
}
