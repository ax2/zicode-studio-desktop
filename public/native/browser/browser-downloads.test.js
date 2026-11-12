import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getByRole } from "@testing-library/dom";
import { t } from "../../i18n.js";
import { showBrowserDownloads } from "./browser-downloads.js";
const descriptors = ["showModal", "close"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]);
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; this.dispatchEvent(new Event("close")); } });
});
afterEach(() => {
  document.querySelectorAll("dialog").forEach(d => { d.close(); }); document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks();
  for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor); else delete HTMLDialogElement.prototype[name]; }
});
const item = (id, state = "waiting", received = 0) => ({ id, name: `<img src=x onerror=alert(1)>-${id}.txt`, url: "https://example.org/file", state, received, total: 100, path: null });
const page = entries => ({ entries, nextBefore: null, directory: "C:\\Downloads" });
const tick = () => vi.advanceTimersByTimeAsync(0);
it("does not approve automatically, preserves the focused row during progress, and saves only the clicked identity", async () => {
  let state = "waiting", received = 0;
  const calls = []; const invoke = vi.fn(async (_, { request }) => {
    calls.push(request);
    if (request.kind === "downloadSave") { state = "downloading"; return null; }
    return page([item("one", state, received)]);
  });
  const dialog = showBrowserDownloads({ invoke }); await tick();
  expect(calls).toEqual([{ kind: "downloads", before: null }]); expect(dialog.querySelector("img")).toBeNull();
  getByRole(dialog, "button", { name: t("Save to Downloads") }).click(); await tick();
  expect(calls).toContainEqual({ kind: "downloadSave", id: "one" });
  const row = dialog.querySelector('[data-download-id="one"]'); const cancel = getByRole(row, "button", { name: t("Cancel download") }); cancel.focus();
  received = 54; await vi.advanceTimersByTimeAsync(500);
  expect(dialog.querySelector('[data-download-id="one"]')).toBe(row); expect(document.activeElement).toBe(cancel);
  expect(row.querySelector("progress").value).toBe(54); expect(row.textContent).toContain("54 B / 100 B");
});
it("pauses and continues the same live download without replacing its row or progress", async () => {
  let state = "downloading";
  const calls = [];
  const invoke = async (_, { request }) => {
    calls.push(request);
    if (request.kind === "downloadPause") { state = "paused"; return null; }
    if (request.kind === "downloadResume") { state = "downloading"; return null; }
    return page([{ ...item("one", state, 54), canResume: state === "paused" }, item("old", "interrupted", 10)]);
  };
  const dialog = showBrowserDownloads({ invoke }); await tick();
  const row = dialog.querySelector('[data-download-id="one"]');
  const pause = getByRole(row, "button", { name: t("Pause download") });
  pause.click(); await tick();
  expect(calls).toContainEqual({ kind: "downloadPause", id: "one" });
  expect(getByRole(row, "button", { name: t("Continue download") })).toBe(pause);
  expect(getByRole(row, "progressbar").value).toBe(54);
  expect(getByRole(row, "button", { name: t("Cancel download") })).toBeTruthy();
  expect(dialog.querySelector('[data-download-id="old"]').textContent).toContain(t("Download interrupted"));
  pause.click(); await tick();
  expect(calls).toContainEqual({ kind: "downloadResume", id: "one" });
  expect(getByRole(row, "button", { name: t("Pause download") })).toBe(pause);
});
it("retains errors and permits retry/cancel after a rejected save", async () => {
  const calls = []; const invoke = async (_, { request }) => {
    calls.push(request);
    if (request.kind === "downloadChoose") throw Error("Location unavailable");
    return page([item("two")]);
  };
  const dialog = showBrowserDownloads({ invoke }); await tick();
  getByRole(dialog, "button", { name: t("Choose save location") }).click(); await tick();
  expect(dialog.textContent).toContain("Location unavailable");
  getByRole(dialog, "button", { name: t("Cancel download") }).click(); await tick();
  expect(calls).toContainEqual({ kind: "downloadCancel", id: "two" });
});
it("serializes polling, ignores late responses after close and stops polling", async () => {
  let resolve; const invoke = vi.fn(() => new Promise(done => { resolve = done; }));
  const onClose = vi.fn(); const dialog = showBrowserDownloads({ invoke, onClose });
  await vi.advanceTimersByTimeAsync(3000); expect(invoke).toHaveBeenCalledOnce();
  getByRole(dialog, "button", { name: t("Close") }).click(); resolve(page([item("late")])); await tick();
  await vi.advanceTimersByTimeAsync(3000); expect(invoke).toHaveBeenCalledOnce();
  expect(dialog.isConnected).toBe(false); expect(dialog.querySelector('[data-download-id="late"]')).toBeNull(); expect(onClose).toHaveBeenCalledOnce();
});
it("keeps older pages while refreshing current downloads and exposes interrupted partial files", async () => {
  const invoke = async (_, { request }) => request.before ? page([{ ...item("old", "interrupted"), partialPath: "C:\\Downloads\\partial.txt", error: "Interrupted" }]) : { ...page([item("new")]), nextBefore: 10 };
  const dialog = showBrowserDownloads({ invoke }); await tick();
  getByRole(dialog, "button", { name: t("Show older downloads") }).click(); await tick();
  await vi.advanceTimersByTimeAsync(500);
  expect(dialog.querySelectorAll('[role="listitem"]')).toHaveLength(2);
  expect(dialog.textContent).toContain("C:\\Downloads\\partial.txt"); expect(dialog.textContent).toContain(t("Download interrupted"));
  expect(getByRole(dialog, "button", { name: t("Save to Downloads") })).toBeTruthy();
});

