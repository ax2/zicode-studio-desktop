import { t } from "../../i18n.js";
import { randomId } from "../utils/random-id.js";
import { createBrowserImageReview, sameReviewedImage } from "./browser-image-review.js";

const label = (element, value) => { element.dataset.i18nText = value; element.textContent = t(value); };
function button(value, listener) {
  const element = document.createElement("button"); element.type = "button";
  element.className = "ui-button ui-button--secondary ui-button--sm"; label(element, value);
  element.addEventListener("click", listener); return element;
}
const name = model => `${model.provider} / ${model.name || model.modelId}`;
const selectionKey = selection => selection ? JSON.stringify([selection.provider, selection.modelId]) : "";
export function browserModelError(reason) {
  const code = reason instanceof Error ? reason.message : String(reason ?? "");
  if (code === "module_model_request_cancelled") return t("Model request cancelled.");
  if (code === "module_model_request_timeout") return t("The model request timed out. It was not retried.");
  if (code === "module_model_config_changed") return t("Model configuration changed. Reload the models before sending.");
  if (code === "module_model_selection_unavailable") return t("The selected model is unavailable. Choose another model or configure Pi.");
  if (code === "module_model_image_unsupported") return t("Use a browser model that supports images.");
  if (code === "module_model_image_invalid") return t("Invalid browser image response");
  if (code.startsWith("module_model_")) return t("The model request could not be completed. Check the selected model and credentials.");
  return t("Could not load Pi models. Open Chat or model settings, then retry.");
}

export function createBrowserModelAssistant({ actions, question, prompt, isCurrent, setBusy, artifacts }) {
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
  const cancel = button("Cancel model request", cancelRequest);
  const imageReview = createBrowserImageReview(() => void send("image"), clearImage);
  const answer = document.createElement("textarea"); answer.className = "ui-textarea"; answer.rows = 5; answer.readOnly = true; answer.hidden = true;
  answer.setAttribute("aria-label", t("Browser model answer"));
  const save = button("Save analysis to Artifacts", () => void saveAnalysis());
  const open = button("Open saved artifact", () => {
    try { artifacts.open(savedArtifact); }
    catch { saveStatus.textContent = t("Page or destination changed. Read the page again."); }
  });
  const saveStatus = document.createElement("p"); saveStatus.setAttribute("role", "status");
  let analysis, savedArtifact;
  let snapshot, busy = false, disposed = false, pending, reviewed, generation = 0;
  const current = () => !disposed && isCurrent();
  function controls() {
    select.disabled = busy || !snapshot;
    refresh.disabled = busy;
    ask.disabled = busy || !snapshot?.effectiveBrowserModel || !question?.value.trim();
    summarize.disabled = busy || !snapshot?.effectiveBrowserModel;
    cancel.hidden = !pending;
    imageReview.controls(snapshot?.effectiveBrowserModel, busy);
    save.hidden = !artifacts || !analysis;
    save.disabled = busy || !analysis || Boolean(savedArtifact);
    open.hidden = !savedArtifact;
    open.disabled = busy;
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
      ? t("Page content is sent only when you choose Ask or Summarize. Destination: {model}").replace("{model}", name(value.effectiveBrowserModel))
      : t("The selected model is unavailable. Choose another model or configure Pi.");
    controls();
  }
  async function load() {
    if (busy || !current()) return;
    const mine = ++generation; busy = true; controls(); status.textContent = t("Loading models…");
    try {
      const value = await actions.load();
      if (!current() || mine !== generation) return;
      render(value); status.textContent = "";
    } catch (reason) { if (current() && mine === generation) status.textContent = browserModelError(reason); }
    finally { if (current() && mine === generation) { busy = false; controls(); } }
  }
  select.addEventListener("change", async () => {
    if (busy || !snapshot || !current()) return;
    const before = snapshot;
    const selection = select.value ? (() => { const [provider, modelId] = JSON.parse(select.value); return { provider, modelId }; })() : null;
    busy = true; controls(); status.textContent = "";
    try {
      const value = await actions.save(selection, before.revision);
      if (current()) {
        analysis = undefined; savedArtifact = undefined; saveStatus.textContent = "";
        answer.hidden = true; answer.value = "";
        imageReview.showResult();
        render(value);
      }
    } catch (reason) { if (current()) { render(before); status.textContent = browserModelError(reason); } }
    finally { if (current()) { busy = false; controls(); } }
  });
  function clearImage() {
    reviewed = undefined;
    imageReview.clear();
  }
  function cancelRequest() {
    if (!pending) return;
    pending.cancelled = true;
    if (pending.sent) void actions.cancel(pending.id);
  }
  async function reviewImage(read) {
    if (busy || !current()) return;
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
  async function send(kind) {
    const model = snapshot?.effectiveBrowserModel;
    const visual = kind === "image" ? reviewed : undefined;
    const reviewRequired = kind === "image" && (!visual || !model?.supportsImages);
    if (busy || !model || !current() || reviewRequired || (kind === "analysis" && !question?.value.trim())) return;
    const mine = ++generation;
    const requestedQuestion = kind === "analysis" ? question.value.trim() : "";
    const request = { id: `browser-${randomId()}`, cancelled: false, sent: false };
    const expectedRevision = snapshot.revision;
    analysis = undefined; savedArtifact = undefined; saveStatus.textContent = "";
    imageReview.showResult();
    pending = request; busy = true; setBusy(true); controls();
    answer.hidden = true; answer.value = "";
    status.textContent = t(visual ? "Preparing image preview…" : "Sending reviewed page content to the selected model…");
    try {
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
      request.sent = true;
      const value = await actions.ask({
        requestId: request.id, confirmed: true, expectedRevision, expectedModelFingerprint: model.fingerprint,
        ...(visual
          ? { prompt: t("Describe the visible content of this image."), image: visual.preview.pngBase64 }
          : { prompt: prompt(kind === "summary") }),
      });
      if (request.cancelled) throw Error("module_model_request_cancelled");
      if (!current() || mine !== generation) return;
      if (visual) {
        imageReview.showResult(visual.preview);
        clearImage();
      } else {
        analysis = { text: value.text, model: value.model, kind, question: requestedQuestion, generatedAt: new Date().toISOString() };
      }
      answer.value = value.text; answer.hidden = false;
      const tokens = Number.isSafeInteger(value.usage?.totalTokens)
        ? ` · ${value.usage.totalTokens} ${t("tokens")}` : "";
      status.textContent = name(value.model) + tokens;
    } catch (reason) {
      if (!current() || mine !== generation) return;
      status.textContent = visual && !request.sent && !request.cancelled
        ? t(String(reason?.message ?? reason)) : browserModelError(reason);
    } finally { pending = undefined; busy = false; setBusy(false); if (current()) controls(); }
  }
  async function saveAnalysis() {
    if (busy || !analysis || savedArtifact || !artifacts || !current()) return;
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
  toolbar.append(refresh, ask, summarize, cancel); element.append(field, hint, destination, toolbar, imageReview.element, status, imageReview.resultSource, answer);
  if (artifacts) element.append(save, open, saveStatus);
  controls();
  if (actions.autoLoad()) queueMicrotask(() => void load());
  return { element, reviewImage, cancel: cancelRequest, dispose() {
    if (disposed) return; disposed = true; generation += 1;
    question?.removeEventListener("input", controls);
    clearImage();
    cancelRequest();
  } };
}
