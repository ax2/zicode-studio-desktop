import { createBookmarkTransfer } from "./browser-bookmark-transfer.js";
import { t } from "../../i18n.js";
import { createBackgroundOpenButton } from "./browser-background-open.js";
import { folderOptions, removeBookmarkFolder } from "./browser-bookmarks-data.js";

export function showBrowserBookmarks({ invoke, current, editCurrent = false, onOpen, onClose }) {
  let library = { revision: 0, folders: [], bookmarks: [] }, editing = null, filter = "*", query = "", busy = false;
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const dialog = el("dialog", "browser-bookmarks-dialog ui-panel"); dialog.setAttribute("aria-label", t("Bookmarks"));
  const heading = el("h2", "", t("Bookmarks"));
  const content = el("fieldset", "browser-bookmarks-content");
  const message = el("p"); message.setAttribute("role", "status");
  const run = async action => {
    if (busy) return; busy = true; content.disabled = true; message.textContent = "";
    try { await action(); }
    catch (error) { message.textContent = t(String(error?.message ?? error)); }
    finally { busy = false; content.disabled = false; }
  };
  const button = (label, action, className = "ui-button ui-button--secondary") => {
    const node = el("button", className, t(label)); node.type = "button";
    node.addEventListener("click", () => void run(action)); return node;
  };
  // Closing the manager is always possible, including during a slow metadata read.
  const close = el("button", "ui-button ui-button--secondary", t("Close")); close.type = "button"; close.addEventListener("click", () => dialog.close());
  const request = request => invoke("browser_bookmarks", { request });
  const save = async (folders, bookmarks) => {
    library = await request({ kind: "save", expectedRevision: library.revision, folders, bookmarks });
    editing = null; render(); message.textContent = t("Bookmarks saved");
  };
  const transfer = createBookmarkTransfer({ invoke, getLibrary: () => library, save, isOpen: () => dialog.isConnected, run, report: text => { message.textContent = text; } });
  const beginCurrent = () => {
    if (!current) return;
    const found = library.bookmarks.find(item => item.url === current.url);
    editing = { kind: "bookmark", ...(found ?? { id: null, title: current.title || current.url, url: current.url, folderId: filter === "*" ? null : filter || null }) }; render();
  };
  function folderSelect(label, value, excludedId = null, all = false) {
    const select = el("select", "ui-select"); select.setAttribute("aria-label", t(label));
    const add = (id, title) => { const option = el("option", "", title); option.value = id; select.append(option); };
    if (all) add("*", t("All bookmarks")); add("", t("Bookmarks root"));
    for (const folder of folderOptions(library.folders, excludedId)) add(folder.id, folder.title);
    select.value = value ?? ""; return select;
  }
  function renderEditor() {
    if (!editing) return null;
    const draft = { ...editing }, isFolder = draft.kind === "folder";
    const form = el("form", "browser-bookmark-editor"); form.setAttribute("aria-label", t(isFolder ? "Folder editor" : "Bookmark editor"));
    const title = el("input", "ui-input"); title.required = true; title.maxLength = isFolder ? 256 : 4096; title.value = draft.title;
    const titleLabel = el("label", "", t(isFolder ? "Folder name" : "Bookmark name")); titleLabel.append(title);
    const parent = folderSelect(isFolder ? "Parent folder" : "Bookmark folder", isFolder ? draft.parentId : draft.folderId, isFolder ? draft.id : null);
    const parentLabel = el("label", "", t(isFolder ? "Parent folder" : "Bookmark folder")); parentLabel.append(parent);
    form.append(titleLabel);
    let url;
    if (!isFolder) {
      url = el("input", "ui-input"); url.type = "url"; url.required = true; url.maxLength = 16384; url.value = draft.url;
      const label = el("label", "", t("Bookmark URL")); label.append(url); form.append(label);
    }
    form.append(parentLabel);
    const actions = el("div", "ui-toolbar");
    const submit = el("button", "ui-button ui-button--primary", t("Save")); submit.type = "submit";
    actions.append(submit, button("Cancel", () => { editing = null; render(); }));
    if (draft.id) actions.append(button(isFolder ? "Delete folder" : "Delete bookmark", async () => {
      if (isFolder) {
        const next = removeBookmarkFolder(library, draft.id);
        if (filter === draft.id) filter = draft.parentId ?? "";
        await save(next.folders, next.bookmarks);
      } else await save(library.folders, library.bookmarks.filter(item => item.id !== draft.id));
    }, "ui-button ui-button--danger"));
    form.append(actions);
    if (isFolder && draft.id) form.append(el("p", "browser-bookmark-help", t("Deleting this folder moves its bookmarks and subfolders to its parent.")));
    form.addEventListener("submit", event => {
      event.preventDefault(); if (!form.reportValidity()) return;
      void run(async () => {
        const id = draft.id ?? crypto.randomUUID();
        const item = isFolder ? { id, title: title.value.trim(), parentId: parent.value || null } : { id, title: title.value.trim(), url: url.value.trim(), folderId: parent.value || null };
        const list = isFolder ? library.folders : library.bookmarks;
        const next = draft.id ? list.map(old => old.id === id ? item : old) : [...list, item];
        await save(isFolder ? next : library.folders, isFolder ? library.bookmarks : next);
      });
    });
    return form;
  }
  function render() {
    if (!dialog.isConnected) return;
    const toolbar = el("div", "ui-toolbar browser-bookmark-toolbar");
    const add = button("Bookmark this page", beginCurrent); add.disabled = !current;
    toolbar.append(add, button("New bookmark", () => { editing = { kind: "bookmark", id: null, title: "", url: "https://", folderId: filter === "*" ? null : filter || null }; render(); }),
      button("New folder", () => { editing = { kind: "folder", id: null, title: "", parentId: filter === "*" ? null : filter || null }; render(); }),
      button("Reload bookmarks", async () => { library = await request({ kind: "list" }); editing = null; render(); }));
    if (!editing) toolbar.append(...transfer.buttons);
    const search = el("input", "ui-input"); search.type = "search"; search.value = query; search.placeholder = t("Search bookmarks"); search.setAttribute("aria-label", t("Search bookmarks"));
    if (filter !== "*" && filter && !library.folders.some(f => f.id === filter)) filter = "";
    const folders = folderSelect("Show folder", filter, null, true);
    const filters = el("div", "browser-bookmark-filters"); filters.append(search, folders);
    const list = el("div", "browser-bookmark-list"); list.setAttribute("role", "list");
    function renderList() {
      list.replaceChildren(); const term = query.toLocaleLowerCase();
      for (const folder of library.folders.filter(f => (filter === "*" || (f.parentId ?? "") === filter) && f.title.toLocaleLowerCase().includes(term))) {
        const row = el("div", "browser-bookmark-row"); row.setAttribute("role", "listitem"); row.dataset.folderId = folder.id;
        const name = button("", () => { filter = folder.id; editing = null; render(); }); name.textContent = folder.title;
        name.setAttribute("aria-label", `${t("Open folder")}: ${folder.title}`);
        const edit = button("Edit", () => { editing = { kind: "folder", ...folder }; render(); }); edit.setAttribute("aria-label", `${t("Edit folder")}: ${folder.title}`);
        row.append(name, edit); list.append(row);
      }
      for (const bookmark of library.bookmarks.filter(b => (filter === "*" || (b.folderId ?? "") === filter) && `${b.title} ${b.url}`.toLocaleLowerCase().includes(term))) {
        const row = el("div", "browser-bookmark-row"); row.setAttribute("role", "listitem"); row.dataset.bookmarkId = bookmark.id;
        const details = el("div", "browser-bookmark-details");
        const open = button("", async () => { await onOpen(bookmark); dialog.close(); }); open.textContent = bookmark.title; open.setAttribute("aria-label", `${t("Open bookmark")}: ${bookmark.title}`);
        const source = el("span", "browser-bookmark-url", bookmark.url); source.title = bookmark.url; details.append(open, source);
        const edit = button("Edit", () => { editing = { kind: "bookmark", ...bookmark }; render(); }); edit.setAttribute("aria-label", `${t("Edit bookmark")}: ${bookmark.title}`);
        const actions = el("div", "ui-toolbar");
        actions.append(createBackgroundOpenButton(bookmark, { onOpen, run, message }), edit);
        row.append(details, actions); list.append(row);
      }
      if (!list.childElementCount) list.append(el("p", "", t("No bookmarks in this view")));
    }
    search.addEventListener("input", () => { query = search.value; renderList(); });
    folders.addEventListener("change", () => { filter = folders.value; renderList(); });
    content.replaceChildren(toolbar); if (!editing) content.append(transfer.preview); const editor = renderEditor();if (editor) content.append(editor);content.append(filters, list);renderList();
  }
  dialog.append(heading, content, message, close);
  dialog.addEventListener("close", () => { dialog.remove(); onClose(); }, { once: true });
  document.body.append(dialog); dialog.showModal(); close.focus();
  void run(async () => { library = await request({ kind: "list" }); if (editCurrent && current) beginCurrent(); else render(); });
  return dialog;
}
