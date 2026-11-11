import { t } from "../../i18n.js";

export function createBrowserNoteClip({ capture, writer, setBusy, isOpen, attachments = () => ({}) }) {
  let ready = false, busy = false, saved = false;
  const node = (tag, className = "", text) => {
    const el = document.createElement(tag); el.className = className;
    if (text !== undefined) el.textContent = text; return el;
  };
  const button = node("button", "ui-button ui-button--secondary", t("Save to Notes")); button.type = "button";
  const panel = node("fieldset", "browser-note-clip"); panel.hidden = true;
  panel.append(node("legend", "", t("Save to Notes")));
  const field = (label, input) => { input.setAttribute("aria-label", t(label)); const el = node("label", "", t(label)); el.append(input); panel.append(el); return el; };
  const notebook = node("select", "ui-select"); field("Notebook", notebook);
  const notebookTitle = node("input", "ui-input"); notebookTitle.maxLength = 200; notebookTitle.value = t("Web clippings");
  const newTitle = field("New notebook title", notebookTitle); newTitle.hidden = true;
  const title = node("input", "ui-input"); title.maxLength = 200;
  title.value = [...(capture.page.title || capture.page.url)].slice(0, 200).join(""); field("Note title", title);
  const mode = node("select", "ui-select");
  const option = (value, label) => { const el = node("option", "", label); el.value = value; return el; };
  mode.append(option("page", t("Page content")));
  if (capture.page.selection.trim()) mode.append(option("selection", t("Selected text")));
  field("Save content", mode);
  const status = node("p", "browser-note-clip-status"); status.setAttribute("role", "status");
  const save = node("button", "ui-button ui-button--primary", t("Save page to notebook")); save.type = "button"; save.disabled = true;
  panel.append(status, save);
  notebook.addEventListener("change", () => { newTitle.hidden = notebook.value !== "new"; });
  button.addEventListener("click", async () => {
    if (busy || saved) return;
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
    if (!ready || busy || saved) return;
    busy = true; panel.disabled = true; button.disabled = true; setBusy(true); status.textContent = t("Saving…");
    try {
      await writer.save({ notebookId: notebook.value === "new" ? null : notebook.value,
        notebookTitle: notebookTitle.value, title: title.value, selectionOnly: mode.value === "selection", ...(mode.value === "page" ? attachments() : {}) });
      saved = true; status.textContent = t("Saved to Notes. The source and capture time are included.");
      save.textContent = t("Saved to Notes");
    } catch (error) { status.textContent = String(error?.message ?? error); }
    finally { busy = false; setBusy(false); panel.disabled = saved; button.disabled = saved; }
  });
  return { button, panel };
}
