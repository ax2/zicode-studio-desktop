import { pageImageDescription, pageMetadataRows } from "./browser-capture-media.js";
import { t } from "../../i18n.js";

// Native text is quoted as text, including Markdown and HTML supplied by a website.
export function quotedPageText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_{}[\]()#!|~%]/g, "\\$&").replace(/^(\s*)([-+=])/gm, "$1\\$2").replace(/^(\s*\d+)\.(?=\s)/gm, "$1\\.").replace(/\n/g, "  \n");
}
function tableMarkdown({ caption, rows, firstRowHeader }) {
  const header = firstRowHeader ? rows[0] : rows[0].map((_, index) => String(index + 1));
  const body = firstRowHeader ? rows.slice(1) : rows;
  const row = cells => `| ${cells.join(" | ")} |`;
  const quote = value => quotedPageText(value.replace(/\s+/g, " "));
  const lines = [row(header.map(quote)), row(header.map(() => "---")), ...body.map(cells => row(cells.map(quote)))];
  return (caption ? quote(caption) + "\n\n" : "") + lines.join("\n");
}
function frameMarkdown(frame) {
  const label = frame.title || frame.url || t("Inline frame");
  return [
    `### ${quotedPageText(label.replace(/\s+/g, " "))}`,
    `${t("Source")}: ${quotedPageText(frame.url || t("Inline frame"))}`,
    frame.selection ? `${t("Selected text")}:\n\n${quotedPageText(frame.selection)}` : "",
    frame.text ? quotedPageText(frame.text) : "",
    ...(frame.tables ?? []).map(tableMarkdown),
    frame.textTruncated ? t("Page content was shortened") : "",
    frame.selectionTruncated ? t("Selected text was shortened") : "",
    frame.tablesTruncated ? t("Only some table data is shown.") : "",
  ].filter(Boolean);
}
function imageTextMarkdown(result) {
  const label = result.source.alt || result.source.url;
  const frame = result.frame;
  const frameSource = frame && [frame.title, frame.url || t("Inline frame")].filter(Boolean).join(" — ");
  return [
    `### ${quotedPageText(label.replace(/\s+/g, " "))}`,
    `${t("Source")}: ${quotedPageText(result.source.url)}`,
    `${t("Captured at")}: ${quotedPageText(result.capturedAt)}`,
    `${t("Document revision")}: ${quotedPageText(result.documentRevision)}`,
    frame ? `${t("Embedded page source")}: ${quotedPageText(frameSource)}` : "",
    frame ? `${t("Embedded page revision")}: ${quotedPageText(frame.documentRevision)}` : "",
    quotedPageText(result.text),
    result.truncated ? t("Recognized image text was shortened.") : "",
  ].filter(Boolean);
}
export function browserNoteContent(capture, selectionOnly = false, { includeLinks = false, includeTables = false, includeMedia = false, includeFrames = false, imageText = [] } = {}) {
  const text = selectionOnly ? capture.page.selection : capture.page.text;
  const links = !selectionOnly && includeLinks ? capture.page.links : null;
  const tables = !selectionOnly && includeTables ? capture.page.tables : null;
  const media = !selectionOnly && includeMedia ? capture.page : null;
  const frames = !selectionOnly && includeFrames ? capture.page.frames ?? [] : [];
  const recognized = selectionOnly ? [] : imageText;
  const metadata = pageMetadataRows(media?.metadata);
  const images = media?.images ?? [];
  if (!text?.trim() && !links?.length && !tables?.length && !metadata.length && !images.length && !frames.length && !recognized.length) {
    throw new Error(t("There is no page text to save."));
  }
  const shortened = selectionOnly ? capture.page.selectionTruncated : capture.page.textTruncated;
  const warning = selectionOnly && shortened ? "Selected text was shortened" : "Page content was shortened";
  return [
    `${t("Source")}: ${quotedPageText(capture.page.url)}`,
    `${t("Captured at")}: ${quotedPageText(capture.capturedAt)}`,
    (shortened ?? capture.page.truncated) ? t(warning) : "",
    ...(text?.trim() ? [`## ${t(selectionOnly ? "Selected text" : "Page content")}`, quotedPageText(text)] : []),
    ...(links?.length ? [`## ${t("Page links")}`, ...links.map(({ label, url }) => quotedPageText(label ? `${label} — ${url}` : url))] : []),
    links?.length && capture.page.linksTruncated ? t("Only some page links are shown.") : "",
    ...(tables?.length ? [`## ${t("Page tables")}`, ...tables.map(tableMarkdown)] : []),
    tables?.length && capture.page.tablesTruncated ? t("Only some table data is shown.") : "",
    ...(metadata.length ? [`## ${t("Page details")}`, ...metadata.map(([name, value]) => `${name}: ${quotedPageText(value)}`)] : []),
    ...(images.length ? [`## ${t("Page images")}`, ...images.map(image => quotedPageText(pageImageDescription(image)))] : []),
    images.length && media.imagesTruncated ? t("Only some loaded images are shown.") : "",
    ...(frames.length ? [`## ${t("Page frames")}`, ...frames.flatMap(frameMarkdown)] : []),
    frames.length && capture.page.framesOmitted ? t("Some frames were unavailable or exceeded capture limits.") : "",
    ...(recognized.length ? [`## ${t("Recognized image text")}`, ...recognized.flatMap(imageTextMarkdown)] : []),
  ].filter(Boolean).join("\n\n");
}
export function createBrowserNoteWriter({ capture, readCurrent, isCurrent, getTarget, gateway }) {
  const initial = getTarget(), scene = initial?.sceneId, workspace = initial?.workspaceId;
  const current = () => isCurrent() && getTarget()?.sceneId === scene && getTarget()?.workspaceId === workspace;
  const created = new Map(); let pending = false, saved = null;
  const check = async () => {
    if (!scene || !workspace || !current()) throw new Error(t("Page or destination changed. Read the page again."));
    const fresh = await readCurrent();
    if (!current() || fresh.tab !== capture.tab || fresh.page.url !== capture.page.url || fresh.documentRevision !== capture.documentRevision) {
      throw new Error(t("Page or destination changed. Read the page again."));
    }
  };
  return {
    async notebooks() {
      if (!scene || !workspace || !current()) throw new Error(t("Page or destination changed. Read the page again."));
      const result = await gateway.list(scene, workspace);
      if (!current()) throw new Error(t("Page or destination changed. Read the page again."));
      return result.snapshot.notebooks;
    },
    async save({ notebookId, notebookTitle, title, selectionOnly, includeLinks, includeTables, includeMedia, includeFrames, imageText }) {
      if (saved) return saved;
      if (pending) throw new Error(t("Saving…"));
      pending = true;
      try {
        const content = browserNoteContent(capture, selectionOnly, { includeLinks, includeTables, includeMedia, includeFrames, imageText });
        title = title.trim(); notebookTitle = notebookTitle?.trim();
        if (!title || [...title].length > 200) throw new Error(t("Enter a note title of up to 200 characters."));
        if (!notebookId && (!notebookTitle || [...notebookTitle].length > 200)) throw new Error(t("Enter a notebook title of up to 200 characters."));
        await check();
        if (!notebookId) {
          notebookId = created.get(notebookTitle);
          if (!notebookId) {
            const result = await gateway.createNotebook(scene, workspace, { title: notebookTitle, icon: "🌐" });
            notebookId = result.notebook.id; created.set(notebookTitle, notebookId);
          }
          // Notebook creation is async: do not write a page that navigated in the meantime.
          await check();
        }
        const result = await gateway.create(scene, workspace, notebookId, { title, content,
          tags: ["web-clip"], icon: "🌐", source: { url: capture.page.url, capturedAt: capture.capturedAt, documentRevision: capture.documentRevision } });
        saved = result.note; return saved;
      } finally { pending = false; }
    },
  };
}
