import { getLocale, setLocale, t } from "../../i18n.js";
import noteFixture from "../../../tests/fixtures/browser-analysis-note.json";
import { renderMarkdown } from "../../ui/markdown.js";
import { expect, it, vi } from "vitest";
import { browserNoteContent, createBrowserNoteWriter, quotedPageText } from "./browser-note-snapshot.js";
const capture = { tab: "tab", documentRevision: "doc-1", capturedAt: "2026-11-09T03:30:00Z",
  page: { url: "https://example.org/page?one=1&two=2", title: "Article", text: 'Body\n![remote](https://tracker.invalid/pixel) <script>alert(1)</script>', selection: "Chosen words", truncated: true } };
function setup() {
  const target = { sceneId: "programming", workspaceId: "a", runtimeMode: "tools" };
  const gateway = { list: vi.fn(async () => ({ snapshot: { notebooks: [] } })), createNotebook: vi.fn(async () => ({ notebook: { id: "new-book" } })), create: vi.fn(async (_scene, _workspace, notebookId, note) => ({ note: { ...note, id: "saved", notebookId } })) };
  const options = { capture, getTarget: () => target, readCurrent: vi.fn(async () => capture), isCurrent: () => true, gateway };
  return { target, gateway, options, params: { notebookId: "book", title: "Saved article", selectionOnly: false } };
}
it("stores the reviewed snapshot and citation without fetching or starting AI", async () => {
  const { options, gateway, params } = setup();
  options.readCurrent.mockResolvedValue({ ...capture, page: { ...capture.page, text: "Changed dynamic body" } });
  const writer = createBrowserNoteWriter(options);
  await writer.save(params); await writer.save(params);
  expect(gateway.create).toHaveBeenCalledOnce();
  expect(gateway.create.mock.calls[0]).toEqual(["programming", "a", "book", expect.objectContaining({
    content: browserNoteContent(capture), source: { url: capture.page.url, capturedAt: capture.capturedAt, documentRevision: capture.documentRevision }, tags: ["web-clip"],
  })]);
  expect(gateway.create.mock.calls[0][3].content).not.toContain("Changed dynamic body");
});
it("quotes active Markdown and HTML and supports selected text alone", () => {
  expect(quotedPageText("![x](https://x) <img> &")).toBe("\\!\\[x\\]\\(https://x\\) &lt;img&gt; &amp;");
  const text = browserNoteContent(capture, true);
  expect(text).toContain("Chosen words"); expect(text).not.toContain("tracker.invalid");
  expect(text).not.toContain(capture.documentRevision); expect(text).toContain(capture.capturedAt);
});
it.each(["navigation", "scope", "closed"])("rejects %s changes before writing", async change => {
  const { options, gateway, params, target } = setup(); let open = true;
  options.isCurrent = () => open;
  options.readCurrent.mockImplementation(async () => {
    if (change === "scope") target.workspaceId = "other";
    if (change === "closed") open = false;
    return change === "navigation" ? { ...capture, documentRevision: "new-doc" } : capture;
  });
  await expect(createBrowserNoteWriter(options).save(params)).rejects.toThrow(); expect(gateway.create).not.toHaveBeenCalled();
});
it.each([
  ["missing ID", note => ({ ...note, id: "" })],
  ["invalid ID", note => ({ ...note, id: 123 })],
  ["other notebook", note => ({ ...note, notebookId: "other-book" })],
  ["different snapshot", note => ({ ...note, source: { ...note.source, documentRevision: "other-revision" } })],
])("does not open a write whose receipt has a %s", async (_label, change) => {
  const { options, gateway, params } = setup();
  gateway.create.mockImplementationOnce(async (_scene, _workspace, notebookId, draft) => ({
    note: change({ ...draft, id: "saved", notebookId }),
  }));
  const writer = createBrowserNoteWriter(options);
  const open = vi.fn();
  window.addEventListener("zicode:open-note", open);
  try {
    await expect(writer.save(params)).rejects.toThrow(t("The save result is uncertain. Check the destination notebook before retrying."));
    writer.open();
    expect(open).not.toHaveBeenCalled();
    expect(gateway.create).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener("zicode:open-note", open);
  }
});

