import { pageImageDescription, pageMetadataRows } from "./browser-capture-media.js";
import { selectCapturedFrames } from "./browser-capture-frames.js";
import { selectCapturedTables } from "./browser-capture-tables.js";
import { t } from "../../i18n.js";
import { browserAnalysisLabel, browserAnalysisPageSource } from "./browser-analysis-source.js";
import { browserTranslationDetails } from "./browser-translation.js";

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
const linkMarkdown = ({ label, url }) => quotedPageText(label ? `${label} — ${url}` : url);

function frameMarkdown(frame, includeLinks) {
  const label = frame.title || frame.url || t("Inline frame");
  return [
    `### ${quotedPageText(label.replace(/\s+/g, " "))}`,
    `${t("Source")}: ${quotedPageText(frame.url || t("Inline frame"))}`,
    frame.selection ? `${t("Selected text")}:\n\n${quotedPageText(frame.selection)}` : "",
    frame.text ? quotedPageText(frame.text) : "",
    ...(frame.tables ?? []).map(tableMarkdown),
    ...(includeLinks && frame.links?.length ? [t("Page links"), ...frame.links.map(linkMarkdown)] : []),
    includeLinks && frame.linksTruncated ? t("Only some page links are shown.") : "",
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
export function browserNoteContent(capture, selectionOnly = false, { includeLinks = false, includeTables = false, tableIndexes, includeMedia = false, includeFrames = false, frameIndexes, includeFrameLinks = false, imageText = [] } = {}) {
  const text = selectionOnly ? capture.page.selection : capture.page.text;
  const links = !selectionOnly && includeLinks ? capture.page.links : null;
  const tables = !selectionOnly && includeTables ? selectCapturedTables(capture.page.tables, tableIndexes) : [];
  const media = !selectionOnly && includeMedia ? capture.page : null;
  const frames = !selectionOnly && includeFrames ? selectCapturedFrames(capture.page.frames, frameIndexes) : [];
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
    ...(links?.length ? [`## ${t("Page links")}`, ...links.map(linkMarkdown)] : []),
    links?.length && capture.page.linksTruncated ? t("Only some page links are shown.") : "",
    ...(tables?.length ? [`## ${t("Page tables")}`, ...tables.map(tableMarkdown)] : []),
    tables?.length && capture.page.tablesTruncated ? t("Only some table data is shown.") : "",
    ...(metadata.length ? [`## ${t("Page details")}`, ...metadata.map(([name, value]) => `${name}: ${quotedPageText(value)}`)] : []),
    ...(images.length ? [`## ${t("Page images")}`, ...images.map(image => quotedPageText(pageImageDescription(image)))] : []),
    images.length && media.imagesTruncated ? t("Only some loaded images are shown.") : "",
    ...(frames.length ? [`## ${t("Page frames")}`, ...frames.flatMap(frame => frameMarkdown(frame, includeFrameLinks))] : []),
    frames.length && capture.page.framesOmitted ? t("Some frames were unavailable or exceeded capture limits.") : "",
    ...(recognized.length ? [`## ${t("Recognized image text")}`, ...recognized.flatMap(imageTextMarkdown)] : []),
  ].filter(Boolean).join("\n\n");
}
function browserAnalysisNoteContent(source, analysis) {
  const { title, url, image, frame, capturedAt, documentRevision } = source;
  const { question, generatedAt, kind, model } = analysis;
  const line = (name, value) => `${t(name)}: ${quotedPageText(value)}`;
  const heading = browserAnalysisLabel(kind);
  const sources = kind === "comparison" ? [
    `### ${t("Comparison sources")}`,
    ...analysis.sources.flatMap((entry, index) => [
      `**[${index + 1}]** ${quotedPageText(entry.title || entry.url)}`,
      line("Source", entry.url),
      line("Captured at", entry.capturedAt),
      line("Document revision", entry.documentRevision),
    ]),
  ] : [];
  return [
    `## ${t(heading)}`,
    title && line("Page title", title),
    line("Source", url),
    line("Captured at", capturedAt),
    line("Document revision", documentRevision),
    image && line("Image source", image.url),
    ...(frame ? [
      line("Image frame source", [frame.title, frame.url || t("Inline frame")].filter(Boolean).join(" · ")),
      line("Frame document version", frame.documentRevision),
    ] : []),
    line("Generated at", generatedAt),
    line("Browser model", `${model.provider} / ${model.modelId}`),
    question && line("Browser analysis question", question),
    ...browserTranslationDetails(analysis.translation).map(([label, value]) => line(label, value)),
    ...sources,
    `### ${t("Browser model answer")}`,
    quotedPageText(analysis.text),
  ].filter(Boolean).join("\n\n");
}

export function createBrowserNoteWriter({ capture, readCurrent, isCurrent, getTarget, gateway, analysis }) {
  const initial = getTarget(), scene = initial?.sceneId, workspace = initial?.workspaceId;
  const current = () => isCurrent() && getTarget()?.sceneId === scene && getTarget()?.workspaceId === workspace;
  const created = new Map(); let pending = false, saved = null;
  const checkDestination = () => {
    if (!scene || !workspace || !current()) throw new Error(t("Page or destination changed. Read the page again."));
  };
  const check = async () => {
    checkDestination();
    if (analysis) return;
    const fresh = await readCurrent();
    if (!current() || fresh.tab !== capture.tab || fresh.page.url !== capture.page.url || fresh.documentRevision !== capture.documentRevision) {
      throw new Error(t("Page or destination changed. Read the page again."));
    }
  };
  return {
    async notebooks() {
      checkDestination();
      const result = await gateway.list(scene, workspace);
      if (!current()) throw new Error(t("Page or destination changed. Read the page again."));
      return result.snapshot.notebooks;
    },
    async save({ notebookId, notebookTitle, title, selectionOnly, includeLinks, includeTables, tableIndexes, includeMedia, includeFrames, frameIndexes, includeFrameLinks, imageText }) {
      if (saved) return saved;
      if (pending) throw new Error(t("Saving…"));
      pending = true;
      try {
        const analysisSource = analysis && browserAnalysisPageSource(capture, analysis);
        const content = analysisSource ? browserAnalysisNoteContent(analysisSource, analysis)
          : browserNoteContent(capture, selectionOnly, { includeLinks, includeTables, tableIndexes, includeMedia, includeFrames, frameIndexes, includeFrameLinks, imageText });
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
        checkDestination();
        const tags = analysis ? ["web-clip", "browser-analysis"] : ["web-clip"];
        const source = { url: capture.page.url, capturedAt: analysisSource?.capturedAt ?? capture.capturedAt,
          documentRevision: capture.documentRevision };
        const result = await gateway.create(scene, workspace, notebookId, { title, content, tags, icon: "🌐", source });
        const note = result?.note;
        // Notes normalizes line endings but returns the same source citation.
        if (typeof note?.id !== "string" || !note.id.trim() || note.notebookId !== notebookId || note.title !== title ||
          note.content !== content.replace(/\r\n?/g, "\n") || note.source?.url !== source.url ||
          note.source?.capturedAt !== source.capturedAt || note.source?.documentRevision !== source.documentRevision) {
          throw new Error(t("The save result is uncertain. Check the destination notebook before retrying."));
        }
        saved = note; return saved;
      } finally { pending = false; }
    },
    open() {
      checkDestination();
      if (!saved?.id || !saved.notebookId) return;
      window.dispatchEvent(new CustomEvent("zicode:open-note", {
        detail: { noteId: saved.id, notebookId: saved.notebookId, sceneId: scene, workspaceId: workspace },
      }));
    },
  };
}
