import { renderMarkdown } from "../../ui/markdown.js";
import { expect, it, vi } from "vitest";
import { browserNoteContent, createBrowserNoteWriter, quotedPageText } from "./browser-note-snapshot.js";
const capture = { tab: "tab", documentRevision: "doc-1", capturedAt: "2026-11-09T03:30:00Z",
  page: { url: "https://example.org/page?one=1&two=2", title: "Article", text: 'Body\n![remote](https://tracker.invalid/pixel) <script>alert(1)</script>', selection: "Chosen words", truncated: true } };
function setup() {
  const target = { sceneId: "programming", workspaceId: "a", runtimeMode: "tools" };
  const gateway = { list: vi.fn(async () => ({ snapshot: { notebooks: [] } })), createNotebook: vi.fn(async () => ({ notebook: { id: "new-book" } })), create: vi.fn(async () => ({ note: { id: "saved" } })) };
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
