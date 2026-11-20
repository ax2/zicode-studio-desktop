import { afterEach, expect, it, vi } from "vitest";
import { waitFor, getByRole } from "@testing-library/dom";
import { t } from "../../i18n.js";
import { createBookmarkTransfer } from "./browser-bookmark-transfer.js";
afterEach(() => document.body.replaceChildren());
function fixture() {
  const library = { revision: 7, folders: [{ id: "existing", title: "Existing", parentId: null }], bookmarks: [{ id: "old", title: "Retain", url: "https://existing.org/", folderId: "existing" }] };
  const imported = { skipped: 2, folders: [{ id: "imported", title: "Nested", parentId: null }], bookmarks: [{ id: "new", title: "<img src=x onerror=alert(1)>", url: "https://example.org/", folderId: "imported" }] };
  const invoke = vi.fn(async () => structuredClone(imported)), save = vi.fn(async () => {}), report = vi.fn(); let open = true;
  const transfer = createBookmarkTransfer({ invoke, getLibrary: () => library, save, report, isOpen: () => open, run: async action => { try { await action(); } catch(error) { report(error.message); } } });
  document.body.append(...transfer.buttons, transfer.preview);
  return { library, imported, invoke, save, report, transfer, close: () => { open = false; } };
}
it("previews imported counts without saving, then appends the whole hierarchy under a new folder", async () => {
  const f = fixture(); f.transfer.buttons[0].click(); await waitFor(() => expect(f.transfer.preview.hidden).toBe(false));
  expect(f.save).not.toHaveBeenCalled(); expect(f.transfer.preview.textContent).toContain('2');
  getByRole(f.transfer.preview, "button", { name: t("Import bookmarks") }).click();
  await waitFor(() => expect(f.save).toHaveBeenCalledOnce()); const [folders, bookmarks] = f.save.mock.calls[0];
  expect(folders[0]).toEqual(f.library.folders[0]); expect(bookmarks[0]).toEqual(f.library.bookmarks[0]);
  expect(folders[2].parentId).toBe(folders[1].id); expect(bookmarks[1].folderId).toBe("imported");
  expect(document.querySelector("img")).toBeNull(); expect(f.library.folders).toHaveLength(1);
});
it("retains the preview on save failure and allows retry without changing the original library", async () => {
  const f = fixture(); f.save.mockRejectedValueOnce(Error("Bookmarks changed")); f.transfer.buttons[0].click();
  await waitFor(() => expect(f.transfer.preview.hidden).toBe(false));const confirm = getByRole(f.transfer.preview, "button", { name: t("Import bookmarks") });confirm.click();
  await waitFor(() => expect(f.report).toHaveBeenCalledWith("Bookmarks changed"));expect(f.transfer.preview.hidden).toBe(false);
  confirm.click(); await waitFor(() => expect(f.transfer.preview.hidden).toBe(true)); expect(f.save).toHaveBeenCalledTimes(2);
});
it("cancels preview or native selection without saving and ignores selection after manager close", async () => {
  const f = fixture(); f.transfer.buttons[0].click(); await waitFor(() => expect(f.transfer.preview.hidden).toBe(false));getByRole(f.transfer.preview, "button", { name: t("Cancel import") }).click();
  await waitFor(() => expect(f.transfer.preview.hidden).toBe(true));f.invoke.mockResolvedValueOnce(null);f.transfer.buttons[0].click();await Promise.resolve();expect(f.save).not.toHaveBeenCalled();
  f.close();f.transfer.buttons[0].click();await Promise.resolve();expect(f.transfer.preview.hidden).toBe(true);
});
it("exports the displayed library revision and reports completion only after native save", async () => {
  const f = fixture(); f.invoke.mockResolvedValueOnce({ name: "bookmarks.html" });f.transfer.buttons[1].click();
  await waitFor(() => expect(f.report).toHaveBeenCalledOnce());expect(f.invoke).toHaveBeenCalledWith("browser_bookmark_file", { request: { kind: "export", expectedRevision: 7 } });expect(f.save).not.toHaveBeenCalled();
});