it("rechecks after creating a notebook and reuses it after a failed note save", async () => {
  const { options, gateway, params } = setup(); params.notebookId = null; params.notebookTitle = "Clips";
  gateway.create.mockRejectedValueOnce(Error("Storage unavailable"));
  const writer = createBrowserNoteWriter(options);
  await expect(writer.save(params)).rejects.toThrow("Storage unavailable");
  await writer.save(params); expect(gateway.createNotebook).toHaveBeenCalledOnce();
  expect(gateway.create).toHaveBeenCalledTimes(2); expect(options.readCurrent).toHaveBeenCalledTimes(4);
});
it("does not write if the page changes while creating a notebook", async () => {
  const { options, gateway, params } = setup(); params.notebookId = null; params.notebookTitle = "Clips";
  options.readCurrent.mockResolvedValueOnce(capture).mockResolvedValueOnce({ ...capture, documentRevision: "changed" });
  await expect(createBrowserNoteWriter(options).save(params)).rejects.toThrow(); expect(gateway.create).not.toHaveBeenCalled();
});

it("appends quoted links only to an explicitly requested whole-page note", () => {
  const linked = { ...capture, page: { ...capture.page, links: [{ label: "<img src=x>", url: "https://example.org/reference" }] } };
  expect(browserNoteContent(linked, false, { includeLinks: true })).toContain("&lt;img src=x&gt; — https://example.org/reference");
  expect(browserNoteContent(linked)).not.toContain("https://example.org/reference");
  expect(browserNoteContent(linked, true, { includeLinks: true })).not.toContain("https://example.org/reference");
});

it("keeps literal pipes and markup in their table cell and handles a single column", () => {
  const tables = [
    { caption: "Inventory", firstRowHeader: true, rows: [["Item", "Count"], ["A | <img src=x>", "2"]] },
    { caption: "", firstRowHeader: false, rows: [["one"], ["two"]] },
  ];
  const source = { ...capture, page: { ...capture.page, tables, tablesTruncated: true } };
  const html = document.createElement("div");
  html.innerHTML = renderMarkdown(browserNoteContent(source, false, { includeTables: true }));
  const rendered = html.querySelectorAll("table");
  expect(rendered).toHaveLength(2);
  expect([...rendered[0].querySelectorAll("td")].map(cell => cell.textContent)).toEqual(["A | <img src=x>", "2"]);
  expect([...rendered[1].querySelectorAll("td")].map(cell => cell.textContent)).toEqual(["one", "two"]);
  expect(html.querySelector("img")).toBeNull();
  expect(browserNoteContent(source)).not.toContain("Inventory");
  expect(browserNoteContent(source, true, { includeTables: true })).not.toContain("Inventory");
});

it("can clip an image-only page without embedding any image or trusting the canonical address", () => {
  const source = { ...capture, page: { ...capture.page, text: "",
    metadata: { language: "zh-Hans", description: "Source description", canonicalUrl: "https://example.org/declared" },
    images: [{ alt: "<img src=x>", width: 24, height: 16, url: "https://example.org/diagram.png" }] } };
  expect(() => browserNoteContent(source)).toThrow();
  const content = browserNoteContent(source, false, { includeMedia: true });
  expect(content).toContain(capture.page.url.replace("&", "&amp;"));
  expect(content).toContain("https://example.org/declared");
  expect(content).toContain("24 × 16");
  const html = document.createElement("div"); html.innerHTML = renderMarkdown(content);
  expect(html.querySelector("img")).toBeNull();
  expect(html.textContent).toContain("<img src=x>");
  expect(browserNoteContent(source, true, { includeMedia: true })).not.toContain("diagram.png");
});

it.each([true, false])("reports only the clipped part in a note (body clipped %s)", textTruncated => {
  const snapshot = { ...capture, page: { ...capture.page, textTruncated, selectionTruncated: !textTruncated } };
  expect(browserNoteContent(snapshot).includes(t("Page content was shortened"))).toBe(textTruncated);
  expect(browserNoteContent(snapshot, true).includes(t("Selected text was shortened"))).toBe(!textTruncated);
  expect(browserNoteContent(snapshot, true)).not.toContain(t("Page content was shortened"));
});


