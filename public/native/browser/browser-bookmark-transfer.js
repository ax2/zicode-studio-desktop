import { t } from "../../i18n.js";

export function createBookmarkTransfer({ invoke, getLibrary, save, isOpen, run, report }) {
  const preview = document.createElement("section"); preview.className = "browser-bookmark-import ui-panel"; preview.hidden = true;
  preview.setAttribute("aria-label", t("Review bookmark import"));
  let pending;
  const button = (label, action) => {
    const node = document.createElement("button"); node.type = "button"; node.className = "ui-button ui-button--secondary"; node.textContent = t(label);
    node.addEventListener("click", () => void run(action)); return node;
  };
  function clear() { pending = null; preview.replaceChildren(); preview.hidden = true; }
  function show(result) {
    pending = result; preview.replaceChildren(); preview.hidden = false;
    const summary = document.createElement("p"); summary.textContent = t("Import {bookmarks} bookmarks and {folders} folders into a new folder.").replace("{bookmarks}", String(result.bookmarks.length)).replace("{folders}", String(result.folders.length));
    const skipped = document.createElement("p"); skipped.textContent = t("Skipped {count} unsupported or invalid links.").replace("{count}", String(result.skipped));
    const label = document.createElement("label"); label.textContent = t("Import folder name");
    const title = document.createElement("input"); title.className = "ui-input"; title.value = t("Imported bookmarks"); title.maxLength = 256; title.required = true; label.append(title);
    title.addEventListener("input", () => title.setCustomValidity(""));
    const confirm = button("Import bookmarks", async () => {
      if (!pending || !isOpen()) return;
      if (!title.value.trim()) { title.setCustomValidity(t("Enter a folder name")); title.reportValidity(); return; }
      const root = crypto.randomUUID(), current = getLibrary();
      const folders = [...current.folders, { id: root, title: title.value.trim(), parentId: null }, ...pending.folders.map(folder => ({ ...folder, parentId: folder.parentId ?? root }))];
      const bookmarks = [...current.bookmarks, ...pending.bookmarks.map(bookmark => ({ ...bookmark, folderId: bookmark.folderId ?? root }))];
      await save(folders, bookmarks); clear(); report(t("Bookmarks imported. Existing bookmarks were kept."));
    });
    confirm.disabled = !result.bookmarks.length && !result.folders.length;
    const actions = document.createElement("div"); actions.className = "ui-toolbar"; actions.append(confirm, button("Cancel import", clear));
    preview.append(summary, skipped, label, actions);
  }
  const importButton = button("Import HTML…", async () => {
    const result = await invoke("browser_bookmark_file", { request: { kind: "import" } });
    if (result && isOpen()) show(result);
  });
  const exportButton = button("Export HTML…", async () => {
    const result = await invoke("browser_bookmark_file", { request: { kind: "export", expectedRevision: getLibrary().revision } });
    if (result && isOpen()) report(t("Bookmarks exported to {name}").replace("{name}", result.name));
  });
  return { buttons: [importButton, exportButton], preview };
}
