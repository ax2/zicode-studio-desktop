import { t } from "../../i18n.js";
import { openSavedArtifact } from "../features/artifact-navigation.js";

function webUrl(value) {
  try {
    const url = new URL(value);
    if (/^https?:$/.test(url.protocol) && !url.username && !url.password) return url;
  } catch { /* Invalid source URL. */ }
  return null;
}

// Save the reviewed result, not a fresh page read or another model request.
export function browserAnalysisArtifact(capture, analysis) {
  const { url, title } = capture.page;
  const sourceUrl = webUrl(url);
  const labels = { summary: "Page summary", analysis: "Page analysis", image: "Image analysis", comparison: "Web page comparison" };
  if (!sourceUrl || !analysis?.text?.trim() || !Object.hasOwn(labels, analysis.kind)) {
    throw new Error(t("This analysis cannot be saved."));
  }
  const source = { url, title, capturedAt: capture.capturedAt, documentRevision: capture.documentRevision };
  const label = t(labels[analysis.kind]);
  const details = [label, title || url, url];
  if (analysis.kind === "comparison") {
    const sources = analysis.sources;
    if (!Array.isArray(sources) || sources.length < 2 || sources.length > 3 ||
        sources[0]?.url !== url || sources[0]?.documentRevision !== capture.documentRevision ||
        sources.some(entry => !webUrl(entry?.url) || !entry.capturedAt || !entry.documentRevision)) {
      throw new Error(t("This analysis cannot be saved."));
    }
    details.push("", t("Comparison sources"));
    for (const [index, entry] of sources.entries()) {
      details.push(`[${index + 1}] ${entry.title || entry.url}`, entry.url,
        `${t("Captured at")}: ${entry.capturedAt}`, `${t("Document revision")}: ${entry.documentRevision}`);
    }
  }
  if (analysis.kind === "image") {
    const image = analysis.image;
    const frame = image?.frame;
    if (!webUrl(image?.source?.url) || image.pageUrl !== url || image.documentRevision !== capture.documentRevision ||
        (frame?.url && webUrl(frame.url)?.origin !== sourceUrl.origin)) {
      throw new Error(t("This analysis cannot be saved."));
    }
    source.capturedAt = image.capturedAt;
    source.image = { url: image.source.url, alt: image.source.alt };
    details.push(`${t("Image source")}: ${source.image.url}`, `${t("Document version")}: ${source.documentRevision}`);
    if (frame) {
      source.frame = { url: frame.url, title: frame.title, documentRevision: frame.documentRevision };
      details.push(`${t("Image frame source")}: ${frame.url || t("Inline frame")}`,
        `${t("Frame document version")}: ${frame.documentRevision}`);
    }
  }
  const readableTitle = `${label} · ${source.image?.alt || title || url}`.replace(/\p{Cc}/gu, " ").replace(/\s+/gu, " ").trim();
  details.push(`${t("Captured at")}: ${source.capturedAt}`, `${t("Generated at")}: ${analysis.generatedAt}`, "", analysis.text);
  return {
    pluginId: "com.zicode.artifacts", kind: "report",
    title: [...readableTitle].slice(0, 200).join(""),
    mimeType: "text/plain",
    content: details.join("\n"),
    provenance: { producer: "browser.analysis", sourceTrust: "untrusted-web-content", contentTrust: "untrusted-model-output",
      source,
      ...(analysis.kind === "comparison" ? { sources: analysis.sources } : {}),
      analysis: { kind: analysis.kind, generatedAt: analysis.generatedAt, question: analysis.question || "",
        model: { provider: analysis.model.provider, modelId: analysis.model.modelId } } },
  };
}

export function createBrowserAnalysisArtifacts({ capture, getTarget, isCurrent, gateway }) {
  const { sceneId, workspaceId } = getTarget() ?? {};
  const saved = new WeakMap();
  let pending = false;
  const check = () => {
    if (!sceneId || !workspaceId || !isCurrent() ||
        getTarget()?.sceneId !== sceneId || getTarget()?.workspaceId !== workspaceId) {
      throw new Error(t("Page or destination changed. Read the page again."));
    }
  };
  return {
    async save(analysis) {
      check();
      if (saved.has(analysis)) return saved.get(analysis);
      if (pending) throw new Error(t("Saving…"));
      const draft = browserAnalysisArtifact(capture, analysis);
      pending = true;
      try {
        const result = await gateway.create(sceneId, workspaceId, draft);
        if (!result?.artifact?.id) throw new Error(t("Could not save analysis. Try again."));
        saved.set(analysis, result.artifact);
        return result.artifact;
      } finally { pending = false; }
    },
    open(artifact) { check(); openSavedArtifact(artifact.id, { sceneId, workspaceId }); },
  };
}
