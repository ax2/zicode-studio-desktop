import { t } from "../../i18n.js";
import { closeOnSearchEscape } from "./browser-manager-keyboard.js";

const states = { waiting: "Waiting to save", downloading: "Downloading", paused: "Download paused", completed: "Download complete", cancelled: "Download cancelled", failed: "Download failed", interrupted: "Download interrupted" };
export function downloadSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const unit = bytes < 1024 ** 2 ? 1024 : bytes < 1024 ** 3 ? 1024 ** 2 : 1024 ** 3;
  return `${(bytes / unit).toFixed(1)} ${unit === 1024 ? "KB" : unit === 1024 ** 2 ? "MB" : "GB"}`;
}
export function showBrowserDownloads({ invoke, onClose, subscribe }) {
  let closed = false, generation = 0, timer, nextBefore = null, acting = null;
  let loadingBefore, pendingOlder = false;
  let records = new Map(), loadedOlder = false, query = "", awaitingFirstPage = true;
  const rows = new Map(), liveUpdates = new Map();
  const el = (tag, className = "", text) => {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text; return node;
  };
  const dialog = el("dialog", "browser-downloads-dialog ui-panel"); dialog.setAttribute("aria-label", t("Downloads"));
  const directory = el("p", "browser-downloads-meta");
  const list = el("div", "browser-downloads-list"); list.setAttribute("role", "list");
  const empty = el("p"); list.append(empty);
  const message = el("p", "browser-downloads-message"); message.setAttribute("role", "status");
  let actionError = "", loadError = "";
  const updateMessage = () => { message.textContent = actionError || loadError; };
  const request = request => invoke("browser_control", { request });
  const button = (label, action) => {
    const node = el("button", "ui-button ui-button--secondary", t(label)); node.type = "button";
    node.addEventListener("click", () => void action()); return node;
  };
  const available = control => control?.isConnected && !control.matches(":disabled") && !control.closest("[hidden]");
  const mayRestore = control => [control, dialog, document.body].includes(document.activeElement);
  function restoreRowFocus(control) {
    const row = control?.closest("[data-download-id]");
    if (!row) return;
    const next = available(control) ? control : dialog.contains(row) && [...row.querySelectorAll("button")].find(available);
    (next || close).focus({ preventScroll: true });
  }
  async function action(kind, id) {
    if (closed || acting) return;
    const focused = rows.get(id)?.element.contains(document.activeElement) ? document.activeElement : null;
    acting = id; generation++; pendingOlder = false; actionError = ""; updateMessage(); render();
    try {
      await request({ kind, id });
      if (!closed && kind === "downloadRemove") {
        const row = rows.get(id), focused = row?.element.contains(document.activeElement);
        records.delete(id); row?.element.remove(); rows.delete(id);
        if (focused) close.focus();
      }
    }
    catch (error) { if (!closed) { actionError = t(String(error?.message ?? error)); updateMessage(); } }
    finally {
      acting = null;
      if (!closed) {
        render(); await load();
        if (!closed && focused && mayRestore(focused)) restoreRowFocus(focused);
      }
    }
  }
  function createRow(id) {
    const element = el("div", "browser-downloads-row"); element.dataset.downloadId = id; element.setAttribute("role", "listitem");
    const title = el("strong", "browser-downloads-name");
    const url = el("span", "browser-downloads-meta");
    const status = el("span", "browser-downloads-meta");
    const path = el("span", "browser-downloads-path");
    const feedback = el("span");
    const progress = el("progress"); progress.setAttribute("aria-label", t("Download progress"));
    const tools = el("div", "browser-downloads-actions");
    const save = button("Save to Downloads", () => action("downloadSave", id));
    const choose = button("Choose save location", () => action("downloadChoose", id));
    const pause = button("Pause download", () => {
      const kind = records.get(id)?.state === "paused" ? "downloadResume" : "downloadPause";
      return action(kind, id);
    });
    const cancel = button("Cancel download", () => action("downloadCancel", id));
    const reveal = button("Show in File Explorer", () => action("downloadReveal", id));
    const remove = button("Remove from list", () => action("downloadRemove", id));
    remove.title = t("Remove this record; keep the downloaded file");
    tools.append(save, choose, pause, cancel, reveal, remove); element.append(title, url, status, progress, path, feedback, tools);
    list.append(element);
    const row = { element, title, url, status, progress, path, feedback, tools, save, choose, pause, cancel, reveal, remove }; rows.set(id, row); return row;
  }
  function render() {
    empty.hidden = records.size > 0 || Boolean(loadError);
    empty.textContent = t(awaitingFirstPage ? "Loading…" : query ? "No matching downloads" : "No downloads yet");
    list.setAttribute("aria-busy", String(awaitingFirstPage));
    const focused = document.activeElement;
    let previous = empty;
    for (const record of records.values()) {
      const row = rows.get(record.id) ?? createRow(record.id);
      if (previous.nextElementSibling !== row.element) list.insertBefore(row.element, previous.nextElementSibling);
      previous = row.element;
      row.title.textContent = record.name; row.title.title = record.name;
      row.url.textContent = record.url; row.url.title = record.url;
      row.status.textContent = `${t(states[record.state] ?? "Download interrupted")} · ${downloadSize(record.received)}${record.total ? ` / ${downloadSize(record.total)}` : ""}`;
      const paused = record.state === "paused";
      const transferring = paused || record.state === "downloading";
      row.progress.hidden = !transferring;
      if (record.total > 0) { row.progress.max = record.total; row.progress.value = Math.min(record.received, record.total); }
      else row.progress.removeAttribute("value");
      row.path.textContent = record.partialPath && !transferring ? `${t("Partial file")}: ${record.partialPath}` : record.path ?? "";
      row.path.hidden = !row.path.textContent; row.path.title = row.path.textContent;
      const guidance = record.state === "waiting" && record.received > 0
        ? t("Confirm where to save this download, or cancel it.")
        : record.state === "downloading" && record.stalled
        ? t("No recent progress. Cancel to try again.")
        : "";
      let feedback = record.error ? t(record.error) : guidance;
      if (record.state === "interrupted" && record.error === "Studio closed before this download finished") {
        feedback = t("This download can’t be resumed after Studio closes. Return to the page that started it, download again, and choose where to save when prompted.");
      }
      row.feedback.textContent = feedback;
      row.feedback.className = record.error ? "browser-downloads-error" : "browser-downloads-meta";
      row.feedback.hidden = !feedback;
      row.save.hidden = row.choose.hidden = record.state !== "waiting";
      row.pause.hidden = !transferring || (paused && !record.canResume);
      row.pause.textContent = t(paused ? "Continue download" : "Pause download");
      row.cancel.hidden = !transferring && record.state !== "waiting";
      row.reveal.hidden = record.state !== "completed" || !record.path;
      row.remove.hidden = !["completed", "cancelled", "failed", "interrupted"].includes(record.state);
      row.tools.hidden = row.cancel.hidden && row.reveal.hidden && row.remove.hidden;
      for (const control of [row.save, row.choose, row.pause, row.cancel, row.reveal, row.remove]) control.disabled = !!acting;
    }
    if (!acting && list.contains(focused) && mayRestore(focused) &&
        (!available(focused) || document.activeElement !== focused)) restoreRowFocus(focused);
    more.hidden = nextBefore === null;
  }
  async function load(before = null) {
    if (closed || loadingBefore !== undefined || acting) return;
    clearTimeout(timer);
    loadingBefore = before;
    if (before !== null) more.setAttribute("aria-disabled", "true");
    const version = generation, requestedQuery = query;
    liveUpdates.clear();
    try {
      const page = await request({ kind: "downloads", before, ...(requestedQuery ? { query: requestedQuery } : {}) });
      if (closed || version !== generation) return;
      if (before === null) awaitingFirstPage = false;
      loadError = ""; updateMessage();
      const entries = page.entries.map(record => liveUpdates.get(record.id) ?? record);
      const focusOlder = before !== null && document.activeElement === more;
      let firstAdded;
      directory.textContent = `${t("Default download location")}: ${page.directory}`;
      if (before === null) {
        // The first page is authoritative for current ordering. Keep any
        // already-loaded history after it, without replacing their row nodes.
        const current = new Map(entries.map(record => [record.id, record]));
        for (const [id, record] of records) if (!current.has(id)) current.set(id, record);
        records = current;
        if (!loadedOlder) nextBefore = page.nextBefore;
      } else {
        for (const record of entries) {
          if (firstAdded === undefined && !records.has(record.id)) firstAdded = record.id;
          records.set(record.id, record);
        }
        loadedOlder = true;
        nextBefore = page.nextBefore;
      }
      render();
      if (focusOlder) {
        const row = rows.get(firstAdded)?.element;
        if (row) {
          row.tabIndex = -1;
          row.focus();
        } else if (more.hidden) search.focus({ preventScroll: true });
      }
    } catch (error) {
      if (!closed && version === generation) {
        if (before === null) awaitingFirstPage = false;
        loadError = t(String(error?.message ?? error)); updateMessage(); render();
      }
    }
    finally {
      loadingBefore = undefined;
      more.removeAttribute("aria-disabled");
      if (!closed && !acting) {
        const showOlder = pendingOlder && nextBefore !== null;
        pendingOlder = false;
        // A new search can have the same text after two edits.
        if (version !== generation) void load();
        else if (showOlder) void load(nextBefore);
        else timer = setTimeout(() => void load(), 500);
      }
    }
  }
  const form = el("form", "browser-history-search");
  const search = el("input", "ui-input");
  search.type = "search";
  search.maxLength = 256;
  search.placeholder = t("Search downloads");
  search.setAttribute("aria-label", t("Search downloads"));
  closeOnSearchEscape(dialog, search);
  const submit = el("button", "ui-button ui-button--secondary", t("Search"));
  submit.type = "submit";
  form.append(search, submit);
  function applyQuery() {
    const next = search.value.trim();
    if (next === query) return;
    query = next;
    generation++;
    pendingOlder = false;
    records.clear();
    rows.clear();
    list.replaceChildren(empty);
    awaitingFirstPage = true;
    nextBefore = null;
    loadedOlder = false;
    actionError = ""; loadError = ""; updateMessage();
    render();
    void load();
  }
  form.addEventListener("submit", event => { event.preventDefault(); applyQuery(); });
  search.addEventListener("search", () => { if (!search.value) applyQuery(); });
  const more = button("Show older downloads", () => {
    if (closed || acting || nextBefore === null) return;
    if (loadingBefore === null) pendingOlder = true;
    else if (loadingBefore === undefined) void load(nextBefore);
  });
  more.hidden = true;
  const close = button("Close", () => dialog.close());
  const header = el("header", "browser-library-heading");
  header.append(el("h2", "", t("Downloads")), close);
  dialog.append(header, directory, form, list, more, message);
  const unsubscribe = subscribe?.(download => {
    // Existing native events keep loaded rows current even after a completed
    // download falls outside the first history page. Never revive removed rows
    // or insert records outside the current search through this update path.
    if (closed || !records.has(download.id)) return;
    records.set(download.id, download);
    if (loadingBefore !== undefined) liveUpdates.set(download.id, download);
    render();
  });
  dialog.addEventListener("close", () => { closed = true; unsubscribe?.(); generation++; clearTimeout(timer); dialog.remove(); onClose?.(); }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  search.focus({ preventScroll: true });
  render();
  void load();
  return dialog;
}
