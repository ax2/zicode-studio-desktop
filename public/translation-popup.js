import { t } from "./i18n.js";

const field = id => document.getElementById(id);
const invoke = request => globalThis.__TAURI__.core.invoke("clipboard_translation", { request });
let locale = "zh-CN";
let snapshot;
let requestNumber = 0;
let lastRevision;
let retryRevision;

function message(value) {
  return t(value, locale);
}

function status(value) {
  field("status").textContent = message(value);
}

function updateRetryState() {
  const busy = retryRevision !== undefined || snapshot?.status === "running";
  field("retry").setAttribute("aria-disabled", String(busy));
}

function setLanguages(choices, selected) {
  field("source-language").replaceChildren(
    new Option(message("Auto-detect"), ""),
    ...choices.map(value => new Option(message(value), value)),
  );
  field("target-language").replaceChildren(...choices.map(value => new Option(message(value), value)));
  field("source-language").value = selected.sourceLang ?? "";
  field("target-language").value = selected.targetLang;
}

async function refresh() {
  const current = ++requestNumber;
  const updated = await invoke({ kind: "snapshot" }).catch(error => {
    if (current === requestNumber) report(error);
    return null;
  });
  if (current !== requestNumber || !updated?.popup) return;
  const { popup, service, languages, locale: language } = updated;
  locale = language;
  document.documentElement.lang = language;
  for (const element of document.querySelectorAll("[data-message]")) {
    element.textContent = message(element.dataset.message);
  }
  snapshot = popup;
  if (retryRevision !== popup.revision) retryRevision = undefined;
  const { draft } = popup;
  const working = popup.status === "running";
  const main = document.querySelector("main");
  const focused = document.activeElement;
  main.setAttribute("aria-busy", String(working));
  field("destination").textContent = service ?
    `${message(service.local ? "Local translation service" : "External translation service")} · ${service.destination}` : "";
  field("original").hidden = !draft.text;
  field("languages").hidden = !draft.text;
  field("source-text").value = draft.text;
  if (lastRevision !== popup.revision) setLanguages(languages, draft);
  lastRevision = popup.revision;
  field("source-language").disabled = working;
  field("target-language").disabled = working;
  field("translation").hidden = !draft.result;
  field("result").value = draft.result?.translated ?? "";
  field("retry").hidden = !draft.text || !service;
  updateRetryState();
  field("copy").hidden = !draft.result;
  field("workbench").disabled = working;
  status(working ? "Translating…" : popup.message || (draft.result ? "Translation complete" : ""));
  if (main.contains(focused) && (focused.matches(":disabled") || focused.closest("[hidden]")) &&
      (document.activeElement === focused || document.activeElement === document.body)) {
    field(draft.text ? "source-text" : "close").focus();
  }
}

function report(error) {
  status(typeof error === "string" ? error : error?.message || "Clipboard translation is unavailable");
}

field("retry").addEventListener("click", () => {
  if (!snapshot || snapshot.status === "running" || retryRevision !== undefined) return;
  const { revision } = snapshot;
  retryRevision = revision;
  updateRetryState();
  void invoke({
    kind: "retry", revision,
    source: field("source-language").value || null, target: field("target-language").value,
  }).catch(error => {
    if (retryRevision !== revision) return;
    retryRevision = undefined;
    updateRetryState();
    report(error);
  });
});
field("workbench").addEventListener("click", () => {
  if (!snapshot) return;
  const { revision } = snapshot;
  void invoke({ kind: "workbench", revision }).catch(error => {
    if (snapshot?.revision === revision) report(error);
  });
});
field("copy").addEventListener("click", async () => {
  if (!snapshot?.draft.result) return;
  const { revision } = snapshot;
  let copyStatus = "Copied";
  try {
    await navigator.clipboard.writeText(field("result").value);
  } catch {
    copyStatus = "Clipboard access is not available";
  }
  if (snapshot?.revision === revision) status(copyStatus);
});
function close() {
  void invoke({ kind: "close" }).catch(report);
}
field("close").addEventListener("click", close);
document.addEventListener("keydown", event => { if (event.key === "Escape" && !event.isComposing) close(); });
await globalThis.__TAURI__.window.getCurrentWindow().listen("studio-clipboard-translation-changed", () => { void refresh().catch(report); });
await refresh().catch(report);
