import { t } from "../../i18n.js";
import { randomId } from "../utils/random-id.js";

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
  if (code.startsWith("module_model_")) return t("The model request could not be completed. Check the selected model and credentials.");
  return t("Could not load Pi models. Open Chat or model settings, then retry.");
}

export function createBrowserModelAssistant({ actions, question, prompt, isCurrent, setBusy }) {
  const element = document.createElement("section"); element.className = "ui-card browser-model-assistant";
  element.setAttribute("aria-label", t("Browser model"));
  const field = document.createElement("label"), title = document.createElement("span"); label(title, "Browser model");
  const select = document.createElement("select"); select.className = "ui-select";
  field.append(title, select);
  const hint = document.createElement("p"); label(hint, "Follows Pi by default. Choosing a browser model does not change Chat.");
  const destination = document.createElement("p"), status = document.createElement("p"); status.setAttribute("role", "status");
  const toolbar = document.createElement("div"); toolbar.className = "ui-toolbar";
  const refresh = button("Load Pi models", () => void load());
  const ask = button("Send page and ask", () => void send(false));
  const summarize = button("Send page and summarize", () => void send(true));
  const cancel = button("Cancel model request", () => { if (requestId) void actions.cancel(requestId); });
  const answer = document.createElement("textarea"); answer.className = "ui-textarea"; answer.rows = 5; answer.readOnly = true; answer.hidden = true;
  answer.setAttribute("aria-label", t("Browser model answer"));
  let snapshot, busy = false, disposed = false, requestId, generation = 0;
  const current = () => !disposed && isCurrent();
  function controls() {
    select.disabled = busy || !snapshot;
    refresh.disabled = busy;
    ask.disabled = busy || !snapshot?.effectiveBrowserModel || !question?.value.trim();
    summarize.disabled = busy || !snapshot?.effectiveBrowserModel;
    cancel.hidden = !requestId;
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
    busy = true; controls(); answer.hidden = true; answer.value = ""; status.textContent = "";
    try {
      const value = await actions.save(selection, before.revision);
      if (current()) render(value);
    } catch (reason) { if (current()) { render(before); status.textContent = browserModelError(reason); } }
    finally { if (current()) { busy = false; controls(); } }
  });
  async function send(summary) {
    if (busy || !snapshot?.effectiveBrowserModel || !current() || (!summary && !question?.value.trim())) return;
    const mine = ++generation;
    requestId = `browser-${randomId()}`; busy = true; setBusy(true); controls();
    answer.hidden = true; answer.value = ""; status.textContent = t("Sending reviewed page content to the selected model…");
    try {
      const value = await actions.ask({ requestId, confirmed: true, prompt: prompt(summary), expectedRevision: snapshot.revision,
        expectedModelFingerprint: snapshot.effectiveBrowserModel.fingerprint });
      if (!current() || mine !== generation) return;
      answer.value = value.text; answer.hidden = false;
      status.textContent = `${name(value.model)}${Number.isSafeInteger(value.usage?.totalTokens) ? ` · ${value.usage.totalTokens} ${t("tokens")}` : ""}`;
    } catch (reason) { if (current() && mine === generation) status.textContent = browserModelError(reason); }
    finally { requestId = undefined; busy = false; setBusy(false); if (current()) controls(); }
  }
  question?.addEventListener("input", controls);
  toolbar.append(refresh, ask, summarize, cancel); element.append(field, hint, destination, toolbar, status, answer);
  controls();
  if (actions.autoLoad()) queueMicrotask(() => void load());
  return { element, cancel() { if (requestId) void actions.cancel(requestId); }, dispose() {
    if (disposed) return; disposed = true; generation += 1;
    question?.removeEventListener("input", controls);
    if (requestId) void actions.cancel(requestId);
  } };
}
