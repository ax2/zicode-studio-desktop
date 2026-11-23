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


it("reviews embedded content before explicitly attaching it to a local draft", async () => {
  const page = { ...capture.page, frames: [{ title: "<img src=x>", url: "https://example.org/frame", text: "Body in the frame", selection: "Embedded selection" }], framesOmitted: true };
  const prepare = vi.fn(async () => {});
  const dialog = showBrowserCapture({ ...capture, page }, vi.fn(), prepare);
  const details = dialog.querySelector(".browser-capture-frames"); details.open = true;
  details.querySelector("details").open = true;
  const include = getByRole(details, "checkbox");
  expect(include.checked).toBe(false);
  expect(getByRole(details, "textbox").value).toBe("Body in the frame");
  expect(details.textContent).toContain("https://example.org/frame");
  expect(details.textContent).toContain(t("Some frames were unavailable or exceeded capture limits."));
  expect(details.querySelector("img,a")).toBeNull();
  include.click();
  getByRole(dialog, "button", { name: t("Prepare chat draft") }).click();
  await waitFor(() => expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ includeFrames: true })));
});


it("requests OCR only on its own action and separately opts in to including the text", async () => {
  const image = { alt: "Diagram", width: 500, height: 60, url: "https://example.org/image.png" };
  const snapshot = { ...capture, page: { ...capture.page, images: [image] } };
  const recognized = { source: image, pageUrl: snapshot.page.url, documentRevision: "d1", capturedAt: "2026-11-23T00:00:00Z", text: "<em>Text</em>", truncated: false };
  const recognizeImage = vi.fn().mockRejectedValueOnce(Error("OCR unavailable")).mockResolvedValue(recognized);
  const prepare = vi.fn(async () => {});
  const host = document.createElement("aside"), trigger = document.createElement("button");
  document.body.append(trigger, host);
  const dialog = showBrowserCapture(snapshot, vi.fn(), prepare, undefined, undefined, false, { host, trigger, recognizeImage });
  const media = dialog.querySelector(".browser-capture-media");
  media.open = true;
  const action = getByRole(media, "button", { name: t("Recognize text locally") });
  expect(recognizeImage).not.toHaveBeenCalled();
  action.click();
  await waitFor(() => expect(media.textContent).toContain("OCR unavailable"));
  expect(getByRole(media, "status").textContent).toBe("OCR unavailable");
  action.focus();
  action.click();
  await waitFor(() => expect(getByRole(media, "textbox").value).toBe("<em>Text</em>"));
  expect(document.activeElement).toBe(getByRole(media, "textbox"));
  expect(recognizeImage).toHaveBeenCalledWith(image, undefined);
  const include = getByRole(media, "checkbox", { name: t("Include this image text in the page note or chat draft") });
  expect(include.checked).toBe(false);
  expect(media.querySelector("em")).toBeNull();
  include.click();
  getByRole(dialog, "button", { name: t("Prepare chat draft") }).click();
  await waitFor(() => expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ imageText: [recognized], includeMedia: false })));
});


it("recognizes an image-only frame with its reviewed locator and opts into its result independently of frame text", async () => {
  const image = { alt: "Inventory scan", width: 300, height: 120, url: "https://example.org/scan.png" };
  const frame = { title: "Inventory", url: "https://example.org/warehouse", text: "", images: [image], imageLocator: { path: [0, 1], timeOrigin: "42" } };
  const snapshot = { ...capture, page: { ...capture.page, frames: [frame] } };
  const recognized = { source: image, pageUrl: snapshot.page.url, documentRevision: "d1", capturedAt: "2026-11-23T00:00:00Z", text: "Inventory count",
    frame: { title: frame.title, url: frame.url, documentRevision: "42" } };
  const recognizeImage = vi.fn(async () => recognized);
  const prepare = vi.fn(async () => {});
  const host = document.createElement("aside"), trigger = document.createElement("button");
  document.body.append(trigger, host);
  const dialog = showBrowserCapture(snapshot, vi.fn(), prepare, undefined, undefined, false, { host, trigger, recognizeImage });
  const details = dialog.querySelector(".browser-capture-frames");
  details.open = true;
  details.querySelector("details").open = true;
  expect(recognizeImage).not.toHaveBeenCalled();
  getByRole(details, "button", { name: t("Recognize text locally") }).click();
  await waitFor(() => expect(getByRole(details, "textbox").value).toBe("Inventory count"));
  expect(recognizeImage).toHaveBeenCalledWith(image, { title: frame.title, url: frame.url, locator: frame.imageLocator });
  const includeFrame = getByRole(details, "checkbox", { name: t("Include frames in the page note or chat draft") });
  const includeImage = getByRole(details, "checkbox", { name: t("Include this image text in the page note or chat draft") });
  expect(includeFrame.checked).toBe(false);
  expect(includeImage.checked).toBe(false);
  includeImage.click();
  getByRole(dialog, "button", { name: t("Prepare chat draft") }).click();
  await waitFor(() => expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ imageText: [recognized] })));
  expect(prepare.mock.calls[0][0]).not.toHaveProperty("includeFrames");
});
