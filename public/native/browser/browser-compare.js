import { t } from "../../i18n.js";
import { appendPartialCapture } from "./browser-capture-status.js";

const maxPeers = 2;
const textLimit = 12000;
const selectionLimit = 4000;

function clipExcerpt(value, limit) {
  if (value.length <= limit) return value;
  // The budgets count UTF-16 units. Leave room for the entire character or omit it.
  const last = value.charCodeAt(limit - 1);
  return value.slice(0, last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit);
}

export function comparisonSource(capture) {
  const { title, url, text, selection, truncated, textTruncated, selectionTruncated } = capture.page;
  const bodyShortened = Boolean(textTruncated) || text.length > textLimit;
  const selectionShortened = Boolean(selectionTruncated) || selection.length > selectionLimit;
  return {
    title, url, text: clipExcerpt(text, textLimit), selection: clipExcerpt(selection, selectionLimit),
    textTruncated: bodyShortened, selectionTruncated: selectionShortened,
    truncated: bodyShortened || selectionShortened || Boolean(truncated),
    tab: capture.tab, documentRevision: capture.documentRevision, capturedAt: capture.capturedAt,
  };
}

export function createBrowserCompare({ capture, peers, readSource, prepare, setBusy, isOpen, onPrepared, opensChat, direct, canStart = () => true }) {
  const panel = document.createElement("fieldset"); panel.className = "browser-compare"; panel.hidden = true;
  const legend = document.createElement("legend"); legend.textContent = t("Compare open tabs"); panel.append(legend);
  const button = document.createElement("button"); button.type = "button"; button.className = "ui-button ui-button--secondary";
  button.textContent = t("Compare open tabs");
  button.addEventListener("click", () => { panel.hidden = !panel.hidden; if (!panel.hidden) panel.querySelector("input")?.focus(); });
  const hint = document.createElement("p");
  hint.textContent = t(peers.length ? (direct ? "Choose one or two loaded tabs and review their excerpts." :
    "Choose one or two loaded tabs. Review the sources before preparing a draft.") : "Open another web page before comparing tabs.");
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
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "ui-button ui-button--secondary";
  cancel.textContent = t("Cancel comparison");
  cancel.dataset.i18nText = "Cancel comparison";
  toolbar.append(read);
  if (direct) toolbar.append(direct.button);
  if (prepare) toolbar.append(draft);
  toolbar.append(cancel);
  panel.append(choices, toolbar);
  if (direct) panel.append(direct.notice);
  panel.append(status, preview);
  let reviewed = null, pending = null;
  const selected = () => inputs.filter(({ input }) => input.checked);
  function update() {
    const count = selected().length;
    const blocked = Boolean(pending) || !canStart();
    read.disabled = blocked || count < 1;
    draft.disabled = blocked || !reviewed;
    direct?.setSources(reviewed);
    cancel.hidden = !pending;
    cancel.classList.toggle("hidden", cancel.hidden);
    for (const { input } of inputs) input.disabled = blocked || (!input.checked && count >= maxPeers);
  }
  function clearReview() { reviewed = null; preview.replaceChildren(); status.textContent = ""; update(); }
  function showReview(sources) {
    for (const [index, source] of sources.entries()) {
      const details = document.createElement("details");
      details.open = Boolean(direct);
      const summary = document.createElement("summary"); summary.textContent = `[${index + 1}] ${source.title || source.url}`;
      if (source.truncated) appendPartialCapture(summary);
      const url = document.createElement("p"); url.textContent = source.url;
      const time = document.createElement("p"); time.textContent = `${t("Captured at")}: ${source.capturedAt}`;
      const excerpt = document.createElement("textarea"); excerpt.className = "ui-textarea"; excerpt.readOnly = true;
      excerpt.setAttribute("aria-label", t("Comparison source text"));
      excerpt.value = [source.selection && `${t("Selected text")}\n${source.selection}`, source.text].filter(Boolean).join("\n\n");
      details.append(summary, url, time);
      const notices = [
        source.textTruncated && "Page content was shortened",
        source.selectionTruncated && "Selected text was shortened",
      ].filter(Boolean);
      for (const key of notices) {
        const limit = document.createElement("p");
        limit.dataset.i18nText = key;
        limit.textContent = t(key);
        details.append(limit);
      }
      details.append(excerpt);
      preview.append(details);
    }
  }
  function finish(job) {
    if (pending !== job) return;
    const restoreFocus = isOpen() && document.activeElement === cancel;
    pending = null;
    setBusy(false);
    update();
    if (restoreFocus) job.trigger.focus({ preventScroll: true });
  }
  async function work(trigger, message, operation) {
    if (pending || !canStart() || trigger.disabled || !isOpen()) return;
    const job = { trigger };
    const current = () => pending === job;
    pending = job;
    setBusy(true);
    update();
    status.textContent = t(message);
    cancel.focus();
    try { await operation(current); }
    catch (error) { if (current() && isOpen()) status.textContent = t(String(error?.message ?? error)); }
    finally { finish(job); }
  }
  function cancelWork() {
    if (!pending || !isOpen()) return;
    status.textContent = t("Comparison cancelled. Your selections are kept.");
    finish(pending);
  }
  cancel.addEventListener("click", cancelWork);
  panel.addEventListener("keydown", event => {
    if (!pending || event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
    event.preventDefault(); event.stopPropagation();
    cancelWork();
  });
  for (const { input } of inputs) input.addEventListener("change", () => { if (!pending) clearReview(); });
  read.addEventListener("click", () => {
    const targets = selected().map(({ source }) => source);
    void work(read, "Reading selected tabs…", async current => {
      const sources = [comparisonSource(capture)];
      for (const source of targets) {
        const page = await readSource(source);
        if (!current() || !isOpen()) return;
        sources.push(comparisonSource(page));
      }
      preview.replaceChildren();
      showReview(sources);
      reviewed = sources;
      status.textContent = t(direct ? "Review the excerpts before sending." : "Review the sources, then prepare an unsent draft.");
    });
  });
  draft.addEventListener("click", () => {
    const sources = reviewed;
    if (!sources) return;
    void work(draft, "Preparing comparison draft…", async current => {
      await prepare(sources, current);
      if (current()) onPrepared();
    });
  });
  update();
  return { button, panel, update };
}
