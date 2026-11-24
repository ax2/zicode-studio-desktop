import { t } from "../../i18n.js";

export function createBrowserNoteClip({ capture, writer, setBusy, isOpen, attachments = () => ({}), analysis, canStart = () => true, onOpened }) {
  let ready = false, busy = false, saved = false;
  const node = (tag, className = "", text) => {
    const el = document.createElement(tag); el.className = className;
    if (text !== undefined) el.textContent = text; return el;
  };
  const action = analysis ? "Save analysis to Notes" : "Save to Notes";
  const button = node("button", "ui-button ui-button--secondary", t(action)); button.type = "button";
  const panel = node("fieldset", "browser-note-clip"); panel.hidden = true;
  panel.append(node("legend", "", t(action)));
  const open = node("button", "ui-button ui-button--secondary hidden", t("Open saved note"));
  open.type = "button"; open.hidden = true;
  const field = (label, input) => { input.setAttribute("aria-label", t(label)); const el = node("label", "", t(label)); el.append(input); panel.append(el); return el; };
  const notebook = node("select", "ui-select"); field("Notebook", notebook);
  const notebookTitle = node("input", "ui-input"); notebookTitle.maxLength = 200; notebookTitle.value = t("Web clippings");
  const newTitle = field("New notebook title", notebookTitle); newTitle.hidden = true;
  const title = node("input", "ui-input"); title.maxLength = 200;
  const sourceTitle = capture.page.title || capture.page.url;
  const defaultTitle = analysis ? `${t(analysis.kind === "summary" ? "Page summary" : "Page analysis")} · ${sourceTitle}` : sourceTitle;
  title.value = [...defaultTitle].slice(0, 200).join(""); field("Note title", title);
  const mode = node("select", "ui-select");
  const option = (value, label) => { const el = node("option", "", label); el.value = value; return el; };
  if (!analysis) {
    mode.append(option("page", t("Page content")));
    if (capture.page.selection.trim()) mode.append(option("selection", t("Selected text")));
    field("Save content", mode);
  }
  const status = node("p", "browser-note-clip-status"); status.setAttribute("role", "status");
  const save = node("button", "ui-button ui-button--primary", t(analysis ? "Save analysis to notebook" : "Save page to notebook"));
  save.type = "button"; save.disabled = true;
  panel.append(status, save);
  notebook.addEventListener("change", () => { newTitle.hidden = notebook.value !== "new"; });
  button.addEventListener("click", async () => {
    if (busy || saved || !canStart() || !isOpen()) return;
    panel.hidden = false;
    if (ready) { notebook.focus(); return; }
    busy = true; button.disabled = true; status.textContent = t("Loading…");
    try {
      const notebooks = await writer.notebooks(); if (!isOpen()) return;
      notebook.replaceChildren(...notebooks.map(v => option(v.id, v.title)), option("new", t("Create notebook")));
      newTitle.hidden = notebook.value !== "new"; ready = true; save.disabled = false; status.textContent = "";
      notebook.focus();
    } catch (error) { if (isOpen()) status.textContent = String(error?.message ?? error); }
    finally { busy = false; button.disabled = false; }
  });
  save.addEventListener("click", async () => {
    if (!ready || busy || saved || !canStart() || !isOpen()) return;
    busy = true; panel.disabled = true; button.disabled = true; setBusy(true); status.textContent = t("Saving…");
    try {
      await writer.save({ notebookId: notebook.value === "new" ? null : notebook.value,
        notebookTitle: notebookTitle.value, title: title.value, selectionOnly: mode.value === "selection", ...(mode.value === "page" ? attachments() : {}) });
      saved = true; status.textContent = t("Saved to Notes. The source and capture time are included.");
      save.textContent = t("Saved to Notes");
    } catch (error) { status.textContent = String(error?.message ?? error); }
    finally { busy = false; setBusy(false); panel.disabled = saved; button.disabled = saved; }
    if (saved && isOpen()) { open.hidden = false; open.classList.remove("hidden"); open.focus(); }
  });
  open.addEventListener("click", () => {
    if (!saved || !canStart() || !isOpen()) return;
    try { writer.open(); onOpened?.(); }
    catch { status.textContent = t("Page or destination changed. Read the page again."); }
  });
  return { button, panel, open };
}
