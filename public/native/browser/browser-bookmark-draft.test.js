import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, getByLabelText, getByRole, waitFor } from "@testing-library/dom";
import { t } from "../../i18n.js";
import { showBrowserBookmarks } from "./browser-bookmarks.js";

const descriptors = ["showModal", "close"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]);
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; this.dispatchEvent(new Event("close")); } });
});
afterEach(() => {
  document.body.replaceChildren(); vi.restoreAllMocks();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else delete HTMLDialogElement.prototype[name];
  }
});
const data = { revision: 2, folders: [{ id: "folder", title: "Docs", parentId: null }], bookmarks: [{ id: "one", title: "One", url: "https://one.example.org/", folderId: null }] };
async function setup() {
  const invoke = vi.fn(async (_command, { request }) => request.kind === "list" ? structuredClone(data) : { ...request, revision: 3 });
  const onOpen = vi.fn(), onClose = vi.fn();
  const dialog = showBrowserBookmarks({ invoke, current: { title: "Page", url: "https://page.example.org/" }, onOpen, onClose });
  await waitFor(() => expect(dialog.querySelector("fieldset").disabled).toBe(false));
  getByRole(dialog, "button", { name: `${t("Edit bookmark")}: One` }).click();
  await waitFor(() => expect(dialog.querySelector("form")).not.toBeNull());
  await waitFor(() => expect(dialog.querySelector("fieldset").disabled).toBe(false));
  return { dialog, invoke, onOpen, onClose, title: getByLabelText(dialog, t("Bookmark name")) };
}
const confirmation = () => getByRole(document.body, "dialog", { name: t("Discard bookmark edits?") });
it.each(["New bookmark", "New folder", "Bookmark this page", "Close", "Cancel", "Delete bookmark", "edit-folder", "edit-bookmark", "open-bookmark"])("preserves edits before %s and defaults to keeping them", async action => {
  const h = await setup();
  fireEvent.input(h.title, { target: { value: "My draft" } });
  const labels = { "edit-folder": `${t("Edit folder")}: Docs`, "edit-bookmark": `${t("Edit bookmark")}: One`, "open-bookmark": `${t("Open bookmark")}: One` };
  getByRole(h.dialog, "button", { name: labels[action] ?? t(action), exact: true }).click();
  const prompt = confirmation();
  expect(document.activeElement).toBe(getByRole(prompt, "button", { name: t("Keep editing") }));
  getByRole(prompt, "button", { name: t("Keep editing") }).click();
  await waitFor(() => expect(h.dialog.querySelector("fieldset").disabled).toBe(false));
  expect(h.title.isConnected).toBe(true);
  expect(h.title.value).toBe("My draft");
  await waitFor(() => expect(document.activeElement).toBe(h.title));
  expect(h.invoke).toHaveBeenCalledOnce();
  expect(h.onOpen).not.toHaveBeenCalled();
  expect(h.onClose).not.toHaveBeenCalled();
});
it("guards native and search Escape, ignores duplicate close requests and allows explicit discard", async () => {
  const h = await setup();
  fireEvent.change(getByLabelText(h.dialog, t("Bookmark folder")), { target: { value: "folder" } });
  fireEvent(h.dialog, new Event("cancel", { cancelable: true }));
  getByRole(h.dialog, "button", { name: t("Close") }).click();
  expect(document.querySelectorAll('dialog[aria-label="' + t("Discard bookmark edits?") + '"]')).toHaveLength(1);
  fireEvent(confirmation(), new Event("cancel", { cancelable: true }));
  await waitFor(() => expect(document.activeElement).toBe(h.title));
  const search = getByLabelText(h.dialog, t("Search bookmarks"));
  fireEvent.input(search, { target: { value: "One" } });
  fireEvent.keyDown(search, { key: "Escape" });
  getByRole(confirmation(), "button", { name: t("Discard changes") }).click();
  await waitFor(() => expect(h.onClose).toHaveBeenCalledOnce());
  expect(h.invoke).toHaveBeenCalledOnce();
  expect(document.querySelector("dialog")).toBeNull();
});
it("keeps URL-only edits, discards only after confirmation and does not prompt for reverted fields", async () => {
  const h = await setup();
  const url = getByLabelText(h.dialog, t("Bookmark URL"));
  fireEvent.input(url, { target: { value: "https://draft.example.org/" } });
  getByRole(h.dialog, "button", { name: t("New folder") }).click();
  getByRole(confirmation(), "button", { name: t("Discard changes") }).click();
  await waitFor(() => expect(getByLabelText(h.dialog, t("Folder name"))).toBeTruthy());
  await waitFor(() => expect(h.dialog.querySelector("fieldset").disabled).toBe(false));
  const name = getByLabelText(h.dialog, t("Folder name"));
  fireEvent.input(name, { target: { value: "Reverted" } });
  fireEvent.input(name, { target: { value: "" } });
  getByRole(h.dialog, "button", { name: t("Close") }).click();
  await waitFor(() => expect(h.onClose).toHaveBeenCalledOnce());
  expect(document.querySelector("dialog")).toBeNull();
});
it("saves the retained draft and closes without a stale discard prompt", async () => {
  const h = await setup();
  fireEvent.input(h.title, { target: { value: "Saved draft" } });
  fireEvent.submit(h.dialog.querySelector("form"));
  await waitFor(() => expect(h.dialog.querySelector("form")).toBeNull());
  expect(h.invoke.mock.calls[1][1].request.bookmarks[0].title).toBe("Saved draft");
  getByRole(h.dialog, "button", { name: t("Close") }).click();
  await waitFor(() => expect(h.onClose).toHaveBeenCalledOnce());
  expect(document.querySelector("dialog")).toBeNull();
});
