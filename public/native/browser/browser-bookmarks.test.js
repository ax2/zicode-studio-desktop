import { t } from "../../i18n.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, getByLabelText, getByRole, waitFor } from "@testing-library/dom";
import { showBrowserBookmarks } from "./browser-bookmarks.js";
import { folderOptions, removeBookmarkFolder } from "./browser-bookmarks-data.js";
const modalDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const closeDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; this.dispatchEvent(new Event("close")); } });
});
afterEach(() => {
  document.body.replaceChildren(); vi.restoreAllMocks();
  for (const [name, descriptor] of [["showModal", modalDescriptor], ["close", closeDescriptor]]) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else delete HTMLDialogElement.prototype[name];
  }
});
const library = () => ({ revision: 3, folders: [{ id: "parent", title: "Docs", parentId: null }, { id: "child", title: "Rust", parentId: "parent" }], bookmarks: [{ id: "saved", title: "Read me", url: "https://example.org/", folderId: "child" }] });
async function open(options = {}) {
  let saved = options.library ?? library(); const calls = [];
  const invoke = vi.fn(async (_command, { request }) => {
    calls.push(request); if (request.kind === "list") return structuredClone(saved);
    if (options.fail?.()) throw Error("Save failed");
    expect(request.expectedRevision).toBe(saved.revision);
    saved = { revision: saved.revision + 1, folders: request.folders, bookmarks: request.bookmarks };return structuredClone(saved);
  });
  const onOpen = options.onOpen ?? vi.fn(), onClose = vi.fn();
  const dialog = showBrowserBookmarks({ invoke, current: options.current ?? null, editCurrent: options.editCurrent, onOpen, onClose });
  await waitFor(() => expect(dialog.querySelector(".browser-bookmark-list")).not.toBeNull());
  await waitFor(() => expect(dialog.querySelector("fieldset").disabled).toBe(false));
  return { dialog, calls, saved: () => saved, onOpen, onClose };
}
it("prefills the current page, saves in a nested folder and renders untrusted titles as text", async () => {
  const title = '<img src=x onerror="alert(1)">'; const h = await open({ current: { title, url: "https://example.com/" }, editCurrent: true });
  const form = getByRole(h.dialog, "form", { name: t("Bookmark editor") });
  expect(getByLabelText(form, t("Bookmark name")).value).toBe(title);
  fireEvent.change(getByLabelText(form, t("Bookmark folder")), { target: { value: "child" } });fireEvent.submit(form);
  await waitFor(() => expect(h.saved().bookmarks).toHaveLength(2));
  expect(h.saved().bookmarks[1]).toMatchObject({ title, url: "https://example.com/", folderId: "child" });
  expect(h.dialog.querySelector("img")).toBeNull();expect(h.dialog.textContent).toContain(title);
});
it("keeps edit text after a failed save and permits retry", async () => {
  let fail = true;const h = await open({ fail: () => fail });
  getByRole(h.dialog, "button", { name: `${t("Edit bookmark")}: Read me` }).click();
  await waitFor(() => expect(h.dialog.querySelector("fieldset").disabled).toBe(false));
  const form = getByRole(h.dialog, "form", { name: t("Bookmark editor") });
  fireEvent.change(getByLabelText(form, t("Bookmark name")), { target: { value: "Revised" } });fireEvent.submit(form);
  await waitFor(() => expect(h.dialog.textContent).toContain(t("Save failed")));expect(getByLabelText(form, t("Bookmark name")).value).toBe("Revised");
  fail = false;fireEvent.submit(form);await waitFor(() => expect(h.saved().bookmarks[0].title).toBe("Revised"));
});
it("reparents folder contents without deleting bookmarks and excludes descendant parents", () => {
  const data = library(); expect(folderOptions(data.folders, "parent")).toEqual([]);
  const next = removeBookmarkFolder(data, "parent");expect(next.folders).toEqual([{ id: "child", title: "Rust", parentId: null }]);
  expect(next.bookmarks).toEqual(data.bookmarks);
  const moved = removeBookmarkFolder(next, "child");expect(moved.bookmarks[0].folderId).toBeNull();expect(moved.bookmarks).toHaveLength(1);
});
it("retains the manager when native opening fails and closes only after success", async () => {
  const onOpen = vi.fn().mockRejectedValueOnce(Error("Navigation blocked")).mockResolvedValueOnce();const h = await open({ onOpen });
  getByRole(h.dialog, "button", { name: `${t("Open bookmark")}: Read me` }).click();
  await waitFor(() => expect(h.dialog.textContent).toContain(t("Navigation blocked")));expect(h.dialog.isConnected).toBe(true);expect(h.onClose).not.toHaveBeenCalled();
  getByRole(h.dialog, "button", { name: `${t("Open bookmark")}: Read me` }).click();await waitFor(() => expect(h.onClose).toHaveBeenCalledOnce());
  expect(h.dialog.isConnected).toBe(false);
});
it("keeps the bookmark manager open when opening a background tab", async () => {
  const h = await open();
  getByRole(h.dialog, "button", { name: `${t("Open in background tab")}: Read me` }).click();
  await waitFor(() => expect(getByRole(h.dialog, "status").textContent).toBe(t("Opened in a background tab")));
  expect(h.onOpen).toHaveBeenCalledWith(library().bookmarks[0], { background: true });
  expect(h.dialog.open).toBe(true);
  expect(h.onClose).not.toHaveBeenCalled();
  expect(h.calls).toEqual([{ kind: "list" }]);
});
it("finds nested bookmarks in a folder and keeps the editor draft while navigating", async () => {
  const fixture = library();
  fixture.bookmarks.push({ id: "outside", title: "Read me elsewhere", url: "https://outside.example.org/", folderId: null });
  const h = await open({ library: fixture });
  const location = getByRole(h.dialog, "navigation", { name: t("Bookmark location") });
  const search = getByLabelText(h.dialog, t("Search bookmarks"));
  const currentLocation = () => location.querySelector('[aria-current="location"]');
  getByRole(h.dialog, "button", { name: `${t("Open folder")}: Docs` }).click();
  expect(currentLocation().textContent).toBe("Docs");
  expect(document.activeElement).toBe(currentLocation());
  expect(h.dialog.querySelector('[data-bookmark-id="saved"]')).toBeNull();
  fireEvent.input(search, { target: { value: " read ME " } });
  expect(h.dialog.querySelector('[data-bookmark-id="saved"] .browser-bookmark-path').textContent).toBe("Docs / Rust");
  expect(h.dialog.querySelector('[data-bookmark-id="outside"]')).toBeNull();
  getByRole(h.dialog, "button", { name: `${t("Edit bookmark")}: Read me` }).click();
  await waitFor(() => expect(h.dialog.querySelector("fieldset").disabled).toBe(false));
  const title = getByLabelText(getByRole(h.dialog, "form", { name: t("Bookmark editor") }), t("Bookmark name"));
  fireEvent.input(title, { target: { value: "Unsaved bookmark title" } });
  getByRole(location.ownerDocument.querySelector(".browser-bookmark-location"), "button", { name: t("Bookmarks root") }).click();
  expect(title.isConnected).toBe(true);
  expect(title.value).toBe("Unsaved bookmark title");
  expect(getByLabelText(h.dialog, t("Search bookmarks")).value).toBe("");
  expect(h.dialog.querySelector('[data-bookmark-id="outside"]')).not.toBeNull();
  expect(h.calls).toEqual([{ kind: "list" }]);
});
it("can close during a slow read and does not reopen when it resolves", async () => {
  let resolve;const onClose = vi.fn();const dialog = showBrowserBookmarks({ invoke: () => new Promise(done => { resolve = done; }), current: null, onOpen: vi.fn(), onClose });
  getByRole(dialog, "button", { name: t("Close") }).click();expect(onClose).toHaveBeenCalledOnce();expect(dialog.isConnected).toBe(false);
  resolve(library());await Promise.resolve();expect(document.querySelector(".browser-bookmarks-dialog")).toBeNull();
});
