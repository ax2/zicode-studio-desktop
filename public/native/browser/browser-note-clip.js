import { t } from "../../i18n.js";
import { browserAnalysisLabel } from "./browser-analysis-source.js";

export function createBrowserNoteClip({ capture, writer, setBusy, isOpen, attachments = () => ({}), analysis, canStart = () => true, onOpened, canSaveImageText = false }) {
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
  // The writer validates both titles by Unicode code point. HTML maxlength counts UTF-16 units.
  const notebookTitle = node("input", "ui-input"); notebookTitle.value = t("Web clippings");
  const newTitle = field("New notebook title", notebookTitle); newTitle.hidden = true;
  const title = node("input", "ui-input");
  const sourceTitle = analysis?.image?.source?.alt || capture.page.title || capture.page.url;
  const heading = browserAnalysisLabel(analysis?.kind);
  const defaultTitle = analysis ? `${t(heading)} · ${sourceTitle}` : sourceTitle;
  title.value = [...defaultTitle].slice(0, 200).join(""); field("Note title", title);
  const mode = node("select", "ui-select");
  const option = (value, label) => { const el = node("option", "", label); el.value = value; return el; };
  const frameSelections = new Map();
  const framePreview = node("textarea", "ui-textarea");
  framePreview.readOnly = true; framePreview.rows = 2;
  let framePreviewLabel;
  if (!analysis) {
    mode.append(option("page", t("Page content")));
    if (capture.page.selection.trim()) mode.append(option("selection", t("Selected text")));
    for (const [index, frame] of (capture.page.frames ?? []).entries()) {
      if (!frame.selection?.trim()) continue;
      const value = `frame-selection-${index}`;
      const name = t("Selected text from embedded page {number}").replace("{number}", String(index + 1));
      const source = frame.title || frame.url || t("Inline frame");
      frameSelections.set(value, { index, text: frame.selection });
      mode.append(option(value, `${name} · ${source}`));
    }
    if (canSaveImageText) mode.append(option("image-text", t("Only selected image text")));
    field("Save content", mode);
    if (frameSelections.size) {
      framePreviewLabel = field("Selected text", framePreview);
      framePreviewLabel.hidden = true;
    }
  }
  const status = node("p", "browser-note-clip-status"); status.setAttribute("role", "status"); status.tabIndex = -1;
  const save = node("button", "ui-button ui-button--primary", t(analysis ? "Save analysis to notebook" : "Save page to notebook"));
  save.type = "button"; save.disabled = true;
  const selectImageText = node("p", "ui-muted", t("Select the recognized image text you want to save."));
  selectImageText.setAttribute("role", "status");
  selectImageText.hidden = true;
  if (canSaveImageText) panel.append(selectImageText);
  panel.append(status, save);
  function updateScope() {
    const imageTextOnly = mode.value === "image-text";
    const missingImageText = imageTextOnly && !attachments().imageText?.length;
    if (framePreviewLabel) {
      const selection = frameSelections.get(mode.value);
      framePreviewLabel.hidden = !selection;
      framePreview.value = selection?.text ?? "";
    }
    if (canSaveImageText && !saved) {
      save.textContent = t(imageTextOnly ? "Save image text to notebook" : "Save page to notebook");
    }
    selectImageText.hidden = !missingImageText;
    save.disabled = !ready || missingImageText;
  }
  function holdActionFocus(control) {
    const initialFocus = document.activeElement;
    const hadActionFocus = initialFocus === control;
    if (hadActionFocus) status.focus({ preventScroll: true });
    const anchor = hadActionFocus ? status : initialFocus;
    return { hadActionFocus, stillFocused: () => document.hasFocus() && document.activeElement === anchor };
  }
  notebook.addEventListener("change", () => { newTitle.hidden = notebook.value !== "new"; });
  button.addEventListener("click", async () => {
    if (busy || saved || !canStart() || !isOpen()) return;
    panel.hidden = false;
    if (ready) { notebook.focus(); return; }
    status.textContent = t("Loading…");
    const { hadActionFocus, stillFocused } = holdActionFocus(button);
    busy = true; button.disabled = true;
    try {
      const notebooks = await writer.notebooks(); if (!isOpen()) return;
      notebook.replaceChildren(...notebooks.map(v => option(v.id, v.title)), option("new", t("Create notebook")));
      newTitle.hidden = notebook.value !== "new"; ready = true; updateScope(); status.textContent = "";
    } catch (error) { if (isOpen()) status.textContent = String(error?.message ?? error); }
    finally { busy = false; button.disabled = false; }
    if (!isOpen() || panel.hidden) return;
    if (ready && stillFocused()) notebook.focus();
    if (!ready && hadActionFocus && stillFocused()) button.focus({ preventScroll: true });
  });
  save.addEventListener("click", async () => {
    if (!ready || save.disabled || busy || saved || !canStart() || !isOpen()) return;
    status.textContent = t("Saving…");
    const { hadActionFocus, stillFocused } = holdActionFocus(save);
    busy = true; panel.disabled = true; button.disabled = true; setBusy(true);
    try {
      const frameSelection = frameSelections.get(mode.value);
      const content = frameSelection ? { frameSelectionIndex: frameSelection.index } :
        mode.value === "image-text" ? { imageTextOnly: true, imageText: attachments().imageText } :
        mode.value === "page" ? attachments() : {};
      await writer.save({ notebookId: notebook.value === "new" ? null : notebook.value,
        notebookTitle: notebookTitle.value, title: title.value, selectionOnly: mode.value === "selection", ...content });
      saved = true; status.textContent = t("Saved to Notes. The source and capture time are included.");
      save.textContent = t("Saved to Notes");
    } catch (error) { status.textContent = String(error?.message ?? error); }
    finally { busy = false; setBusy(false); panel.disabled = saved; button.disabled = saved; }
    if (!isOpen() || panel.hidden) return;
    if (saved) {
      open.hidden = false; open.classList.remove("hidden");
      if (stillFocused()) open.focus();
    } else if (hadActionFocus && stillFocused()) save.focus({ preventScroll: true });
  });
  open.addEventListener("click", () => {
    if (!saved || !canStart() || !isOpen()) return;
    try { writer.open(); onOpened?.(); }
    catch { status.textContent = t("Page or destination changed. Read the page again."); }
  });
  return { button, panel, open, updateScope };
}
