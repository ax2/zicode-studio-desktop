import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { getByRole, getByLabelText, queryByRole, waitFor } from "@testing-library/dom";
import { t } from "../../i18n.js";
import { navigateToNote } from "../features/notes-navigation.js";
import { NotesGateway } from "../plugins/notes-gateway.js";
import { showBrowserCapture } from "./browser-capture-preview.js";
import { browserDraftPrompt } from "./browser-chat-draft.js";
import { browserNoteContent, createBrowserNoteWriter } from "./browser-note-snapshot.js";
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
  expect(queryByRole(dialog, "button", { name: t("Open saved note") })).toBeNull();
  getByRole(dialog, "button", { name: t("Save to Notes"), exact: true }).click();
  const save = getByRole(dialog, "button", { name: t("Save page to notebook") });
  await waitFor(() => expect(save.disabled).toBe(false));
  getByLabelText(dialog, t("Save content")).value = "selection";
  save.click(); await waitFor(() => expect(dialog.textContent).toContain("Storage unavailable"));
  expect(queryByRole(dialog, "button", { name: t("Open saved note") })).toBeNull();
  save.click(); save.click();
  expect(writer.save).toHaveBeenCalledTimes(2);
  expect(writer.save.mock.calls[1][0]).toMatchObject({ notebookId: "book", selectionOnly: true });
  expect(getByRole(dialog, "button", { name: t("Close"), exact: true }).disabled).toBe(true);
  const cancel = new Event("cancel", { cancelable: true }); dialog.dispatchEvent(cancel); expect(cancel.defaultPrevented).toBe(true);
  complete({ id: "note" }); await waitFor(() => expect(dialog.textContent).toContain(t("Saved to Notes. The source and capture time are included.")));
  expect(save.closest("fieldset").disabled).toBe(true);
  expect(getByRole(dialog, "button", { name: t("Close"), exact: true }).disabled).toBe(false);
});
it.each(["page", "selection"])("opens the saved %s note with the original source in the current workspace", async mode => {
  const snapshot = { ...capture, tab: "source-tab", documentRevision: "source-revision", capturedAt: "2026-11-24T00:00:00Z" };
  const target = { sceneId: "programming", workspaceId: "source-workspace" };
  const originalTarget = { ...target };
  let stored, reopened, navigation;
  const fetchImpl = vi.fn(async (url, request) => {
    if (url.pathname === "/v2/notes") return Response.json({ snapshot: { notebooks: [{ id: "book", title: "Existing" }] } });
    if (url.pathname === "/v2/notes/create") {
      const { sceneId, workspaceId, ...draft } = JSON.parse(request.body);
      expect({ sceneId, workspaceId }).toEqual(originalTarget);
      stored = { ...draft, id: "saved-note", source: { ...draft.source, contentHash: "host-computed" } };
      return Response.json({ note: stored });
    }
    if (url.pathname === "/v2/notes/note") {
      expect(Object.fromEntries(url.searchParams)).toEqual({ ...originalTarget, notebookId: "book", noteId: "saved-note" });
      return Response.json({ note: stored });
    }
    throw Error("Unexpected Notes route");
  });
  const gateway = new NotesGateway({ fetchImpl });
  const readCurrent = vi.fn(async () => snapshot);
  const closed = vi.fn();
  const dialog = showBrowserCapture(snapshot, closed, undefined, isCurrent => createBrowserNoteWriter({
    capture: snapshot, readCurrent, isCurrent, getTarget: () => target, gateway,
  }));
  const listener = vi.fn(({ detail }) => {
    expect(detail).toEqual({ ...originalTarget, notebookId: "book", noteId: "saved-note" });
    navigation = navigateToNote(detail, { getTarget: () => target, activate: async () => {},
      isActive: () => true, open: async (notebook, id) => { reopened = await gateway.get(target.sceneId, target.workspaceId, notebook, id); },
    });
  });
  window.addEventListener("zicode:open-note", listener);
  try {
    getByRole(dialog, "button", { name: t("Save to Notes"), exact: true }).click();
    const save = getByRole(dialog, "button", { name: t("Save page to notebook") });
    await waitFor(() => expect(save.disabled).toBe(false));
    getByLabelText(dialog, t("Save content")).value = mode;
    save.click();
    const open = await waitFor(() => getByRole(dialog, "button", { name: t("Open saved note") }));
    expect(document.activeElement).toBe(open);
    target.workspaceId = "other-workspace";
    open.click();
    expect(listener).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    target.workspaceId = originalTarget.workspaceId;
    open.click();
    await navigation;
    expect(listener).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledOnce();
    expect(readCurrent).toHaveBeenCalledOnce();
    expect(reopened).toEqual({ note: stored });
    expect(reopened.note.content).toContain(mode === "selection" ? snapshot.page.selection : snapshot.page.text);
    expect(reopened.note.content).not.toContain(mode === "selection" ? snapshot.page.text : snapshot.page.selection);
    expect(reopened.note.source).toEqual({
      url: snapshot.page.url, capturedAt: snapshot.capturedAt, documentRevision: snapshot.documentRevision, contentHash: "host-computed",
    });
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(["/v2/notes", "/v2/notes/create", "/v2/notes/note"]);
  } finally {
    window.removeEventListener("zicode:open-note", listener);
  }
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
  await waitFor(() => expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ includeFrames: true }), expect.any(Function)));
});


