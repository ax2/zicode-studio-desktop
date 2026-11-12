import { t } from "../../i18n.js";
import { closeOnSearchEscape } from "./browser-manager-keyboard.js";
import { createBackgroundOpenButton } from "./browser-background-open.js";

export function showBrowserHistory({ invoke, onOpen, onClose }) {
  let page = { entries: [], nextBefore: null, latestId: 0 }, query = "", busy = false;
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const dialog = el("dialog", "browser-history-dialog ui-panel"); dialog.setAttribute("aria-label", t("Browsing history"));
  const content = el("fieldset", "browser-history-content");
  const message = el("p"); message.setAttribute("role", "status");
  const run = async (work, nextFocus) => {
    if (busy) return;
    const previous = document.activeElement;
    busy = true;
    content.disabled = true;
    message.textContent = "";
    try { await work(); }
    catch (error) { message.textContent = t(String(error?.message ?? error)); }
    finally {
      busy = false;
      content.disabled = false;
      const active = document.activeElement;
      if (dialog.open && (active === previous || active === dialog || active === document.body)) {
        const target = nextFocus ? nextFocus() : previous;
        const available = target instanceof HTMLElement && dialog.contains(target) &&
          !target.matches(":disabled") && !target.closest("[hidden]");
        (available ? target : search).focus({ preventScroll: true });
      }
    }
  };
  const button = (label, work, variant = "secondary", nextFocus) => {
    const node = el("button", `ui-button ui-button--${variant}`, t(label)); node.type = "button";
    node.addEventListener("click", () => void run(work, nextFocus)); return node;
  };
  const request = request => invoke("browser_history", { request });
  const form = el("form", "browser-history-search");
  const search = el("input", "ui-input"); search.type = "search"; search.maxLength = 256; search.setAttribute("aria-label", t("Search browsing history")); search.placeholder = t("Search browsing history");
  closeOnSearchEscape(dialog, search);
  const submit = el("button", "ui-button ui-button--secondary", t("Search")); submit.type = "submit"; form.append(search, submit);
  const toolbar = el("div", "ui-toolbar browser-history-toolbar");
  const confirm = el("div", "browser-history-confirm"); confirm.hidden = true;
  const list = el("div", "browser-history-list"); list.setAttribute("role", "list");
  const load = async (before = null) => {
    const result = await request({ kind: "list", query, before });
    if (!dialog.open) return;
    page = { ...result, entries: before ? [...page.entries, ...result.entries] : result.entries };
    confirm.hidden = true; render();
  };
  const submitSearch = () => run(async () => { query = search.value.trim(); await load(); }, () => search);
  form.addEventListener("submit", event => { event.preventDefault(); void submitSearch(); });
  search.addEventListener("search", () => { if (!search.value && query) void submitSearch(); });
  const more = button("Show older visits", () => load(page.nextBefore));
  const cancelClear = button("Cancel", () => { confirm.hidden = true; }, "secondary", () => clear);
  const clear = button("Clear browsing history", () => {
    const throughId = page.latestId;
    confirm.replaceChildren(el("p", "", t("Remove all visits recorded so far, including results outside this search? Bookmarks, tabs and site data will be kept.")),
      button("Confirm clear history", async () => { await request({ kind: "clear", throughId }); await load(); message.textContent = t("Browsing history cleared"); }, "danger"),
      cancelClear);
    confirm.hidden = false;
  }, "secondary", () => cancelClear);
  toolbar.append(button("Refresh history", () => load()), clear);
  function render() {
    list.replaceChildren(); clear.disabled = !page.latestId; more.hidden = !page.nextBefore;
    if (!page.entries.length) list.append(el("p", "", t("No browsing history found")));
    for (const visit of page.entries) {
      const row = el("div", "browser-history-row"); row.dataset.visitId = visit.id; row.setAttribute("role", "listitem");
      const details = el("div", "browser-history-details");
      const title = button("Open visited page", async () => { await onOpen(visit); dialog.close(); });
      title.textContent = visit.title || visit.url; title.title = visit.url; title.setAttribute("aria-label", `${t("Open visited page")}: ${visit.title || visit.url}`);
      const url = el("span", "browser-history-meta", visit.url); url.title = visit.url;
      const time = el("time", "browser-history-meta", new Date(visit.visitedAt).toLocaleString()); time.dateTime = visit.visitedAt;
      details.append(title, url, time);
      const remove = button("Remove visit", async () => { await request({ kind: "remove", id: visit.id }); await load(); });
      remove.setAttribute("aria-label", `${t("Remove visit")}: ${visit.title || visit.url}`);
      const actions = el("div", "ui-toolbar");
      actions.append(createBackgroundOpenButton(visit, { onOpen, run, message }), remove);
      row.append(details, actions); list.append(row);
    }
  }
  const close = el("button", "ui-button ui-button--secondary", t("Close")); close.type = "button"; close.addEventListener("click", () => dialog.close());
  content.append(form, toolbar, confirm, list, more);
  dialog.append(el("h2", "", t("Browsing history")), content, message, close);
  dialog.addEventListener("close", () => { dialog.remove(); onClose?.(); }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  close.focus({ preventScroll: true });
  void run(() => load(), () => search);
  return dialog;
}