it("adds frame sources, selection and tables only to an opted-in whole-page note", () => {
  const frames = [{ title: "<img src=x>", url: "https://example.org/frame", text: "<img src=x> Embedded prose",
    selection: "Embedded selection", tables: [{ caption: "Embedded table", rows: [["Part"], ["Three"]], firstRowHeader: true }] }];
  const snapshot = { ...capture, page: { ...capture.page, frames, framesOmitted: true } };
  const attachments = { includeFrames: true };
  expect(browserNoteContent(snapshot)).not.toContain(frames[0].url);
  expect(browserNoteContent(snapshot, true, attachments)).not.toContain(frames[0].url);
  const html = document.createElement("div");
  html.innerHTML = renderMarkdown(browserNoteContent(snapshot, false, attachments));
  expect(html.textContent).toContain(frames[0].url);
  expect(html.textContent).toContain(frames[0].selection);
  expect(html.textContent).toContain(frames[0].text);
  expect(html.querySelector("table td").textContent).toBe("Three");
  expect(html.querySelector("img")).toBeNull();
});


it("rejects an OCR-only note without text or with text from another reviewed document", async () => {
  const { options, gateway, params } = setup();
  const writer = createBrowserNoteWriter(options);
  const image = { text: "OCR result", pageUrl: capture.page.url, documentRevision: "other-document" };
  await expect(writer.save({ ...params, imageTextOnly: true, imageText: [] }))
    .rejects.toThrow(t("Select the recognized image text you want to save."));
  await expect(writer.save({ ...params, imageTextOnly: true, imageText: [image] }))
    .rejects.toThrow(t("Page or destination changed. Read the page again."));
  expect(gateway.create).not.toHaveBeenCalled();
  expect(options.readCurrent).not.toHaveBeenCalled();
});

it("preserves opted-in OCR text and its source without rendering markup or sharing it with a selection note", () => {

  const imageText = [{ source: { alt: "<em>Label</em>", url: "https://example.org/diagram.png" },
    pageUrl: capture.page.url, documentRevision: capture.documentRevision, capturedAt: capture.capturedAt,
    text: "Read <img src=x> this", truncated: false,
    frame: { title: "Inventory", url: "https://example.org/inventory", documentRevision: "1700000000000.45" } }];

  const content = browserNoteContent(capture, false, { imageText });
  expect(content).toContain(imageText[0].source.url);
  expect(content).toContain(imageText[0].documentRevision);
  expect(content).toContain(imageText[0].capturedAt);
  expect(content).toContain(imageText[0].frame.url);
  expect(content).toContain(imageText[0].frame.documentRevision);
  const view = document.createElement("div");
  view.innerHTML = renderMarkdown(content);
  expect(view.textContent).toContain(imageText[0].text);
  expect(view.querySelector("img,em")).toBeNull();
  expect(browserNoteContent(capture)).not.toContain(imageText[0].source.url);
  expect(browserNoteContent(capture, true, { imageText })).not.toContain(imageText[0].source.url);
});

it("stores a summary as literal text and reuses a new notebook after a failed write", async () => {
  const { options, gateway, params } = setup();
  const text = "Summary line\n![Illustration](https://example.invalid/image.svg) <em>quoted</em>";
  const writer = createBrowserNoteWriter({ ...options, analysis: {
    kind: "summary", text, generatedAt: "2026-11-09T03:31:00Z", model: { provider: "fixture", modelId: "notes" },
  } });
  gateway.create.mockRejectedValueOnce(Error("Storage unavailable"));
  const destination = { ...params, notebookId: null, notebookTitle: "Research" };
  await expect(writer.save(destination)).rejects.toThrow("Storage unavailable");
  await writer.save(destination);
  expect(gateway.createNotebook).toHaveBeenCalledOnce();
  expect(gateway.create).toHaveBeenCalledTimes(2);
  expect(options.readCurrent).not.toHaveBeenCalled();
  const { content } = gateway.create.mock.calls[1][3];
  const preview = document.createElement("div");
  preview.innerHTML = renderMarkdown(content);
  expect(preview.querySelector("h2").textContent).toBe(t("Page summary"));
  expect(preview.querySelector("img,em")).toBeNull();
  expect(preview.textContent).toContain("![Illustration]");
  expect(preview.textContent).not.toContain("Chosen words");
});

