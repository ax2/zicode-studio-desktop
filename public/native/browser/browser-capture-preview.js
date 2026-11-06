import { t } from "../../i18n.js";

export function showBrowserCapture(capture, onClose, prepareDraft) {
  const dialog = document.createElement("dialog");
  dialog.className = "browser-capture-dialog ui-panel";
  dialog.setAttribute("aria-label", t("Page content"));
  const title = document.createElement("h2"); title.textContent = capture.page.title || t("Page content");
  const source = document.createElement("p"); source.textContent = capture.page.url;
  const text = document.createElement("textarea"); text.className = "ui-textarea"; text.readOnly = true;
  text.setAttribute("aria-label", t("Page content"));
  text.value = `${capture.page.selection ? `${t("Selected text")}\n${capture.page.selection}\n\n` : ""}${capture.page.text}`;
  const note = document.createElement("p"); note.textContent = capture.page.truncated ? t("Page content was shortened") : t("Content read locally. Nothing has been sent to AI.");
  const close = document.createElement("button"); close.type = "button"; close.className = "ui-button ui-button--primary"; close.textContent = t("Close");
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { dialog.remove(); onClose(); }, { once: true });
  const actions = document.createElement("div"); actions.className = "ui-toolbar";
  const error = document.createElement("p"); error.setAttribute("role", "alert");
  if (prepareDraft) {
    const prepare = document.createElement("button"); prepare.type = "button"; prepare.className = "ui-button ui-button--secondary";
    prepare.textContent = t("Prepare chat draft"); prepare.title = t("Adds this snapshot to the current conversation. Nothing is sent until you press Send.");
    prepare.addEventListener("click", async () => {
      prepare.disabled = true; error.textContent = "";
      try { await prepareDraft(); dialog.close(); }
      catch (reason) { error.textContent = String(reason?.message ?? reason); }
      finally { prepare.disabled = false; }
    });
    actions.append(prepare);
  }
  actions.append(close);
  dialog.append(title, source, text, note, error, actions); document.body.append(dialog); dialog.showModal();
  close.focus({ preventScroll: true }); text.setSelectionRange(0, 0); text.scrollTop = 0;
  return dialog;
}