it("removes only ended records after host confirmation and keeps errors retryable", async () => {
  let entries = [item("done", "completed"), item("busy", "downloading")], reject = true;
  const calls = [];
  const invoke = async (_, { request }) => {
    calls.push(request);
    if (request.kind === "downloadRemove") {
      if (reject) throw Error("History unavailable");
      entries = entries.filter(v => v.id !== request.id); return null;
    }
    return page(entries);
  };
  const dialog = showBrowserDownloads({ invoke }); await tick();
  const remove = getByRole(dialog, "button", { name: t("Remove from list") });
  expect(remove.title).toBe(t("Remove this record; keep the downloaded file"));
  remove.click(); await tick();
  expect(dialog.textContent).toContain("History unavailable");
  expect(dialog.querySelector('[data-download-id="done"]')).not.toBeNull();
  reject = false; remove.focus(); remove.click(); await tick();
  expect(calls).toContainEqual({ kind: "downloadRemove", id: "done" });
  expect(dialog.querySelector('[data-download-id="done"]')).toBeNull();
  expect(dialog.querySelector('[data-download-id="busy"]')).not.toBeNull();
  expect(document.activeElement).toBe(getByRole(dialog, "button", { name: t("Close") }));
});
it("ignores a pre-removal poll arriving after removal", async () => {
  let resolve, count = 0;
  const invoke = async (_, { request }) => {
    if (request.kind === "downloadRemove") return null;
    count++;
    if (count === 2) return new Promise(done => { resolve = done; });
    return page(count === 1 ? [item("gone", "cancelled")] : []);
  };
  const dialog = showBrowserDownloads({ invoke }); await tick();
  await vi.advanceTimersByTimeAsync(500);
  getByRole(dialog, "button", { name: t("Remove from list") }).click(); await tick();
  resolve(page([item("gone", "cancelled")])); await tick();
  await vi.advanceTimersByTimeAsync(500);
  expect(dialog.querySelector('[data-download-id="gone"]')).toBeNull();
  expect(dialog.querySelector('.browser-downloads-list > p').hidden).toBe(false);
});

it("does not poll while removal is awaiting host confirmation", async () => {
  let complete, removed = false, lists = 0;
  const invoke = async (_, { request }) => {
    if (request.kind === "downloadRemove") {
      await new Promise(done => { complete = done; }); removed = true; return null;
    }
    lists++; return page(removed ? [] : [item("ended", "failed")]);
  };
  const dialog = showBrowserDownloads({ invoke }); await tick();
  getByRole(dialog, "button", { name: t("Remove from list") }).click();
  await vi.advanceTimersByTimeAsync(1000);
  expect(lists).toBe(1);
  expect(dialog.querySelector('[data-download-id="ended"]')).not.toBeNull();
  complete(); await tick();
  expect(lists).toBe(2);
  expect(dialog.querySelector('[data-download-id="ended"]')).toBeNull();
});

it("inserts new downloads in host order while keeping focus and the older-page cursor", async () => {
  let entries = [item("first", "downloading")], cursor = null;
  const requests = [];
  const invoke = async (_, { request }) => {
    requests.push(request);
    if (request.before === 100) return { ...page([item("old", "completed")]), nextBefore: 50 };
    if (request.before === 50) return page([item("oldest", "completed")]);
    return { ...page(entries), nextBefore: cursor };
  };
  const dialog = showBrowserDownloads({ invoke }); await tick();
  const ids = () => [...dialog.querySelectorAll("[data-download-id]")].map(row => row.dataset.downloadId);
  const first = dialog.querySelector('[data-download-id="first"]');
  const cancel = getByRole(first, "button", { name: t("Cancel download") });
  cancel.focus();
  entries = [item("new"), item("first", "downloading", 25)];
  cursor = 100;
  await vi.advanceTimersByTimeAsync(500);
  expect(ids()).toEqual(["new", "first"]);
  expect(dialog.querySelector('[data-download-id="first"]')).toBe(first);
  expect(document.activeElement).toBe(cancel);
  expect(first.querySelector("progress").value).toBe(25);
  const more = getByRole(dialog, "button", { name: t("Show older downloads") });
  more.click(); await tick();
  entries = [item("latest"), ...entries]; cursor = 101;
  await vi.advanceTimersByTimeAsync(500);
  expect(ids()).toEqual(["latest", "new", "first", "old"]);
  more.click(); await tick();
  expect(requests.filter(request => request.before !== null).map(request => request.before)).toEqual([100, 50]);
  expect(ids()).toEqual(["latest", "new", "first", "old", "oldest"]);
  expect(more.hidden).toBe(true);
});

