import { afterEach, expect, it, vi } from "vitest";
import { getByRole, waitFor } from "@testing-library/dom";
import { setLocale } from "../../i18n.js";
import { createBrowserCompare } from "./browser-compare.js";
import { showBrowserCapture } from "./browser-capture-preview.js";

const source = (tab, text = tab) => ({
  page: { title: tab, url: "https://example.test/" + tab, text, selection: "" },
  tab, documentRevision: 1, capturedAt: "2026-11-24T12:00:00Z",
});
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function compare(readSource) {
  setLocale("en");
  let busy = false;
  const setBusy = vi.fn(value => { busy = value; });
  const prepare = vi.fn(async () => {});
  const view = createBrowserCompare({
    capture: source("current"), peers: [{ title: "Peer", tab: "peer", url: "https://example.test/peer" }],
    readSource, prepare, setBusy, isOpen: () => true, onPrepared: vi.fn(), canStart: () => !busy,
  });
  document.body.append(view.button, view.panel);
  view.button.click();
  const peer = getByRole(view.panel, "checkbox");
  peer.click();
  const action = name => getByRole(view.panel, "button", { name });
  return { ...view, setBusy, prepare, peer, read: action("Read selected tabs"), draft: action("Prepare comparison draft") };
}
afterEach(() => { document.body.replaceChildren(); setLocale("zh-CN"); });

it("releases the assistant when a pending tab read is folded away", async () => {
  const late = deferred(), fresh = deferred();
  const readSource = vi.fn().mockReturnValueOnce(late.promise).mockReturnValueOnce(fresh.promise);
  const view = compare(readSource);
  view.read.click();
  const cancel = getByRole(view.panel, "button", { name: "Cancel comparison" });
  expect(document.activeElement).toBe(cancel);
  expect(view.setBusy.mock.calls).toEqual([[true]]);

  view.button.click();
  expect(view.panel.hidden).toBe(true);
  expect(view.setBusy.mock.calls).toEqual([[true], [false]]);
  expect(document.activeElement).toBe(view.button);

  view.button.click();
  expect(document.activeElement).toBe(view.peer);
  expect(view.peer.checked).toBe(true);
  expect(view.draft.disabled).toBe(true);
  view.read.click();
  late.resolve(source("peer", "stale page"));
  await late.promise;
  expect(view.setBusy.mock.calls).toEqual([[true], [false], [true]]);
  expect(view.panel.querySelectorAll(".browser-compare-preview details")).toHaveLength(0);
  expect(view.prepare).not.toHaveBeenCalled();

  fresh.resolve(source("peer", "fresh page"));
  await waitFor(() => expect(view.draft.disabled).toBe(false));
  expect([...view.panel.querySelectorAll(".browser-compare-preview textarea")].map(node => node.value)).toEqual(["current", "fresh page"]);
  expect(view.setBusy.mock.calls).toEqual([[true], [false], [true], [false]]);
});

it("keeps a finished comparison available when folded and reopened", async () => {
  const view = compare(vi.fn(async () => source("peer", "reviewed page")));
  view.read.click();
  await waitFor(() => expect(view.draft.disabled).toBe(false));
  const excerpt = view.panel.querySelector(".browser-compare-preview details");
  view.button.click();
  view.button.click();
  expect(view.panel.querySelector(".browser-compare-preview details")).toBe(excerpt);
  expect(view.draft.disabled).toBe(false);
  expect(view.setBusy.mock.calls).toEqual([[true], [false]]);
  expect(view.prepare).not.toHaveBeenCalled();
});

it("keeps the normal assistant toggle usable while its comparison read is busy", async () => {
  setLocale("en");
  const host = document.createElement("aside");
  const trigger = document.createElement("button");
  document.body.append(host, trigger);
  const pending = deferred();
  const prepare = vi.fn(async () => {});
  const readSource = vi.fn(() => pending.promise);
  const panel = showBrowserCapture(source("current"), vi.fn(), prepare, undefined, {
    peers: [{ title: "Peer", tab: "peer", url: "https://example.test/peer" }],
    readSource, prepare,
  }, false, { host, trigger });
  const toggle = getByRole(panel, "button", { name: "Compare open tabs" });
  toggle.click();
  const comparison = getByRole(panel, "group", { name: "Compare open tabs" });
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(toggle.getAttribute("aria-controls")).toBe(comparison.id);
  const peer = getByRole(comparison, "checkbox");
  expect(document.activeElement).toBe(peer);
  peer.click();
  getByRole(comparison, "button", { name: "Read selected tabs" }).click();
  expect(panel.getAttribute("aria-busy")).toBe("true");
  expect(getByRole(panel, "button", { name: "Prepare chat draft" }).disabled).toBe(true);
  expect(toggle.disabled).toBe(false);
  toggle.click();
  expect(comparison.hidden).toBe(true);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(panel.getAttribute("aria-busy")).toBe("false");
  expect(document.activeElement).toBe(toggle);
  expect(getByRole(panel, "button", { name: "Prepare chat draft" }).disabled).toBe(false);

  pending.resolve(source("peer", "late read after collapse"));
  await pending.promise;
  toggle.click();
  expect(getByRole(comparison, "checkbox").checked).toBe(true);
  expect(comparison.querySelector(".browser-compare-preview details")).toBeNull();
  expect(prepare).not.toHaveBeenCalled();
});

it("describes the current disclosure state and keeps the empty hint reachable in the assistant", () => {
  setLocale("en");
  const host = document.createElement("aside");
  const trigger = document.createElement("button");
  document.body.append(host, trigger);
  const draft = vi.fn(async () => {});
  const readSource = vi.fn();
  const preview = showBrowserCapture(source("current"), vi.fn(), draft, undefined, {
    peers: [], readSource, prepare: draft,
  }, false, { host, trigger });
  const toggle = getByRole(preview, "button", { name: "Compare open tabs" });
  const comparison = preview.querySelector(".browser-compare");
  expect(comparison.id).not.toBe("");
  expect(toggle.getAttribute("aria-controls")).toBe(comparison.id);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(comparison.hidden).toBe(true);

  toggle.click();
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(getByRole(preview, "group", { name: "Compare open tabs" })).toBe(comparison);
  expect(document.activeElement?.textContent).toBe("Open another web page before comparing tabs.");
  expect(comparison.contains(document.activeElement)).toBe(true);
  expect(document.activeElement?.tabIndex).toBe(-1);

  toggle.click();
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(comparison.hidden).toBe(true);
  expect(document.activeElement).toBe(toggle);
  expect(readSource).not.toHaveBeenCalled();
  expect(draft).not.toHaveBeenCalled();
});