it("keeps a finished analysis in its original destination even during notebook creation", async () => {
  const { options, gateway, params, target } = setup();
  gateway.createNotebook.mockImplementationOnce(async () => {
    target.workspaceId = "changed";
    return { notebook: { id: "new-book" } };
  });
  const writer = createBrowserNoteWriter({ ...options, analysis: {
    kind: "analysis", text: "Reviewed output", generatedAt: "2026-11-09T03:31:00Z",
    model: { provider: "fixture", modelId: "notes" },
  } });
  await expect(writer.save({ ...params, notebookId: null, notebookTitle: "Research" })).rejects.toThrow(t("Page or destination changed. Read the page again."));
  expect(gateway.create).not.toHaveBeenCalled();
  expect(options.readCurrent).not.toHaveBeenCalled();
});

it("stores a reviewed image analysis and its image-time source without including page text or pixels", async () => {
  const locale = getLocale();
  setLocale("en");
  try {
    const { options, gateway, params } = setup();
    const { capture, analysis, draft } = noteFixture.image;
    const result = await createBrowserNoteWriter({ ...options, capture, analysis }).save({ ...params, title: draft.title });
    expect(gateway.create).toHaveBeenCalledExactlyOnceWith("programming", "a", "book", draft);
    expect(options.readCurrent).not.toHaveBeenCalled();
    expect(result.source.capturedAt).toBe(analysis.image.capturedAt);
    expect(result.content).not.toContain(capture.page.text);
    expect(result.content).not.toContain(capture.page.selection);
    const rendered = document.createElement("div");
    rendered.innerHTML = renderMarkdown(result.content);
    expect(rendered.querySelector("img, script")).toBeNull();
    expect(rendered.textContent).toContain("<script>inert</script>");
  } finally {
    setLocale(locale);
  }
});

it.each([
  ["the page changed", image => ({ ...image, pageUrl: "https://example.invalid/other" })],
  ["the document changed", image => ({ ...image, documentRevision: "other-document" })],
  ["the image URL is invalid", image => ({ ...image, source: { ...image.source, url: "file:///C:/fixture.png" } })],
  ["the embedded document is from another origin", image => ({ ...image, frame: { ...image.frame, url: "https://other.invalid/frame" } })],
  ["the embedded document has no revision", image => ({ ...image, frame: { ...image.frame, documentRevision: "" } })],
  ["the capture time is missing", image => ({ ...image, capturedAt: "" })],
])("does not save an image analysis when %s", async (_reason, mutate) => {
  const { options, gateway, params } = setup();
  const { capture, analysis } = noteFixture.image;
  const writer = createBrowserNoteWriter({ ...options, capture, analysis: { ...analysis, image: mutate(analysis.image) } });
  await expect(writer.save(params)).rejects.toThrow(t("This analysis cannot be saved."));
  expect(gateway.create).not.toHaveBeenCalled();
});

it("stores the completed translation and its scope without writing the captured source text", async () => {
  const locale = getLocale();
  setLocale("en");
  try {
    const { options, gateway, params } = setup();
    const analysis = { kind: "translation", text: "Translated passage.", generatedAt: "2026-11-09T03:31:00Z",
      model: { provider: "fixture", modelId: "notes" }, translation: { language: "ko", scope: "selection", truncated: true } };
    const result = await createBrowserNoteWriter({ ...options, analysis }).save({ ...params, title: "Reviewed translation" });
    expect(gateway.create).toHaveBeenCalledOnce();
    expect(options.readCurrent).not.toHaveBeenCalled();
    expect(result.source).toEqual({ url: capture.page.url, capturedAt: capture.capturedAt, documentRevision: capture.documentRevision });
    expect(result.content).toContain("Target language: Korean");
    expect(result.content).toContain("Source text: Selected text");
    expect(result.content).toContain("Capture: Partial capture");
    expect(result.content).toContain("Translated passage.");
    expect(result.content).not.toContain(capture.page.selection);
    expect(result.content).not.toContain(capture.page.text);
  } finally {
    setLocale(locale);
  }
});
