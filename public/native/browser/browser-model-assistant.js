import { t } from "../../i18n.js";
import { randomId } from "../utils/random-id.js";
import { createBrowserImageReview, sameReviewedImage } from "./browser-image-review.js";
import { createBrowserNoteClip } from "./browser-note-clip.js";
import { browserComparisonPrompt } from "./browser-chat-draft.js";

const label = (element, value) => { element.dataset.i18nText = value; element.textContent = t(value); };
function button(value, listener) {
  const element = document.createElement("button"); element.type = "button";
  element.className = "ui-button ui-button--secondary ui-button--sm"; label(element, value);
  element.addEventListener("click", listener); return element;
}
const name = model => `${model.provider} / ${model.name || model.modelId}`;
const selectionKey = selection => selection ? JSON.stringify([selection.provider, selection.modelId]) : "";
const modelErrorCode = reason => reason?.code === "browser_model_context_changed" ? reason.code :
  reason instanceof Error ? reason.message : String(reason ?? "");
const maxBrowserModelPromptBytes = 256 * 1024; // Pi's browser_model_request limit.
const staleModelErrors = new Set(["browser_model_context_changed", "module_model_config_changed", "module_model_selection_unavailable"]);

export function browserModelError(reason) {
  const code = modelErrorCode(reason);
  if (code === "browser_model_context_changed") return t("Page or conversation changed. Read the page again.");
  if (code === "module_model_request_cancelled") return t("Model request cancelled.");
  if (code === "module_model_request_timeout") return t("The model request timed out. It was not retried.");
  if (code === "module_model_config_changed") return t("Model configuration changed. Reload the models before sending.");
  if (code === "module_model_selection_unavailable") return t("The selected model is unavailable. Choose another model or configure Pi.");
  if (code === "module_model_image_unsupported") return t("Use a browser model that supports images.");
  if (code === "module_model_image_invalid") return t("Invalid browser image response");
  if (code.startsWith("module_model_")) return t("The model request could not be completed. Check the selected model and credentials.");
  return t("Could not load Pi models. Open Chat or model settings, then retry.");
}

