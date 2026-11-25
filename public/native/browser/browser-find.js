import { t } from "../../i18n.js";

// Serial native operations and an epoch prevent late results from a previous
// query, navigation or tab from changing the visible search state.
export function createBrowserFind({ control, getTab, available, isPdf = () => false, restoreFocus = async () => {}, report = () => {} }) {
  let tab = null, epoch = 0, timer, poll, tail = Promise.resolve();
  let matches = null, composing = false;
  const element = document.createElement("form"); element.className = "browser-find"; element.hidden = true; element.setAttribute("role", "search"); element.setAttribute("aria-label", t("Find in page"));
  const input = document.createElement("input"); input.className = "ui-input ui-input--sm"; input.type = "search"; input.maxLength = 256; input.placeholder = t("Find in page"); input.setAttribute("aria-label", t("Find in page"));
  const counter = document.createElement("span"); counter.className = "browser-find-count"; counter.setAttribute("role", "status"); counter.setAttribute("aria-live", "polite");
  const make = (text, name, action) => { const button = document.createElement("button"); button.type = "button"; button.className = "ui-icon-button ui-icon-button--sm ui-icon-button--ghost"; button.textContent = text; button.title = t(name); button.setAttribute("aria-label", t(name)); button.addEventListener("click", action); return button; };
  const matchCase = make("Aa", "Match case", () => { matchCase.setAttribute("aria-pressed", String(matchCase.getAttribute("aria-pressed") !== "true")); search(); }); matchCase.setAttribute("aria-pressed", "false");
  const previous = make("↑", "Previous match", () => step(true)); const next = make("↓", "Next match", () => step(false));
  const exit = make("×", "Close page search", () => { void dismiss(); });
  element.append(input, counter, matchCase, previous, next, exit);
  const valid = (id, version) => tab === id && epoch === version && getTab()?.id === id && !element.hidden;
  const enqueue = work => { const result = tail.then(work); tail = result.catch(() => {}); return result; };
  function refreshMatchControls() {
    const pdf = tab !== null && isPdf(tab);
    const hadStepFocus = document.activeElement === previous || document.activeElement === next;
    previous.hidden = next.hidden = pdf;
    previous.disabled = next.disabled = pdf || !matches?.count;
    if (pdf && hadStepFocus) input.focus({ preventScroll: true });
    if (!matches) return;
    if (!matches.count) { counter.textContent = t("No matches"); return; }
    const position = `${matches.active} / ${matches.count}`;
    counter.textContent = pdf && matches.count > 1 ? `${position} · ${t("First PDF match")}` : position;
  }
  function failure(error, id, version) {
    if (!valid(id, version)) return;
    clearTimeout(poll);
    matches = null;
    refreshMatchControls();
    counter.textContent = t(String(error?.message ?? error));
  }
  function paint(result) { matches = result; refreshMatchControls(); }
  function monitor(id, version) {
    clearTimeout(poll);
    poll = setTimeout(() => { if (!valid(id, version)) return; void enqueue(async () => { if (!valid(id, version)) return; try { if (!document.hidden) { const result = await control({ kind: "findStatus", tab: id }); if (valid(id, version)) paint(result); } if (valid(id, version)) monitor(id, version); } catch (error) { failure(error, id, version); } }); }, 350);
  }
  function search() {
    clearTimeout(timer); clearTimeout(poll); const version = ++epoch, id = tab, text = input.value, caseSensitive = matchCase.getAttribute("aria-pressed") === "true";
    matches = null; refreshMatchControls(); counter.textContent = text ? "…" : "";
    const run = () => { timer = null; return enqueue(async () => {
      if (!valid(id, version)) return;
      try {
        if (!text) { await control({ kind: "findStop", tab: id }); return; }
        await control({ kind: "findStart", tab: id, text, caseSensitive });
        if (!valid(id, version)) return;
        const result = await control({ kind: "findStatus", tab: id }); if (valid(id, version)) { paint(result); monitor(id, version); }
      } catch (error) { failure(error, id, version); }
    }); };
    timer = setTimeout(() => void run(), 120);
  }
  function step(backward) {
    if (!tab || !input.value || isPdf(tab)) return;
    if (timer) { search(); return; }
    const id = tab, version = epoch;
    void enqueue(async () => { if (!valid(id, version) || isPdf(id)) return; try { await control({ kind: "findStep", tab: id, backward }); const result = await control({ kind: "findStatus", tab: id }); if (valid(id, version)) paint(result); } catch (error) { failure(error, id, version); } });
  }
  async function close({ stopNative = true } = {}) {
    const id = tab; tab = null; matches = null; composing = false; epoch++; clearTimeout(timer); timer = null; clearTimeout(poll); element.hidden = true;
    if (id && stopNative) await enqueue(() => control({ kind: "findStop", tab: id })).catch(report);
  }
  async function dismiss() {
    const id = tab, stopped = close(), version = epoch;
    await stopped;
    if (id && epoch === version && element.hidden && !tab && available() && getTab()?.id === id) {
      try { await restoreFocus(id); } catch (error) { if (epoch === version && available() && getTab()?.id === id) report(error); }
    }
  }
  function open() {
    const selected = getTab();
    if (!available() || !selected) return;
    if (tab !== selected.id) {
      void close();
      tab = selected.id;
      input.value = "";
      counter.textContent = "";
    }
    element.hidden = false;
    refreshMatchControls();
    input.focus();
    input.select();
  }
  const isComposing = event => event.isComposing || event.keyCode === 229 || (composing && event.target === input);
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; search(); });
  input.addEventListener("blur", () => { composing = false; });
  input.addEventListener("input", event => { if (!isComposing(event)) search(); });
  element.addEventListener("submit", event => { event.preventDefault(); if (!composing) step(false); });
  element.addEventListener("keydown", event => { if (isComposing(event)) return; if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); void dismiss(); } else if (event.key === "Enter" && event.target === input) { event.preventDefault(); step(event.shiftKey); } });
  const keydown = event => { if (!available() || isComposing(event) || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") return; event.preventDefault(); event.stopPropagation(); open(); };
  document.addEventListener("keydown", keydown, true);
  return { element, open, close, refreshMatchControls,
    destroy() { document.removeEventListener("keydown", keydown, true); return close(); } };
}