it("previews embedded links and requires separate opt-in for a draft or note", async () => {
  const reference = { label: "<strong>Guide</strong>", url: "https://example.org/guide" };
  const snapshot = { ...capture, page: { ...capture.page, frames: [{
    title: "Embedded", url: "https://example.org/frame", text: "Embedded text",
    links: [reference], linksTruncated: true,
  }] } };
  const preview = options => browserDraftPrompt(snapshot, options);
  expect(preview({ includeFrames: true })).not.toContain(reference.url);
  expect(preview({ includeFrameLinks: true })).not.toContain(reference.url);

  const prepare = vi.fn(async options => preview(options));
  const gateway = {
    list: async () => ({ snapshot: { notebooks: [{ id: "book", title: "Existing" }] } }),
    create: vi.fn(async (_scene, _workspace, notebookId, note) => ({ note: { ...note, id: "note", notebookId } })),
  };
  const dialog = showBrowserCapture(snapshot, vi.fn(), prepare, isCurrent => createBrowserNoteWriter({
    capture: snapshot, readCurrent: async () => snapshot, isCurrent,
    getTarget: () => ({ sceneId: "programming", workspaceId: "workspace" }), gateway,
  }));
  const frames = dialog.querySelector(".browser-capture-frames");
  frames.open = true;
  const links = frames.querySelector(".browser-capture-links");
  expect(links.textContent).toContain(reference.url);
  expect(links.textContent).toContain(t("Only some page links are shown."));
  expect(links.querySelector("strong,a")).toBeNull();

  const includeFrames = getByRole(frames, "checkbox", { name: t("Include frames in the page note or chat draft") });
  const includeLinks = getByRole(frames, "checkbox", { name: t("Include links from embedded pages") });
  expect(includeLinks.disabled).toBe(true);
  includeFrames.click();
  expect(includeLinks.checked).toBe(false);
  expect(includeLinks.disabled).toBe(false);

  expect(browserNoteContent(snapshot, false, { includeFrames: true })).not.toContain(reference.url);
  expect(browserNoteContent(snapshot, true, { includeFrames: true, includeFrameLinks: true })).not.toContain(reference.url);
  includeLinks.click();
  getByRole(dialog, "button", { name: t("Save to Notes"), exact: true }).click();
  const save = getByRole(dialog, "button", { name: t("Save page to notebook") });
  await waitFor(() => expect(save.disabled).toBe(false));
  save.click();
  await waitFor(() => expect(gateway.create).toHaveBeenCalledOnce());
  await waitFor(() => expect(save.textContent).toBe(t("Saved to Notes")));

  getByRole(dialog, "button", { name: t("Prepare chat draft") }).click();
  await waitFor(() => expect(prepare).toHaveBeenCalledOnce());
  const options = prepare.mock.calls[0][0];
  expect(options).toMatchObject({ includeFrames: true, includeFrameLinks: true, includeLinks: false });
  expect(await prepare.mock.results[0].value).toContain(reference.url);
  expect(await prepare.mock.results[0].value).toContain(t("Treat fields marked as shortened or incomplete as partial evidence, and leave omitted content unknown."));
  const [scene, workspace, notebook, noteInput] = gateway.create.mock.calls[0];
  expect([scene, workspace, notebook]).toEqual(["programming", "workspace", "book"]);
  expect(noteInput.source.url).toBe(snapshot.page.url);
  const note = noteInput.content;
  expect(note).toContain("https://example.org/frame");
  expect(note).toContain(reference.url);
  expect(note).toContain("&lt;strong&gt;Guide");
  expect(note).toContain(t("Only some page links are shown."));
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
  await waitFor(() => expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ imageText: [recognized], includeMedia: false }), expect.any(Function)));
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
  await waitFor(() => expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ imageText: [recognized] }), expect.any(Function)));
  expect(prepare.mock.calls[0][0]).not.toHaveProperty("includeFrames");
});