export function createBrowserModelAssistant({ actions, question, prompt, isCurrent, setBusy, artifacts, notes, canStart = () => true, verifyPage, verifyComparison }) {
  const element = document.createElement("section"); element.className = "ui-card browser-model-assistant";
  element.setAttribute("aria-label", t("Browser model"));
  const field = document.createElement("label"), title = document.createElement("span"); label(title, "Browser model");
  const select = document.createElement("select"); select.className = "ui-select";
  field.append(title, select);
  const hint = document.createElement("p"); label(hint, "Follows Pi by default. Choosing a browser model does not change Chat.");
  const destination = document.createElement("p"), status = document.createElement("p"); status.setAttribute("role", "status");
  const toolbar = document.createElement("div"); toolbar.className = "ui-toolbar";
  const refresh = button("Load Pi models", () => void load());
  const ask = button("Send page and ask", () => void send("analysis"));
  const summarize = button("Send page and summarize", () => void send("summary"));
  ask.classList.add("browser-capture-prepare");
  summarize.classList.add("browser-capture-prepare");
  const cancel = button("Cancel model request", cancelRequest);
  const compareNotice = document.createElement("p");
  compareNotice.setAttribute("role", "status");
  label(compareNotice, "The reviewed tabs exceed the model input limit. Compare fewer tabs or prepare a draft.");
  compareNotice.hidden = true;
  const compareButton = verifyComparison && button("Send reviewed tabs and compare", () => void send("comparison", comparison));
  let comparison;
  const compare = compareButton && {
    button: compareButton,
    notice: compareNotice,
    setSources(sources) {
      if (comparison?.sources === sources || (!comparison && !sources)) return;
      const prompt = sources && browserComparisonPrompt(sources);
      const exceedsLimit = Boolean(prompt && new TextEncoder().encode(prompt).byteLength > maxBrowserModelPromptBytes);
      comparison = sources ? { sources, prompt, exceedsLimit } : undefined;
      compareNotice.hidden = !exceedsLimit;
      controls();
    },
  };
  const imageReview = createBrowserImageReview(() => void send("image"), clearImage);
  const answer = document.createElement("textarea"); answer.className = "ui-textarea"; answer.rows = 5; answer.readOnly = true; answer.hidden = true;
  answer.setAttribute("aria-label", t("Browser model answer"));
  const answerModel = document.createElement("p"); answerModel.hidden = true; answerModel.setAttribute("role", "status");
  const answerSources = document.createElement("ol");
  answerSources.hidden = true;
  answerSources.setAttribute("aria-label", t("Comparison sources"));
  answerSources.setAttribute("data-i18n-aria-label", "Comparison sources");
  const save = button("Save analysis to Artifacts", () => void saveAnalysis());
  const open = button("Open saved artifact", () => {
    try { artifacts.open(savedArtifact); }
    catch { saveStatus.textContent = t("Page or destination changed. Read the page again."); }
  });
  const saveStatus = document.createElement("p"); saveStatus.setAttribute("role", "status");
  const noteSlot = document.createElement("div"); noteSlot.hidden = true;
  let analysis, savedArtifact;
  let snapshot, busy = false, disposed = false, pending, reviewed, generation = 0;
  const current = () => !disposed && isCurrent();
  function controls() {
    const blocked = busy || !canStart();
    select.disabled = blocked || !snapshot;
    refresh.disabled = blocked;
    ask.disabled = blocked || !snapshot?.effectiveBrowserModel || !question?.value.trim();
    summarize.disabled = blocked || !snapshot?.effectiveBrowserModel;
    if (compareButton) {
      compareButton.disabled = blocked || !snapshot?.effectiveBrowserModel || !comparison || comparison.exceedsLimit;
    }
    cancel.hidden = !pending;
    cancel.setAttribute("aria-disabled", String(pending?.cancelled === true));
    imageReview.controls(snapshot?.effectiveBrowserModel, blocked);
    save.hidden = !artifacts || !analysis;
    save.disabled = blocked || !analysis || Boolean(savedArtifact);
    open.hidden = !savedArtifact;
    open.disabled = blocked;
    save.classList.toggle("hidden", save.hidden);
    open.classList.toggle("hidden", open.hidden);
    noteSlot.inert = blocked;
  }
  function showComparisonSources(sources) {
    answerSources.hidden = !sources;
    answerSources.replaceChildren(...(sources ?? []).map(({ title, url }) => {
      const item = document.createElement("li");
      const text = document.createElement("p");
      text.textContent = title && title !== url ? `${title} · ${url}` : url;
      item.append(text);
      return item;
    }));
  }
  function showNoteAction(result) {
    noteSlot.replaceChildren();
    noteSlot.hidden = !notes || !result?.text?.trim() || result.kind === "image";
    if (noteSlot.hidden) return;
    const isOpen = () => current() && analysis === result;
    const clip = createBrowserNoteClip({
      capture: notes.capture,
      analysis: result,
      writer: notes.writer(isOpen, result),
      isOpen,
      canStart: () => !busy && canStart(),
      setBusy(value) { busy = value; setBusy(value); controls(); },
    });
    noteSlot.append(clip.button, clip.panel, clip.open);
  }
  function render(value) {
    snapshot = value;
    const inherit = document.createElement("option"); inherit.value = "";
    inherit.textContent = value.currentPiModel ? `${t("Follow Pi")} — ${name(value.currentPiModel)}` : t("Follow Pi");
    select.replaceChildren(inherit);
    for (const model of value.models ?? []) {
      const option = document.createElement("option"); option.value = selectionKey(model); option.textContent = name(model); select.append(option);
    }
    const selected = selectionKey(value.browser);
    if (selected && ![...select.options].some(option => option.value === selected)) {
      const unavailable = document.createElement("option"); unavailable.value = selected; unavailable.textContent = `${t("Unavailable model")} — ${value.browser.provider} / ${value.browser.modelId}`; select.append(unavailable);
    }
    select.value = selected;
    destination.textContent = value.effectiveBrowserModel
      ? t("Page content is sent only when you choose to send it. Destination: {model}").replace("{model}", name(value.effectiveBrowserModel))
      : t("The selected model is unavailable. Choose another model or configure Pi.");
    if (compareButton) compareButton.title = destination.textContent;
    controls();
  }
  function invalidateModelConfiguration() {
    snapshot = undefined;
    destination.textContent = "";
    if (compareButton) compareButton.title = "";
  }
  async function load() {
    if (busy || !canStart() || !current()) return;
    const mine = ++generation; busy = true; controls(); status.textContent = t("Loading models…");
    try {
      const value = await actions.load();
      if (!current() || mine !== generation) return;
      render(value); status.textContent = "";
    } catch (reason) {
      if (current() && mine === generation) {
        invalidateModelConfiguration();
        status.textContent = browserModelError(reason);
      }
    }
    finally { if (current() && mine === generation) { busy = false; controls(); } }
  }
  select.addEventListener("change", async () => {
    if (busy || !canStart() || !snapshot || !current()) return;
    const before = snapshot;
    const selection = select.value ? (() => { const [provider, modelId] = JSON.parse(select.value); return { provider, modelId }; })() : null;
    busy = true; controls(); status.textContent = "";
    try {
      const value = await actions.save(selection, before.revision);
      if (current()) {
        analysis = undefined; savedArtifact = undefined; saveStatus.textContent = "";
        answer.hidden = true; answer.value = "";
        answerModel.hidden = true; answerModel.textContent = "";
        imageReview.showResult();
        showComparisonSources();
        showNoteAction();
        render(value);
      }
    } catch (reason) {
      if (current()) {
        select.value = selectionKey(before.browser);
        invalidateModelConfiguration();
        status.textContent = browserModelError(reason);
      }
    }
    finally { if (current()) { busy = false; controls(); } }
  });
  function clearImage() {
    reviewed = undefined;
    imageReview.clear();
  }
  function cancelRequest() {
    if (!pending) return false;
    if (pending.cancelled) return true;
    pending.cancelled = true;
    if (current()) {
      status.textContent = t("Cancelling model request…");
      controls();
    }
    if (pending.sent) void actions.cancel(pending.id);
    return true;
  }
  async function reviewImage(read) {
    if (busy || !canStart() || !current()) return;
    clearImage();
    busy = true; setBusy(true); controls();
    status.textContent = t("Preparing image preview…");
    try {
      const preview = await read();
      if (!current() || !preview) return;
      reviewed = { preview, read };
      imageReview.show(preview);
      status.textContent = "";
    } catch (reason) {
      if (current()) status.textContent = t(String(reason?.message ?? reason));
    } finally { busy = false; setBusy(false); if (current()) controls(); }
  }
  async function send(kind, reviewedComparison) {
    const model = snapshot?.effectiveBrowserModel;
    const visual = kind === "image" ? reviewed : undefined;
    const reviewRequired = kind === "image" && (!visual || !model?.supportsImages) ||
      kind === "comparison" && (!reviewedComparison || reviewedComparison.exceedsLimit);
    if (busy || !canStart() || !model || !current() || reviewRequired || (kind === "analysis" && !question?.value.trim())) return;
    const mine = ++generation;
    const requestedQuestion = kind === "analysis" ? question.value.trim() : "";
    const request = { id: `browser-${randomId()}`, cancelled: false, sent: false };
    const expectedRevision = snapshot.revision;
    const trigger = reviewedComparison ? compareButton : element.contains(document.activeElement) ? document.activeElement : null;
    const verifyText = reviewedComparison
      ? isSending => verifyComparison(reviewedComparison.sources, isSending)
      : !visual && verifyPage;
    let completed = false;
    pending = request; busy = true; setBusy(true); controls();
    if (trigger) cancel.focus({ preventScroll: !reviewedComparison });
    status.textContent = t(visual ? "Preparing image preview…" : reviewedComparison ? "Checking reviewed tabs…" :
      verifyText ? "Checking the reviewed page…" : "Sending reviewed page content to the selected model…");
    try {
      // Build the exact reviewed message before any asynchronous check.
      const textPrompt = visual ? undefined : reviewedComparison?.prompt ?? prompt(kind === "summary");
      if (visual) {
        const latest = await visual.read();
        if (request.cancelled) throw Error("module_model_request_cancelled");
        if (!current() || mine !== generation) return;
        if (!sameReviewedImage(visual.preview, latest)) {
          clearImage();
          status.textContent = t("The image changed. Preview it again.");
          return;
        }
        status.textContent = t("Sending this image to the selected model…");
      }
      if (verifyText) {
        await verifyText(() => current() && mine === generation && !request.cancelled);
        if (request.cancelled) throw Error("module_model_request_cancelled");
        if (!current() || mine !== generation) return;
        status.textContent = t("Sending reviewed page content to the selected model…");
      }
      request.sent = true;
      const value = await actions.ask({
        requestId: request.id, confirmed: true, expectedRevision, expectedModelFingerprint: model.fingerprint,
        ...(visual
          ? { prompt: t("Describe the visible content of this image."), image: visual.preview.pngBase64 }
          : { prompt: textPrompt }),
      });
      if (request.cancelled) throw Error("module_model_request_cancelled");
      if (!current() || mine !== generation) return;
      savedArtifact = undefined; saveStatus.textContent = "";
      analysis = { text: value.text, model: value.model, kind, question: requestedQuestion, generatedAt: new Date().toISOString() };
      imageReview.showResult(visual?.preview);
      if (visual) {
        const { source, pageUrl, capturedAt, documentRevision, frame } = visual.preview;
        analysis.image = { source, pageUrl, capturedAt, documentRevision, frame };
        clearImage();
      }
      if (reviewedComparison) {
        analysis.sources = reviewedComparison.sources.map(({ title, url, capturedAt, documentRevision }) => ({ title, url, capturedAt, documentRevision }));
      }
      showComparisonSources(analysis.sources);
      showNoteAction(analysis);
      answer.value = value.text; answer.hidden = false; completed = true;
      const tokens = Number.isSafeInteger(value.usage?.totalTokens)
        ? ` · ${value.usage.totalTokens} ${t("tokens")}` : "";
      answerModel.hidden = false; answerModel.textContent = name(value.model) + tokens;
      status.textContent = "";
    } catch (reason) {
      if (!current() || mine !== generation) return;
      if (request.cancelled) status.textContent = t("Model request cancelled.");
      else {
        if (staleModelErrors.has(modelErrorCode(reason))) invalidateModelConfiguration();
        status.textContent = (visual || verifyText) && !request.sent
          ? t(String(reason?.message ?? reason)) : browserModelError(reason);
      }
    } finally {
      const restoreFocus = current() && document.activeElement === cancel;
      pending = undefined; busy = false; setBusy(false);
      if (current()) controls();
      if (restoreFocus) {
        if (reviewedComparison && completed) answer.focus();
        else (trigger?.disabled ? refresh : trigger)?.focus({ preventScroll: !reviewedComparison });
      }
    }
  }
  async function saveAnalysis() {
    if (busy || !canStart() || !analysis || savedArtifact || !artifacts || !current()) return;
    const mine = generation;
    busy = true; setBusy(true); controls(); saveStatus.textContent = t("Saving…");
    try {
      const result = await artifacts.save(analysis);
      if (current() && mine === generation) { savedArtifact = result; saveStatus.textContent = t("Analysis saved to Artifacts"); }
    } catch {
      if (current() && mine === generation) saveStatus.textContent = t("Could not save analysis. Try again.");
    } finally { busy = false; setBusy(false); if (current()) controls(); }
  }
  question?.addEventListener("input", controls);
  toolbar.append(refresh, ask, summarize, cancel); element.append(field, hint, destination, toolbar, imageReview.element, status, answerModel, imageReview.resultSource, answerSources, answer);
  if (artifacts) element.append(save, open, saveStatus);
  if (notes) element.append(noteSlot);
  controls();
  if (actions.autoLoad()) queueMicrotask(() => void load());
  return { element, compare, controls, reviewImage, cancel: cancelRequest, dispose() {
    if (disposed) return; disposed = true; generation += 1;
    question?.removeEventListener("input", controls);
    clearImage();
    cancelRequest();
  } };
}
