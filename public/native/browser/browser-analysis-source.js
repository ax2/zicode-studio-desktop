import { t } from "../../i18n.js";

const labels = { summary: "Page summary", analysis: "Page analysis", image: "Image analysis", comparison: "Web page comparison", translation: "Page translation" };

export function browserAnalysisLabel(kind) {
  return Object.hasOwn(labels, kind) ? labels[kind] : undefined;
}

export function analysisWebUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (/^https?:$/.test(url.protocol) && !url.username && !url.password) return url;
  } catch { /* Invalid source URL. */ }
  return null;
}

// Notes and Artifacts cite the same reviewed capture, without storing image pixels.
export function browserAnalysisPageSource(capture, analysis) {
  const { url, title } = capture.page;
  const pageUrl = analysisWebUrl(url);
  const invalid = () => new Error(t("This analysis cannot be saved."));
  if (!pageUrl || !browserAnalysisLabel(analysis?.kind) || typeof analysis?.text !== "string" || !analysis.text.trim()) {
    throw invalid();
  }
  const textTruncated = (analysis.kind === "summary" || analysis.kind === "analysis") &&
    !analysis.selectionOnly && capture.page.textTruncated === true;
  const base = { url, title, capturedAt: capture.capturedAt, documentRevision: capture.documentRevision,
    ...(textTruncated && { textTruncated: true }) };
  if (analysis.kind !== "image") return base;

  const image = analysis.image;
  const frame = image?.frame;
  if (!analysisWebUrl(image?.source?.url) || image.pageUrl !== url || !image.documentRevision ||
      image.documentRevision !== capture.documentRevision || typeof image.capturedAt !== "string" ||
      !Number.isFinite(Date.parse(image.capturedAt))) throw invalid();
  if (frame && (typeof frame.documentRevision !== "string" || !frame.documentRevision.trim() ||
      (frame.url != null && analysisWebUrl(frame.url)?.origin !== pageUrl.origin))) throw invalid();
  return {
    ...base, capturedAt: image.capturedAt, image: { url: image.source.url, alt: image.source.alt },
    ...(frame ? { frame: { url: frame.url, title: frame.title, documentRevision: frame.documentRevision } } : {}),
  };
}
