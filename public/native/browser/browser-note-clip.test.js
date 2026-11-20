import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getByRole, getByLabelText, waitFor } from "@testing-library/dom";
import { t } from "../../i18n.js";
import { showBrowserCapture } from "./browser-capture-preview.js";
const descriptors = ["showModal", "close"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]);
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; this.dispatchEvent(new Event("close")); } });
});
afterEach(() => {
  document.querySelectorAll("dialog").forEach(d => { d.close(); }); document.body.replaceChildren();
  for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor); else delete HTMLDialogElement.prototype[name]; }
});
const capture = { page: { title: "<img> Article", url: "https://example.org/", text: "Body", selection: "Chosen", truncated: false } };
it("requires an explicit save, keeps errors retryable and suppresses duplicate submission", async () => {
  let complete;
  const writer = { notebooks: vi.fn(async () => [{ id: "book", title: "Existing" }]), save: vi.fn().mockRejectedValueOnce(Error("Storage unavailable")).mockImplementationOnce(() => new Promise(done => { complete = done; })) };
  const dialog = showBrowserCapture(capture, vi.fn(), undefined, () => writer);
  expect(writer.notebooks).not.toHaveBeenCalled(); expect(writer.save).not.toHaveBeenCalled(); expect(dialog.querySelector("img")).toBeNull();
  getByRole(dialog, "button", { name: t("Save to Notes"), exact: true }).click();
  const save = getByRole(dialog, "button", { name: t("Save page to notebook") });
  await waitFor(() => expect(save.disabled).toBe(false));
  getByLabelText(dialog, t("Save content")).value = "selection";
  save.click(); await waitFor(() => expect(dialog.textContent).toContain("Storage unavailable"));
  save.click(); save.click();
  expect(writer.save).toHaveBeenCalledTimes(2);
  expect(writer.save.mock.calls[1][0]).toMatchObject({ notebookId: "book", selectionOnly: true });
  expect(getByRole(dialog, "button", { name: t("Close"), exact: true }).disabled).toBe(true);
  const cancel = new Event("cancel", { cancelable: true }); dialog.dispatchEvent(cancel); expect(cancel.defaultPrevented).toBe(true);
  complete({ id: "note" }); await waitFor(() => expect(dialog.textContent).toContain(t("Saved to Notes. The source and capture time are included.")));
  expect(save.closest("fieldset").disabled).toBe(true);
  expect(getByRole(dialog, "button", { name: t("Close"), exact: true }).disabled).toBe(false);
});
it("offers a named notebook when no notebook exists", async () => {
  const writer = { notebooks: async () => [], save: vi.fn(async () => ({ id: "note" })) };
  const dialog = showBrowserCapture(capture, vi.fn(), undefined, () => writer);
  getByRole(dialog, "button", { name: t("Save to Notes"), exact: true }).click();
  await waitFor(() => expect(getByLabelText(dialog, t("New notebook title")).parentElement.hidden).toBe(false));
  getByLabelText(dialog, t("New notebook title")).value = "Research";
  getByRole(dialog, "button", { name: t("Save page to notebook") }).click();
  await waitFor(() => expect(writer.save).toHaveBeenCalledOnce());
  expect(writer.save.mock.calls[0][0]).toMatchObject({ notebookId: null, notebookTitle: "Research" });
});

it("previews link addresses as text and only attaches them when selected", async () => {
  const linked = { ...capture, page: { ...capture.page, links: [{ label: "<img src=x>", url: "https://example.org/source" }] } };
  const writer = { notebooks: async () => [{ id: "book", title: "Existing" }], save: vi.fn(async () => ({ id: "note" })) };
  const dialog = showBrowserCapture(linked, vi.fn(), undefined, () => writer);
  const details = dialog.querySelector("details"); details.open = true;
  const checkbox = getByRole(dialog, "checkbox");
  expect(checkbox.checked).toBe(false);
  expect(details.textContent).toContain("https://example.org/source");
  expect(details.querySelector("a,img")).toBeNull();
  checkbox.click();
  getByRole(dialog, "button", { name: t("Save to Notes"), exact: true }).click();
  const save = getByRole(dialog, "button", { name: t("Save page to notebook") });
  await waitFor(() => expect(save.disabled).toBe(false));
  save.click();
  await waitFor(() => expect(writer.save).toHaveBeenCalledWith(expect.objectContaining({ includeLinks: true, selectionOnly: false })));
});

it("shows page-declared text and image dimensions without loading the image in the preview", () => {
  const media = { ...capture, page: { ...capture.page, metadata: { description: "<img src=x>" },
    images: [{ alt: "Diagram", width: 120, height: 80, url: "https://example.org/diagram.svg" }] } };
  const dialog = showBrowserCapture(media, vi.fn());
  const details = dialog.querySelector(".browser-capture-media"); details.open = true;
  expect(getByRole(details, "checkbox").checked).toBe(false);
  expect(details.textContent).toContain("Diagram — 120 × 80");
  expect(details.textContent).toContain("<img src=x>");
  expect(details.querySelector("img,a")).toBeNull();
});
