import { t } from "../../i18n.js";

const maxPeers = 2;

export function comparisonSource(capture) {
  const { title, url, text, selection, truncated } = capture.page;
  return {
    title, url, text: text.slice(0, 12000), selection: selection.slice(0, 4000),
    truncated: truncated || text.length > 12000 || selection.length > 4000,
    tab: capture.tab, documentRevision: capture.documentRevision, capturedAt: capture.capturedAt,
  };
}

export function createBrowserCompare({ capture, peers, readSource, prepare, setBusy, isOpen, onPrepared, opensChat }) {
  const panel = document.createElement("fieldset"); panel.className = "browser-compare"; panel.hidden = true;
  const legend = document.createElement("legend"); legend.textContent = t("Compare open tabs"); panel.append(legend);
  const button = document.createElement("button"); button.type = "button"; button.className = "ui-button ui-button--secondary";
  button.textContent = t("Compare open tabs");
  button.addEventListener("click", () => { panel.hidden = !panel.hidden; if (!panel.hidden) panel.querySelector("input")?.focus(); });
  const hint = document.createElement("p");
  hint.textContent = t(peers.length ? "Choose one or two loaded tabs. Review the sources before preparing a draft." : "Open another web page before comparing tabs.");
  panel.append(hint);
  if (!peers.length) return { button, panel };

  const choices = document.createElement("div"); choices.className = "browser-compare-choices";
  choices.setAttribute("role", "group"); choices.setAttribute("aria-label", t("Other loaded tabs"));
  const inputs = peers.map(source => {
    const label = document.createElement("label");
    const input = document.createElement("input"); input.type = "checkbox";
    const detail = document.createElement("span"); detail.textContent = source.title ? `${source.title} — ${source.url}` : source.url;
    label.append(input, detail); choices.append(label);
    return { input, source };
  });
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const preview = document.createElement("div"); preview.className = "browser-compare-preview";
  const toolbar = document.createElement("div"); toolbar.className = "ui-toolbar";
  const read = document.createElement("button"); read.type = "button"; read.className = "ui-button ui-button--secondary";
  read.textContent = t("Read selected tabs");
  const draft = document.createElement("button"); draft.type = "button"; draft.className = "ui-button ui-button--primary";
  draft.textContent = t(opensChat ? "Open Chat and prepare comparison draft" : "Prepare comparison draft");
  toolbar.append(read, draft); panel.append(choices, toolbar, status, preview);
  let reviewed = null;
  const selected = () => inputs.filter(({ input }) => input.checked);
  function update() {
    const count = selected().length;
    read.disabled = count < 1;
    draft.disabled = !reviewed;
    for (const { input } of inputs) input.disabled = !input.checked && count >= maxPeers;
  }
  function clearReview() { reviewed = null; preview.replaceChildren(); status.textContent = ""; update(); }
  function showReview(sources) {
    for (const [index, source] of sources.entries()) {
      const details = document.createElement("details");
      const summary = document.createElement("summary"); summary.textContent = `[${index + 1}] ${source.title || source.url}`;
      const url = document.createElement("p"); url.textContent = source.url;
      const time = document.createElement("p"); time.textContent = `${t("Captured at")}: ${source.capturedAt}`;
      const excerpt = document.createElement("textarea"); excerpt.className = "ui-textarea"; excerpt.readOnly = true;
      excerpt.setAttribute("aria-label", t("Comparison source text"));
      excerpt.value = [source.selection && `${t("Selected text")}\n${source.selection}`, source.text].filter(Boolean).join("\n\n");
      details.append(summary, url, time, excerpt);
      if (source.truncated) {
        const limit = document.createElement("p"); limit.textContent = t("Page content was shortened"); details.append(limit);
      }
      preview.append(details);
    }
  }
  async function work(operation) {
    panel.disabled = true;
    setBusy(true);
    try { await operation(); }
    catch (error) { if (isOpen()) status.textContent = t(String(error?.message ?? error)); }
    finally {
      setBusy(false);
      panel.disabled = false;
      update();
    }
  }
  for (const { input } of inputs) input.addEventListener("change", clearReview);
  read.addEventListener("click", () => {
    const targets = selected().map(({ source }) => source);
    clearReview();
    status.textContent = t("Reading selected tabs…");
    void work(async () => {
      const sources = [comparisonSource(capture)];
      for (const source of targets) sources.push(comparisonSource(await readSource(source)));
      if (!isOpen()) return;
      showReview(sources);
      reviewed = sources;
      status.textContent = t("Review the sources, then prepare an unsent draft.");
    });
  });
  draft.addEventListener("click", () => {
    const sources = reviewed;
    if (!sources) return;
    status.textContent = "";
    void work(async () => { await prepare(sources); onPrepared(); });
  });
  update();
  return { button, panel };
}
