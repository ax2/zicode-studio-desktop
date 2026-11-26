import { t } from "../../i18n.js";
import { nextBookmarkPosition } from "./browser-bookmarks-data.js";

function countDuplicates(imported, library) {
  const seen = new Set(library.bookmarks.map(bookmark => new URL(bookmark.url).href));
  let count = 0;
  for (const bookmark of imported.bookmarks) {
    const url = new URL(bookmark.url).href;
    if (seen.has(url)) count++;
    else seen.add(url);
  }
  return count;
}

export function createBookmarkTransfer({ invoke, getLibrary, save, isOpen, run, report }) {
  const preview = document.createElement("section");
  preview.className = "browser-bookmark-import ui-panel";
  preview.hidden = true;
  preview.setAttribute("aria-label", t("Review bookmark import"));
  const limits = document.createElement("p");
  limits.className = "browser-bookmark-transfer-limits";
  limits.textContent = t("HTML imports allow up to 32 MiB, 50,000 links and 999 folders per file. The profile has a 4 MiB bookmark storage limit.");
  let pending;

  const button = (label, action) => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "ui-button ui-button--secondary";
    node.textContent = t(label);
    node.addEventListener("click", () => void run(action));
    return node;
  };

  function clear() {
    pending = null;
    preview.replaceChildren();
    preview.hidden = true;
  }

  function show(result) {
    const summary = document.createElement("p");
    summary.textContent = t("Import {bookmarks} bookmarks and {folders} folders into a new folder.").replace("{bookmarks}", String(result.bookmarks.length)).replace("{folders}", String(result.folders.length));
    const duplicates = document.createElement("p");
    const skipped = document.createElement("p");
    skipped.textContent = t("Skipped {count} unsupported or invalid links.").replace("{count}", String(result.skipped));
    const label = document.createElement("label");
    label.textContent = t("Import folder name");
    const title = document.createElement("input");
    title.className = "ui-input";
    title.value = t("Imported bookmarks");
    title.maxLength = 256;
    title.required = true;
    label.append(title);
    title.addEventListener("input", () => title.setCustomValidity(""));

    let reviewedRevision;
    function refresh() {
      const current = getLibrary();
      if (current.revision === reviewedRevision) return;
      duplicates.textContent = t("Duplicate links to keep: {count}.").replace("{count}", String(countDuplicates(result, current)));
      reviewedRevision = current.revision;
    }

    const review = { refresh };
    const confirm = button("Import bookmarks", async () => {
      if (pending !== review || !isOpen()) return;
      if (!title.value.trim()) {
        title.setCustomValidity(t("Enter a folder name"));
        title.reportValidity();
        return;
      }
      const current = getLibrary();
      if (current.revision !== reviewedRevision) {
        refresh();
        report(t("Bookmarks changed. Review the updated counts before importing."));
        return;
      }
      const root = crypto.randomUUID();
      const importFolder = { id: root, title: title.value.trim(), parentId: null, position: nextBookmarkPosition(current, null) };
      const folders = [...current.folders, importFolder, ...result.folders.map(folder => ({ ...folder, parentId: folder.parentId ?? root }))];
      const bookmarks = [...current.bookmarks, ...result.bookmarks.map(bookmark => ({ ...bookmark, folderId: bookmark.folderId ?? root }))];
      await save(folders, bookmarks);
      if (!isOpen()) return;
      clear();
      report(t("Bookmarks imported. Existing bookmarks were kept."));
    });
    confirm.disabled = !result.bookmarks.length && !result.folders.length;
    const actions = document.createElement("div");
    actions.className = "ui-toolbar";
    actions.append(confirm, button("Cancel import", clear));

    refresh();
    pending = review;
    preview.replaceChildren(summary, duplicates, skipped, label, actions);
    preview.hidden = false;
  }

  const importButton = button("Import HTML…", async () => {
    clear();
    const result = await invoke("browser_bookmark_file", { request: { kind: "import" } });
    if (result && isOpen()) show(result);
  });
  const exportButton = button("Export HTML…", async () => {
    const result = await invoke("browser_bookmark_file", { request: { kind: "export", expectedRevision: getLibrary().revision } });
    if (result && isOpen()) report(t("Bookmarks exported to {name}").replace("{name}", result.name));
  });
  return { buttons: [importButton, exportButton], limits, preview, refresh: () => pending?.refresh() };
}
