import { t } from "./i18n.js";

const field = id => document.getElementById(id);
const invoke = request => globalThis.__TAURI__.core.invoke("clipboard_translation", { request });
let locale = "zh-CN";
let snapshot;
let requestNumber = 0;
let lastRevision;

function message(value) {
  return t(value, locale);
}

function status(value) {
  field("status").textContent = message(value);
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
  const { popup, service, languages, locale: language } = await invoke({ kind: "snapshot" });
  if (current !== requestNumber || !popup) return;
  locale = language;
  document.documentElement.lang = language;
  for (const element of document.querySelectorAll("[data-message]")) {
    element.textContent = message(element.dataset.message);
  }
  snapshot = popup;
  const { draft } = popup;
  const working = popup.status === "running";
  document.querySelector("main").setAttribute("aria-busy", String(working));
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
  field("retry").disabled = working;
  field("copy").hidden = !draft.result;
  field("workbench").disabled = working;
  status(working ? "Translating…" : popup.message || (draft.result ? "Translation complete" : ""));
}

function report(error) {
  status(typeof error === "string" ? error : error?.message || "Clipboard translation is unavailable");
}

field("retry").addEventListener("click", () => {
  if (!snapshot) return;
  void invoke({
    kind: "retry", revision: snapshot.revision,
    source: field("source-language").value || null, target: field("target-language").value,
  }).catch(report);
});
field("workbench").addEventListener("click", () => {
  if (!snapshot) return;
  void invoke({ kind: "workbench", revision: snapshot.revision }).catch(report);
});
field("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(field("result").value);
    status("Copied");
  } catch {
    status("Clipboard access is not available");
  }
});
function close() {
  void invoke({ kind: "close" }).catch(report);
}
field("close").addEventListener("click", close);
document.addEventListener("keydown", event => { if (event.key === "Escape" && !event.isComposing) close(); });
await globalThis.__TAURI__.window.getCurrentWindow().listen("studio-clipboard-translation-changed", () => { void refresh().catch(report); });
await refresh().catch(report);
