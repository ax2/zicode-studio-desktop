import { t } from "../../i18n.js";

// Serial native operations and an epoch prevent late results from a previous
// query, navigation or tab from changing the visible search state.
export function createBrowserFind({ control, getTab, available, restoreFocus = async () => {}, report = () => {} }) {
  let tab = null, epoch = 0, timer, poll, tail = Promise.resolve();
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
  function failure(error, id, version) { if (valid(id, version)) { clearTimeout(poll); counter.textContent = t(String(error?.message ?? error)); previous.disabled = next.disabled = true; } }
  function paint(result) { counter.textContent = result.count ? `${result.active} / ${result.count}` : t("No matches"); previous.disabled = next.disabled = !result.count; }
  function monitor(id, version) {
    clearTimeout(poll);
    poll = setTimeout(() => { if (!valid(id, version)) return; void enqueue(async () => { if (!valid(id, version)) return; try { if (!document.hidden) { const result = await control({ kind: "findStatus", tab: id }); if (valid(id, version)) paint(result); } if (valid(id, version)) monitor(id, version); } catch (error) { failure(error, id, version); } }); }, 350);
  }
  function search() {
    clearTimeout(timer); clearTimeout(poll); const version = ++epoch, id = tab, text = input.value, caseSensitive = matchCase.getAttribute("aria-pressed") === "true";
    previous.disabled = next.disabled = true; counter.textContent = text ? "…" : "";
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
    if (!tab || !input.value) return;
    if (timer) { search(); return; }
    const id = tab, version = epoch;
    void enqueue(async () => { if (!valid(id, version)) return; try { await control({ kind: "findStep", tab: id, backward }); const result = await control({ kind: "findStatus", tab: id }); if (valid(id, version)) paint(result); } catch (error) { failure(error, id, version); } });
  }
  async function close() {
    const id = tab; tab = null; epoch++; clearTimeout(timer); timer = null; clearTimeout(poll); element.hidden = true;
    if (id) await enqueue(() => control({ kind: "findStop", tab: id })).catch(report);
  }
  async function dismiss() {
    const id = tab, stopped = close(), version = epoch;
    await stopped;
    if (id && epoch === version && element.hidden && !tab && available() && getTab()?.id === id) {
      try { await restoreFocus(id); } catch (error) { if (epoch === version && available() && getTab()?.id === id) report(error); }
    }
  }
  function open() {
    if (!available() || !getTab()) return;
    if (tab !== getTab().id) { void close(); tab = getTab().id; input.value = ""; counter.textContent = ""; previous.disabled = next.disabled = true; }
    element.hidden = false; input.focus(); input.select();
  }
  input.addEventListener("input", event => { if (!event.isComposing) search(); }); input.addEventListener("compositionend", search);
  element.addEventListener("submit", event => { event.preventDefault(); step(false); });
  element.addEventListener("keydown", event => { if (event.isComposing) return; if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); void dismiss(); } else if (event.key === "Enter") { event.preventDefault(); step(event.shiftKey); } });
  const keydown = event => { if (!available() || event.isComposing || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") return; event.preventDefault(); event.stopPropagation(); open(); };
  document.addEventListener("keydown", keydown, true);
  return { element, open, close, destroy() { document.removeEventListener("keydown", keydown, true); return close(); } };
}