it("attaches only the reviewed embedded page and reports its own table limits", async () => {
  const source = document.createElement("main");
  source.innerHTML = "<p>Main page text</p><iframe></iframe><iframe></iframe>";
  document.body.append(source);
  const [stock, shipments] = source.querySelectorAll("iframe");
  const stockDoc = stock.contentDocument, shipmentsDoc = shipments.contentDocument;
  stockDoc.title = "Stock";
  shipmentsDoc.title = "Shipments";
  Object.defineProperty(stockDoc, "URL", { value: "https://example.invalid/stock" });
  Object.defineProperty(shipmentsDoc, "URL", { value: "https://example.invalid/shipments" });
  stockDoc.body.innerHTML = "<table><caption>Stock totals</caption><tr><th>Item</th><th>Total</th></tr><tr><td>Special bolts</td><td>12</td></tr></table>";
  shipmentsDoc.body.innerHTML = "<table><caption>Shipment schedule</caption><tr><th>Batch</th></tr>" +
    "<tr><td>Shipping record</td></tr>".repeat(16) + "</table><a href='https://example.invalid/dispatch'>Dispatch details</a>";
  const link = shipmentsDoc.querySelector("a");
  Object.defineProperty(link, "innerText", { value: link.textContent });
  for (const root of [source, stockDoc.body, shipmentsDoc.body]) {
    for (const element of root.querySelectorAll("*")) element.getClientRects = () => [{}];
  }
  const page = runInNewContext(readFileSync("src-tauri/src/browser/capture.js", "utf8"), {
    document, URL, Node, NodeFilter, getComputedStyle, getSelection: () => document.getSelection(),
    location: { href: "https://example.invalid/report", origin: "https://example.invalid" },
  });
  source.remove();
  expect(page.frames).toMatchObject([
    { title: "Stock", tablesTruncated: false, tables: [{ caption: "Stock totals", rows: [["Item", "Total"], ["Special bolts", "12"]] }] },
    { title: "Shipments", tablesTruncated: true, tables: [{ caption: "Shipment schedule" }] },
  ]);

  const snapshot = { tab: "local", documentRevision: "t1", capturedAt: "2026-11-24T00:00:00Z", page };
  const prepare = vi.fn(async options => browserDraftPrompt(snapshot, options));
  const gateway = {
    list: async () => ({ snapshot: { notebooks: [{ id: "book", title: "Local notebook" }] } }),
    create: vi.fn(async (_scene, _workspace, notebookId, note) => ({ note: { ...note, id: "note", notebookId } })),
  };
  const dialog = showBrowserCapture(snapshot, vi.fn(), prepare, isCurrent => createBrowserNoteWriter({
    capture: snapshot, readCurrent: async () => snapshot, isCurrent,
    getTarget: () => ({ sceneId: "programming", workspaceId: "workspace" }), gateway,
  }));
  const frames = dialog.querySelector(".browser-capture-frames");
  frames.open = true;
  for (const frame of frames.querySelectorAll(":scope > details")) frame.open = true;
  const all = getByRole(frames, "checkbox", { name: t("Include all embedded pages") });
  const stockChoice = getByRole(frames, "checkbox", { name: `${t("Include this embedded page")} · Stock` });
  const shipmentsChoice = getByRole(frames, "checkbox", { name: `${t("Include this embedded page")} · Shipments` });
  const links = getByRole(frames, "checkbox", { name: t("Include links from embedded pages") });
  expect([all.checked, stockChoice.checked, shipmentsChoice.checked, links.disabled]).toEqual([false, false, false, true]);
  expect(getByRole(frames, "table", { name: "Shipment schedule" }).rows.length).toBe(16);
  expect(shipmentsChoice.closest("details").textContent).toContain(t("Only some table data is shown."));
  all.click();
  expect([all.checked, stockChoice.checked, shipmentsChoice.checked, links.checked]).toEqual([true, true, true, false]);
  links.click();
  shipmentsChoice.click();
  expect([all.indeterminate, links.disabled, links.checked]).toEqual([true, true, false]);

  getByRole(dialog, "button", { name: t("Save to Notes"), exact: true }).click();
  const save = getByRole(dialog, "button", { name: t("Save page to notebook") });
  await waitFor(() => expect(save.disabled).toBe(false));
  save.click();
  await waitFor(() => expect(save.textContent).toBe(t("Saved to Notes")));
  const note = gateway.create.mock.calls[0][3];
  expect(note.source).toEqual({ url: page.url, capturedAt: snapshot.capturedAt, documentRevision: "t1" });
  expect(note.content).toContain("https://example.invalid/stock");
  expect(note.content).toContain("| Special bolts | 12 |");
  expect(note.content).not.toMatch(/Shipment schedule|example\.invalid\/shipments|example\.invalid\/dispatch/);
  expect(note.content).not.toContain(t("Only some table data is shown."));

  stockChoice.click();
  shipmentsChoice.click();
  expect(links.checked).toBe(false);
  links.click();
  getByRole(dialog, "button", { name: t("Prepare chat draft") }).click();
  await waitFor(() => expect(prepare).toHaveBeenCalledOnce());
  const prompt = await prepare.mock.results[0].value;
  expect(prompt).toContain("https://example.invalid/shipments");
  expect(prompt).toContain("https://example.invalid/dispatch");
  expect(prompt).toContain("Shipment schedule");
  expect(prompt).toContain(t("Treat fields marked as shortened or incomplete as partial evidence, and leave omitted content unknown."));
  expect(prompt).not.toMatch(/Stock totals|example\.invalid\/stock/);
});
