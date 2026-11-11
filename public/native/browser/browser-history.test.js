import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, getByLabelText, getByRole, waitFor } from "@testing-library/dom";
import { t } from "../../i18n.js";
import { showBrowserHistory } from "./browser-history.js";
const descriptors = ["showModal", "close"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]);
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; this.dispatchEvent(new Event("close")); } });
});
afterEach(() => {
  document.body.replaceChildren(); vi.restoreAllMocks();
  for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor); else delete HTMLDialogElement.prototype[name]; }
});
const visit = id => ({ id, url: `https://example.org/${id}`, title: `Page ${id}`, visitedAt: "2026-11-05T01:00:00Z" });
const idle = dialog => waitFor(() => expect(dialog.querySelector("fieldset").disabled).toBe(false));
async function open({ handle, onOpen = vi.fn() } = {}) {
  const calls = []; const invoke = vi.fn(async (command, { request }) => {
    expect(command).toBe("browser_history"); calls.push(request);
    return handle ? handle(request) : { entries: [visit(2), visit(1)], nextBefore: null, latestId: 2 };
  });
  const onClose = vi.fn(); const dialog = showBrowserHistory({ invoke, onOpen, onClose }); await idle(dialog);return { dialog, calls, onOpen, onClose };
}
it("searches literal input, pages without replacing earlier results and displays hostile titles as text", async () => {
  const h = await open({ handle: r => ({ entries: r.before ? [visit(1)] : [{ ...visit(2), title: '<img src=x onerror="alert(1)">' }], nextBefore: r.before ? null : 2, latestId: 2 }) });
  expect(h.dialog.querySelector("img")).toBeNull();
  getByRole(h.dialog, "button", { name: t("Show older visits") }).click(); await idle(h.dialog);
  expect(h.dialog.querySelectorAll('[role="listitem"]')).toHaveLength(2);expect(h.calls.at(-1).before).toBe(2);
  fireEvent.input(getByLabelText(h.dialog, t("Search browsing history")), { target: { value: "%_" } }); fireEvent.submit(h.dialog.querySelector("form")); await idle(h.dialog);
  expect(h.calls.at(-1)).toEqual({ kind: "list", query: "%_", before: null });expect(h.dialog.querySelectorAll('[role="listitem"]')).toHaveLength(1);
});
it("requires explicit clear confirmation and sends the displayed watermark", async () => {
  const h = await open(); getByRole(h.dialog, "button", { name: t("Clear browsing history") }).click(); await idle(h.dialog);
  expect(h.calls.every(r => r.kind === "list")).toBe(true);
  getByRole(h.dialog, "button", { name: t("Cancel") }).click(); await idle(h.dialog);expect(h.calls).toHaveLength(1);
  getByRole(h.dialog, "button", { name: t("Clear browsing history") }).click(); await idle(h.dialog);
  getByRole(h.dialog, "button", { name: t("Confirm clear history") }).click(); await idle(h.dialog);
  expect(h.calls).toContainEqual({ kind: "clear", throughId: 2 });expect(h.dialog.textContent).toContain(t("Browsing history cleared"));
});
it("removes only the selected visit and preserves the search", async () => {
  const h = await open(); fireEvent.input(getByLabelText(h.dialog, t("Search browsing history")), { target: { value: "Page" } }); fireEvent.submit(h.dialog.querySelector("form")); await idle(h.dialog);
  getByRole(h.dialog, "button", { name: `${t("Remove visit")}: Page 1` }).click(); await idle(h.dialog);
  expect(h.calls).toContainEqual({ kind: "remove", id: 1 });expect(h.calls.at(-1)).toEqual({ kind: "list", query: "Page", before: null });
});
it("keeps the manager and records on failed navigation, then closes after actual success", async () => {
  const onOpen = vi.fn().mockRejectedValueOnce(Error("Blocked test")).mockResolvedValueOnce(); const h = await open({ onOpen });
  getByRole(h.dialog, "button", { name: `${t("Open visited page")}: Page 2` }).click(); await idle(h.dialog);
  expect(h.dialog.open).toBe(true);expect(h.dialog.textContent).toContain("Blocked test");expect(h.onClose).not.toHaveBeenCalled();
  getByRole(h.dialog, "button", { name: `${t("Open visited page")}: Page 2` }).click(); await waitFor(() => expect(h.onClose).toHaveBeenCalledOnce());
  expect(h.calls.every(r => r.kind === "list")).toBe(true);
});
it("can open successive history results in the background without closing the search", async () => {
  const h = await open();
  for (const id of [2, 1]) {
    getByRole(h.dialog, "button", { name: `${t("Open in background tab")}: Page ${id}` }).click();
    await idle(h.dialog);
    expect(h.onOpen).toHaveBeenLastCalledWith(visit(id), { background: true });
    expect(getByRole(h.dialog, "status").textContent).toBe(t("Opened in a background tab"));
  }
  expect(h.dialog.open).toBe(true);
  expect(h.onClose).not.toHaveBeenCalled();
  expect(h.calls).toHaveLength(1);
});
it("retains rows when deletion fails and still permits closing during a pending read", async () => {
  const h = await open({ handle: r => { if (r.kind !== "list") throw Error("Storage failed"); return { entries: [visit(1)], nextBefore: null, latestId: 1 }; } });
  getByRole(h.dialog, "button", { name: `${t("Remove visit")}: Page 1` }).click(); await idle(h.dialog);expect(h.dialog.textContent).toContain("Storage failed");expect(h.dialog.querySelectorAll('[role="listitem"]')).toHaveLength(1);
  const onClose = vi.fn(); const slow = showBrowserHistory({ invoke: () => new Promise(() => {}), onClose });
  getByRole(slow, "button", { name: t("Close") }).click();expect(onClose).toHaveBeenCalledOnce();expect(slow.isConnected).toBe(false);
});