it("uses the latest download search for polling and older pages, ignoring a stale result", async () => {
  let finishFirstSearch;
  const invoke = vi.fn(async (_, { request }) => {
    if (request.query === "first") return new Promise(resolve => { finishFirstSearch = resolve; });
    if (request.query === "报告%_") {
      return request.before ? page([item("older", "completed")]) : { ...page([item("match", "completed")]), nextBefore: 42 };
    }
    return page([item("original", "completed")]);
  });
  const dialog = showBrowserDownloads({ invoke }); await tick();
  const input = getByRole(dialog, "searchbox", { name: t("Search downloads") });
  const search = getByRole(dialog, "button", { name: t("Search"), exact: true });
  const ids = () => [...dialog.querySelectorAll("[data-download-id]")].map(row => row.dataset.downloadId);
  input.value = "first"; search.click(); await tick();
  input.value = "报告%_"; search.click();
  finishFirstSearch(page([item("stale", "completed")])); await tick();
  expect(ids()).toEqual(["match"]);
  getByRole(dialog, "button", { name: t("Show older downloads") }).click(); await tick();
  expect(invoke).toHaveBeenCalledWith("browser_control", { request: { kind: "downloads", before: 42, query: "报告%_" } });
  await vi.advanceTimersByTimeAsync(500);
  expect(ids()).toEqual(["match", "older"]);
  input.value = ""; search.click(); await tick();
  expect(ids()).toEqual(["original"]);
});

it("clears recovered polling failures without erasing an unsuccessful user action", async () => {
  let offline = true;
  const invoke = async (_, { request }) => {
    if (request.kind === "downloadChoose") throw Error("Location unavailable");
    if (offline) throw Error("Download list unavailable");
    return page([item("one")]);
  };
  const dialog = showBrowserDownloads({ invoke }); await tick();
  const status = getByRole(dialog, "status");
  expect(status.textContent).toBe("Download list unavailable");
  offline = false; await vi.advanceTimersByTimeAsync(500);
  expect(status.textContent).toBe("");
  getByRole(dialog, "button", { name: t("Choose save location") }).click(); await tick();
  expect(status.textContent).toBe("Location unavailable");
  offline = true; await vi.advanceTimersByTimeAsync(500);
  expect(status.textContent).toBe("Location unavailable");
  offline = false; await vi.advanceTimersByTimeAsync(500);
  expect(status.textContent).toBe("Location unavailable");
  getByRole(dialog, "button", { name: t("Save to Downloads") }).click(); await tick();
  expect(status.textContent).toBe("");
});

it("moves focus from a hidden download action to the next available action", async () => {
  let state = "waiting";
  const invoke = async (_, { request }) => {
    if (request.kind === "downloadSave") state = "downloading";
    if (request.kind === "downloadCancel") state = "cancelled";
    return page([item("focus", state)]);
  };
  const dialog = showBrowserDownloads({ invoke }); await tick();
  const save = getByRole(dialog, "button", { name: t("Save to Downloads") });
  save.focus(); save.click(); await tick();
  expect(document.activeElement).toBe(getByRole(dialog, "button", { name: t("Pause download") }));
  const cancel = getByRole(dialog, "button", { name: t("Cancel download") });
  cancel.focus(); cancel.click(); await tick();
  expect(document.activeElement).toBe(getByRole(dialog, "button", { name: t("Remove from list") }));
});

it("moves focus when polling completes a download but leaves unrelated focus alone", async () => {
  let state = "downloading";
  const invoke = async () => page([{ ...item("focus", state), path: "C:\\Downloads\\focus.txt" }]);
  const dialog = showBrowserDownloads({ invoke }); await tick();
  getByRole(dialog, "button", { name: t("Cancel download") }).focus();
  state = "completed"; await vi.advanceTimersByTimeAsync(500);
  expect(document.activeElement).toBe(getByRole(dialog, "button", { name: t("Show in File Explorer") }));
  const search = getByRole(dialog, "searchbox"); search.focus();
  state = "failed"; await vi.advanceTimersByTimeAsync(500);
  expect(document.activeElement).toBe(search);
});

it("restores a blurred action after failure without overriding a deliberate focus change", async () => {
  let finish;
  const invoke = async (_, { request }) => {
    if (request.kind === "downloadChoose") return new Promise((_, reject) => { finish = () => reject(Error("Location unavailable")); });
    return page([item("focus")]);
  };
  const dialog = showBrowserDownloads({ invoke }); await tick();
  const choose = getByRole(dialog, "button", { name: t("Choose save location") });
  choose.focus(); choose.click(); choose.blur();
  finish(); await tick();
  expect(document.activeElement).toBe(choose);
  choose.click();
  const search = getByRole(dialog, "searchbox"); search.focus();
  finish(); await tick();
  expect(document.activeElement).toBe(search);
});
