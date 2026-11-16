import { createBrowserCompare } from "./browser-compare.js";
import { createBrowserCaptureMedia } from "./browser-capture-media.js";
import { createBrowserNoteClip } from "./browser-note-clip.js";
import { t } from "../../i18n.js";

export function showBrowserCapture(capture, onClose, prepareDraft, createNoteWriter, comparison, opensChat = false, dock) {
  let busy = false;
  const dialog = document.createElement(dock ? "section" : "dialog");
  dialog.className = dock ? "browser-capture-panel" : "browser-capture-dialog ui-panel";
  if (!dock) dialog.setAttribute("aria-label", t("Page content"));
  const isOpen = () => dialog.isConnected && (Boolean(dock) || dialog.open);
  const dismiss = (restoreFocus = false) => {
    if (!dock) { dialog.close(); return; }
    if (dialog.parentNode !== dock.host) return;
    dialog.remove();
    dock.host.hidden = true;
    dock.trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) dock.trigger.focus({ preventScroll: true });
    onClose();
  };
  const title = document.createElement("h2"); title.textContent = capture.page.title || t("Page content");
  const source = document.createElement("p"); source.textContent = capture.page.url;
  const time = document.createElement("p"); time.textContent = `${t("Captured at")}: ${capture.capturedAt}`;
  const text = document.createElement("textarea"); text.className = "ui-textarea browser-capture-text"; text.readOnly = true;
  text.setAttribute("aria-label", t("Page content"));
  text.value = `${capture.page.selection ? `${t("Selected text")}\n${capture.page.selection}\n\n` : ""}${capture.page.text}`;
  const includeLinks = document.createElement("input"); includeLinks.type = "checkbox";
  const includeTables = document.createElement("input"); includeTables.type = "checkbox";
  const media = createBrowserCaptureMedia(capture.page);
  const attachments = () => ({ includeLinks: includeLinks.checked, includeTables: includeTables.checked, includeMedia: media.include.checked });
  let links;
  const capturedLinks = capture.page.links ?? [];
  if (capturedLinks.length || capture.page.linksTruncated) {
    links = document.createElement("details"); links.className = "browser-capture-links";
    const summary = document.createElement("summary");
    summary.textContent = `${t("Page links")} (${capturedLinks.length})`;
    const list = document.createElement("ul");
    list.tabIndex = 0;
    list.setAttribute("aria-label", t("Page links"));
    for (const link of capturedLinks) {
      const item = document.createElement("li");
      const value = document.createElement("p");
      value.textContent = link.label ? `${link.label} — ${link.url}` : link.url;
      item.append(value); list.append(item);
    }
    const share = document.createElement("label");
    share.append(includeLinks, t("Include links in the page note or chat draft"));
    links.append(summary);
    if (capturedLinks.length) links.append(share, list);
    if (capture.page.linksTruncated) {
      const limit = document.createElement("p"); limit.textContent = t("Only some page links are shown.");
      links.append(limit);
    }
  }
  let tables;
  const capturedTables = capture.page.tables ?? [];
  if (capturedTables.length || capture.page.tablesTruncated) {
    tables = document.createElement("details"); tables.className = "browser-capture-tables";
    const summary = document.createElement("summary");
    summary.textContent = `${t("Page tables")} (${capturedTables.length})`;
    tables.append(summary);
    if (capturedTables.length) {
      const share = document.createElement("label");
      share.append(includeTables, t("Include tables in the page note or chat draft"));
      const scroll = document.createElement("div"); scroll.className = "browser-capture-tables-scroll";
      scroll.tabIndex = 0; scroll.setAttribute("role", "region"); scroll.setAttribute("aria-label", t("Page tables"));
      for (const { caption, rows, firstRowHeader } of capturedTables) {
        const table = document.createElement("table");
        if (caption) table.createCaption().textContent = caption;
        const body = table.createTBody();
        rows.forEach((row, index) => {
          const header = index === 0 && firstRowHeader;
          const tr = header ? table.createTHead().insertRow() : body.insertRow();
          for (const value of row) {
            const cell = document.createElement(header ? "th" : "td");
            if (header) cell.scope = "col";
            cell.textContent = value; tr.append(cell);
          }
        });
        scroll.append(table);
      }
      tables.append(share, scroll);
    }
    if (capture.page.tablesTruncated) {
      const limit = document.createElement("p"); limit.textContent = t("Only some table data is shown.");
      tables.append(limit);
    }
  }
  const note = document.createElement("p"); note.textContent = capture.page.truncated ? t("Page content was shortened") : t("Content read locally. Nothing has been sent to AI.");
  const close = document.createElement("button"); close.type = "button"; close.className = "ui-button ui-button--primary"; close.textContent = t("Close");
  close.addEventListener("click", () => { if (!busy) dismiss(true); });
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => { dialog.remove(); onClose(); }, { once: true });
  if (dock) dialog.addEventListener("keydown", event => {
    if (event.key !== "Escape" || busy || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    dismiss(true);
  });
  const actions = document.createElement("div"); actions.className = "ui-toolbar";
  const error = document.createElement("p"); error.setAttribute("role", "alert");
  let questionLabel, question;
  if (dock && prepareDraft) {
    questionLabel = document.createElement("label"); questionLabel.className = "browser-capture-question";
    question = document.createElement("textarea"); question.className = "ui-textarea"; question.rows = 2; question.maxLength = 5000;
    questionLabel.append(t("Question about this page"), question);
  }
  if (prepareDraft) {
    const prepare = document.createElement("button"); prepare.type = "button"; prepare.className = "ui-button ui-button--secondary browser-capture-prepare";
    prepare.textContent = t(opensChat ? "Open Chat and prepare draft" : "Prepare chat draft"); prepare.title = t("Adds this snapshot to the current conversation. Nothing is sent until you press Send.");
    const stageDraft = async intent => {
      if (busy || !isOpen()) return;
      setBusy(true); error.textContent = "";
      try { await prepareDraft({ ...attachments(), ...intent }); dismiss(); }
      catch (reason) { error.textContent = String(reason?.message ?? reason); }
      finally { setBusy(false); }
    };
    prepare.addEventListener("click", () => void stageDraft({ question: question?.value }));
    actions.append(prepare);
    if (dock) {
      const summarize = document.createElement("button");
      summarize.type = "button";
      summarize.className = "ui-button ui-button--secondary browser-capture-prepare";
      summarize.textContent = t("Prepare summary draft");
      summarize.title = prepare.title;
      summarize.addEventListener("click", () => void stageDraft({ summarize: true }));
      actions.append(summarize);
    }
  }
  const pausedActions = [];
  const setBusy = value => {
    busy = value;
    if (dock) dialog.setAttribute("aria-busy", String(value));
    if (question) question.disabled = value;
    if (value) {
      for (const button of actions.querySelectorAll("button:not(:disabled)")) {
        button.disabled = true;
        pausedActions.push(button);
      }
    } else {
      for (const button of pausedActions.splice(0)) button.disabled = false;
    }
  };
  const compare = comparison && createBrowserCompare({ ...comparison, capture, setBusy, opensChat,
    isOpen, onPrepared: dismiss,
  });
  if (compare) actions.append(compare.button);
  let clip;
  if (createNoteWriter) {
    clip = createBrowserNoteClip({ capture, writer: createNoteWriter(() => dialog.isConnected),
      isOpen: () => dialog.isConnected,
      attachments,
      setBusy,
    });
    actions.append(clip.button);
  }
  if (clip && compare) {
    compare.button.addEventListener("click", () => { if (!compare.panel.hidden) clip.panel.hidden = true; });
    clip.button.addEventListener("click", () => { compare.panel.hidden = true; });
  }
  actions.append(close);
  dialog.append(title, source);
  if (dock) dialog.append(time);
  dialog.append(text);
  if (links) dialog.append(links);
  if (tables) dialog.append(tables);
  if (media.element) dialog.append(media.element);
  if (questionLabel) dialog.append(questionLabel);
  dialog.append(note, error, actions);
  if (clip) dialog.append(clip.panel);
  if (compare) dialog.append(compare.panel);
  if (dock) {
    dock.host.replaceChildren(dialog);
    dock.host.hidden = false;
    dock.trigger.setAttribute("aria-expanded", "true");
  } else {
    document.body.append(dialog);
    dialog.showModal();
  }
  (question ?? close).focus();
  text.setSelectionRange(0, 0); text.scrollTop = 0;
  return dialog;
}
