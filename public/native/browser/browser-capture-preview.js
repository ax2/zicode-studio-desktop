import { createBrowserCompare } from "./browser-compare.js";
import { createBrowserCaptureMedia } from "./browser-capture-media.js";
import { createBrowserCaptureFrames } from "./browser-capture-frames.js";
import { createBrowserCaptureLinks } from "./browser-capture-links.js";
import { createBrowserCaptureTables } from "./browser-capture-tables.js";
import { createBrowserNoteClip } from "./browser-note-clip.js";
import { t } from "../../i18n.js";
import { createBrowserModelAssistant } from "./browser-model-assistant.js";
import { browserDraftPrompt } from "./browser-chat-draft.js";
import { browserTranslationSource } from "./browser-translation.js";

function setLabel(element, key) {
  element.dataset.i18nText = key;
  element.textContent = t(key);
}

export function showBrowserCapture(capture, onClose, prepareDraft, createNoteWriter, comparison, opensChat = false, dock) {
  let busy = false, busyCount = 0;
  let modelAssistant, compare, cancelDraft, draftCancelButton;
  const dialog = document.createElement(dock ? "section" : "dialog");
  dialog.className = dock ? "browser-capture-panel" : "browser-capture-dialog ui-panel";
  if (!dock) dialog.setAttribute("aria-label", t("Page content"));
  const isOpen = () => dialog.isConnected && (Boolean(dock) || dialog.open);
  const dismiss = (restoreFocus = false) => {
    modelAssistant?.dispose();
    if (!dock) { dialog.close(); return; }
    if (dialog.parentNode !== dock.host) return;
    dialog.remove();
    dock.host.hidden = true;
    dock.trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) dock.trigger.focus({ preventScroll: true });
    onClose();
  };
  const title = document.createElement("h2");
  if (capture.page.title) {
    title.setAttribute("translate", "no");
    title.textContent = capture.page.title;
  } else setLabel(title, "Page content");
  const source = document.createElement("p"); source.textContent = capture.page.url;
  source.setAttribute("translate", "no");
  const time = document.createElement("p");
  const timeLabel = document.createElement("span");
  setLabel(timeLabel, "Captured at");
  time.append(timeLabel, ` · ${capture.capturedAt}`);
  const text = document.createElement("textarea"); text.className = "ui-textarea browser-capture-text"; text.readOnly = true;
  text.setAttribute("aria-label", t("Page content"));
  text.setAttribute("data-i18n-aria-label", "Page content");
  const pagePreview = `${capture.page.selection ? `${t("Selected text")}\n${capture.page.selection}\n\n` : ""}${capture.page.text}`;
  text.value = pagePreview;
  const recognizeImage = dock?.recognizeImage && (async (image, frame) => {
    if (busy || !isOpen()) return;
    setBusy(true);
    try {
      const result = await dock.recognizeImage(image, frame);
      return isOpen() ? result : undefined;
    } finally { setBusy(false); }
  });
  const reviewImage = dock?.previewImage && dock.modelActions && ((image, frame) => {
    if (busy || !isOpen()) return;
    return modelAssistant?.reviewImage(() => dock.previewImage(image, frame));
  });
  const media = createBrowserCaptureMedia(capture.page, recognizeImage, reviewImage);
  const frames = createBrowserCaptureFrames(capture.page, recognizeImage, reviewImage);
  const tables = createBrowserCaptureTables(capture.page);
  const links = createBrowserCaptureLinks(capture.page, Boolean(prepareDraft || createNoteWriter || dock?.modelActions));
  const attachments = () => {
    const imageText = [...media.imageText(), ...frames.imageText()];
    return {
      includeMedia: media.include.checked,
      ...links.attachments(), ...tables.attachments(), ...frames.attachments(),
      ...(imageText.length ? { imageText } : {}),
    };
  };
  let selectionScope, selectionLabel;
  if (capture.page.selection?.trim() && (prepareDraft || dock?.modelActions)) {
    selectionScope = document.createElement("input"); selectionScope.type = "checkbox";
    selectionLabel = document.createElement("label");
    selectionLabel.className = "ui-toolbar browser-capture-prepare";
    const scopeText = document.createElement("span");
    setLabel(scopeText, "Use only selected text for AI and Chat drafts");
    selectionLabel.append(selectionScope, scopeText);
    selectionScope.addEventListener("change", () => {
      const name = selectionScope.checked ? "Selected text" : "Page content";
      text.setAttribute("aria-label", t(name));
      text.setAttribute("data-i18n-aria-label", name);
      text.value = selectionScope.checked ? capture.page.selection : pagePreview;
      text.setSelectionRange(0, 0);
      text.scrollTop = 0;
    });
  }
  const aiAttachments = () => selectionScope?.checked ? { selectionOnly: true } : attachments();
  const note = document.createElement("p");
  const notices = [];
  if (capture.page.textTruncated ?? capture.page.truncated) notices.push("Page content was shortened");
  if (capture.page.selectionTruncated) notices.push("Selected text was shortened");
  const hasShortenedText = notices.length > 0;
  if (!hasShortenedText) notices.push(dock?.modelActions
    ? "Page content was collected locally."
    : "Content read locally. Nothing has been sent to AI.");
  if (dock?.modelActions && (links.element || tables.element || media.element || frames.element)) {
    notices.push("Page questions and summaries include the selected attachments.");
  }
  for (const key of notices) {
    const label = document.createElement("span");
    setLabel(label, key);
    if (selectionScope && (key === "Page content was shortened" ||
        key === "Page questions and summaries include the selected attachments.")) {
      selectionScope.addEventListener("change", () => { label.hidden = selectionScope.checked; });
    }
    if (note.childNodes.length) note.append(" ");
    note.append(label);
  }
  const close = document.createElement("button"); close.type = "button"; close.className = "ui-button ui-button--primary";
  setLabel(close, "Close");
  close.addEventListener("click", () => { if (!busy) dismiss(true); });
  const cancelPending = () => cancelDraft?.() || modelAssistant?.cancel();
  dialog.addEventListener("cancel", event => { if (cancelPending() || busy) event.preventDefault(); });
  dialog.addEventListener("close", () => { modelAssistant?.dispose(); dialog.remove(); onClose(); }, { once: true });
  dialog.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    if (cancelPending()) {
      event.preventDefault();
      event.stopPropagation();
    } else if (dock && !busy) {
      event.preventDefault();
      dismiss(true);
    }
  });
  const actions = document.createElement("div"); actions.className = "ui-toolbar";
  const error = document.createElement("p"); error.setAttribute("role", "alert");
  const draftStatus = document.createElement("span"); draftStatus.setAttribute("role", "status");
  let questionLabel, question;
  if (dock && prepareDraft) {
    questionLabel = document.createElement("label"); questionLabel.className = "browser-capture-question";
    question = document.createElement("textarea"); question.className = "ui-textarea"; question.rows = 2; question.maxLength = 5000;
    if (dock.questionDraft) {
      question.value = dock.questionDraft.value;
      question.addEventListener("input", () => dock.questionDraft.remember(question.value));
    }
    const label = document.createElement("span");
    setLabel(label, "Question about this page");
    questionLabel.append(label, question);
  }
  if (prepareDraft) {
    const prepare = document.createElement("button"); prepare.type = "button"; prepare.className = "ui-button ui-button--secondary browser-capture-prepare";
    setLabel(prepare, opensChat ? "Open Chat and prepare draft" : "Prepare chat draft");
    const help = "Adds this snapshot to the current conversation. Nothing is sent until you press Send.";
    prepare.title = t(help);
    prepare.setAttribute("data-i18n-title", help);
    draftCancelButton = document.createElement("button");
    draftCancelButton.type = "button";
    draftCancelButton.className = "ui-button ui-button--secondary hidden";
    draftCancelButton.hidden = true;
    setLabel(draftCancelButton, "Cancel draft preparation");
    let pending;
    const finish = job => {
      if (pending !== job) return;
      const restoreFocus = isOpen() && document.activeElement === draftCancelButton;
      pending = undefined;
      for (const input of job.choices) input.disabled = false;
      draftCancelButton.hidden = true;
      draftCancelButton.classList.add("hidden");
      setBusy(false);
      if (restoreFocus) job.trigger.focus({ preventScroll: true });
    };
    cancelDraft = () => {
      if (!pending) return false;
      setLabel(draftStatus, "Draft preparation cancelled. Your question and selections are kept.");
      finish(pending);
      return true;
    };
    draftCancelButton.addEventListener("click", cancelDraft);
    const stageDraft = async (trigger, intent) => {
      if (busy || !isOpen()) return;
      const material = { ...aiAttachments(), ...intent };
      const choices = dialog.querySelectorAll('input[type="checkbox"]:not(:disabled)');
      const job = { trigger, choices };
      const isPreparing = () => pending === job;
      pending = job;
      for (const input of choices) input.disabled = true;
      setLabel(draftStatus, "Preparing page draft…");
      error.textContent = "";
      setBusy(true);
      draftCancelButton.hidden = false;
      draftCancelButton.classList.remove("hidden");
      draftCancelButton.focus();
      try {
        await prepareDraft(material, isPreparing);
        if (isPreparing()) {
          if (intent.question?.trim()) dock?.questionDraft?.clear();
          dismiss();
        }
      } catch (reason) {
        if (!isPreparing()) return;
        draftStatus.textContent = "";
        delete draftStatus.dataset.i18nText;
        error.textContent = String(reason?.message ?? reason);
      } finally { finish(job); }
    };
    prepare.addEventListener("click", () => void stageDraft(prepare, { question: question?.value }));
    actions.append(prepare);
    if (dock) {
      const summarize = document.createElement("button");
      summarize.type = "button";
      summarize.className = "ui-button ui-button--secondary browser-capture-prepare";
      setLabel(summarize, "Prepare summary draft");
      summarize.title = prepare.title;
      summarize.setAttribute("data-i18n-title", help);
      summarize.addEventListener("click", () => void stageDraft(summarize, { summarize: true }));
      actions.append(summarize);
    }
    actions.append(draftCancelButton);
  }
  const pausedActions = [];
  const setBusy = value => {
    busyCount = Math.max(0, busyCount + (value ? 1 : -1));
    const next = busyCount > 0;
    if (next === busy) return;
    busy = next;
    if (dock) dialog.setAttribute("aria-busy", String(busy));
    if (question) question.disabled = busy;
    if (selectionScope) selectionScope.disabled = busy;
    for (const button of dialog.querySelectorAll(".browser-image-ocr button")) button.disabled = busy;
    if (busy) {
      for (const button of actions.querySelectorAll("button:not(:disabled)")) {
        if (button === draftCancelButton) continue;
        button.disabled = true;
        pausedActions.push(button);
      }
    } else {
      for (const button of pausedActions.splice(0)) button.disabled = false;
    }
    modelAssistant?.controls();
    compare?.update?.();
  };
  if (dock?.modelActions) {
    modelAssistant = createBrowserModelAssistant({ actions: dock.modelActions, question, selectionScope,
      prompt: summarize => browserDraftPrompt(capture, { ...aiAttachments(), question: question?.value, summarize }),
      isCurrent: isOpen, setBusy, artifacts: dock.analysisArtifacts,
      canStart: () => !busy, verifyPage: dock.verifyPage, verifyComparison: comparison?.verify,
      translationSource: dock.verifyPage && browserTranslationSource(capture),
      notes: createNoteWriter && { capture, writer: createNoteWriter } });
  }
  compare = comparison && createBrowserCompare({ ...comparison, capture, setBusy, opensChat,
    isOpen, onPrepared: dismiss, direct: modelAssistant?.compare, canStart: () => !busy,
  });
  if (compare) actions.append(compare.button);
  let clip;
  if (createNoteWriter) {
    const canSaveImageText = recognizeImage && (
      capture.page.images?.some(image => image.url) ||
      capture.page.frames?.some(frame => frame.imageLocator && frame.images?.some(image => image.url))
    );
    clip = createBrowserNoteClip({ capture, writer: createNoteWriter(isOpen),
      isOpen,
      canSaveImageText,
      onOpened: dock ? undefined : () => dismiss(),
      attachments,
      setBusy,
    });
    actions.append(clip.button);
    dialog.addEventListener("change", clip.updateScope);
  }
  if (clip && compare) {
    compare.button.addEventListener("click", () => { if (!compare.panel.hidden) clip.panel.hidden = true; });
    clip.button.addEventListener("click", () => { compare.panel.hidden = true; });
  }
  actions.append(close);
  dialog.append(title, source);
  if (dock) dialog.append(time);
  if (hasShortenedText) dialog.append(note);
  dialog.append(text);
  if (selectionLabel) dialog.append(selectionLabel);
  if (links.element) dialog.append(links.element);
  if (tables.element) dialog.append(tables.element);
  if (media.element) dialog.append(media.element);
  if (frames.element) dialog.append(frames.element);
  if (questionLabel) dialog.append(questionLabel);
  if (modelAssistant) {
    if (!hasShortenedText) dialog.append(note);
    dialog.append(modelAssistant.element);
    dialog.disposeBrowserModel = () => modelAssistant.dispose();
    dialog.cancelBrowserModel = () => modelAssistant.cancel();
  }
  if (!hasShortenedText && !modelAssistant) dialog.append(note);
  dialog.append(error);
  if (prepareDraft) dialog.append(draftStatus);
  dialog.append(actions);
  if (clip) dialog.append(clip.panel, clip.open);
  if (compare) dialog.append(compare.panel);
  if (dock) {
    dialog.invalidateBrowserCapture = restoreFocus => {
      const ownedFocus = restoreFocus && dialog.contains(document.activeElement);
      cancelDraft?.();
      dismiss(ownedFocus);
    };
    for (const previous of dock.host.children) previous.disposeBrowserModel?.();
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
