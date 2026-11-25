import { t } from "../../i18n.js";
import { randomId } from "../utils/random-id.js";
import { showBrowserComparisonEvidence } from "./browser-comparison-evidence.js";

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
  panel.id = `browser-compare-${randomId()}`;
  const legend = document.createElement("legend"); legend.textContent = t("Compare open tabs"); panel.append(legend);
  const button = document.createElement("button"); button.type = "button"; button.className = "ui-button ui-button--secondary";
  button.textContent = t("Compare open tabs");
  button.setAttribute("aria-controls", panel.id);
  button.setAttribute("aria-expanded", "false");
  const hint = document.createElement("p");
  hint.textContent = t(peers.length ? (direct ? "Choose one or two loaded tabs and review their excerpts." :
    "Choose one or two loaded tabs. Review the sources before preparing a draft.") : "Open another web page before comparing tabs.");
  if (!peers.length) hint.tabIndex = -1;
  panel.append(hint);

  let pending = null;
  button.addEventListener("click", () => {
    const expanded = panel.hidden;
    const restoreFocus = !expanded && panel.contains(document.activeElement);
    panel.hidden = !expanded;
    button.setAttribute("aria-expanded", String(expanded));
    if (expanded) {
      (panel.querySelector("input") ?? hint).focus();
    } else {
      if (restoreFocus) button.focus({ preventScroll: true });
      if (pending && pending.trigger === read) cancelWork();
    }
  });
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
  const selectionOnlyTabs = new Set();
  let review, reviewed = null;
  const selected = () => inputs.filter(({ input }) => input.checked);
  function update() {
    const count = selected().length;
    const blocked = Boolean(pending) || !canStart();
    // Keep the disclosure usable while this panel owns the read, so it can cancel the read.
    if (pending?.trigger === read) button.disabled = false;
    read.disabled = blocked || count < 1;
    draft.disabled = blocked || !reviewed;
    review?.setDisabled(blocked);
    direct?.setSources(reviewed);
    cancel.hidden = !pending;
    cancel.classList.toggle("hidden", cancel.hidden);
    for (const { input } of inputs) input.disabled = blocked || (!input.checked && count >= maxPeers);
  }
  function clearReview() {
    review = undefined;
    reviewed = null;
    preview.replaceChildren();
    update();
  }
  function refreshReview() {
    reviewed = review.material();
    update();
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
  for (const { input } of inputs) input.addEventListener("change", () => {
    if (pending) return;
    status.textContent = "";
    clearReview();
  });
  read.addEventListener("click", () => {
    const targets = selected().map(({ source }) => source);
    void work(read, "Reading selected tabs…", async current => {
      clearReview();
      const sources = [comparisonSource(capture)];
      for (const source of targets) {
        const page = await readSource(source);
        if (!current() || !isOpen()) return;
        sources.push(comparisonSource(page));
      }
      review = showBrowserComparisonEvidence(preview, sources, selectionOnlyTabs, Boolean(direct), refreshReview);
      refreshReview();
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
