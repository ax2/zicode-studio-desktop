import { t } from "../../i18n.js";
import { openSavedArtifact } from "../features/artifact-navigation.js";
import { analysisWebUrl, browserAnalysisLabel, browserAnalysisPageSource } from "./browser-analysis-source.js";
import { browserTranslationDetails } from "./browser-translation.js";

// Save the reviewed result, not a fresh page read or another model request.
export function browserAnalysisArtifact(capture, analysis) {
  const source = browserAnalysisPageSource(capture, analysis);
  const { url, title } = source;
  const label = t(browserAnalysisLabel(analysis.kind));
  const details = [label, title || url, url];
  if (analysis.kind === "comparison") {
    const sources = analysis.sources;
    if (!Array.isArray(sources) || sources.length < 2 || sources.length > 3 ||
        sources[0]?.url !== url || sources[0]?.documentRevision !== capture.documentRevision ||
        sources.some(entry => !analysisWebUrl(entry?.url) || !entry.capturedAt || !entry.documentRevision)) {
      throw new Error(t("This analysis cannot be saved."));
    }
    details.push("", t("Comparison sources"));
    for (const [index, entry] of sources.entries()) {
      details.push(`[${index + 1}] ${entry.title || entry.url}`, entry.url,
        `${t("Captured at")}: ${entry.capturedAt}`, `${t("Document revision")}: ${entry.documentRevision}`);
      if (entry.selectionOnly) details.push(t("Source text") + ": " + t("Selected text"));
      if (entry.selectionOnly && entry.selectionTruncated) details.push(t("Selected text was shortened"));
      if (!entry.selectionOnly && entry.textTruncated) details.push(t("Page content was shortened"));
    }
  }
  if (source.image) {
    details.push(`${t("Image source")}: ${source.image.url}`, `${t("Document version")}: ${source.documentRevision}`);
    if (source.frame) {
      details.push(`${t("Image frame source")}: ${source.frame.url || t("Inline frame")}`,
        `${t("Frame document version")}: ${source.frame.documentRevision}`);
    }
  }
  const readableTitle = `${label} · ${source.image?.alt || title || url}`.replace(/\p{Cc}/gu, " ").replace(/\s+/gu, " ").trim();
  if (analysis.selectionOnly) {
    details.push(`${t("Source text")}: ${t("Selected text")}`);
    if (capture.page.selectionTruncated) details.push(t("Selected text was shortened"));
  }
  if (source.textTruncated) details.push(t("Page content was shortened"));
  if (analysis.translation) {
    details.push(`${t("Document revision")}: ${source.documentRevision}`,
      ...browserTranslationDetails(analysis.translation).map(([label, value]) => `${t(label)}: ${value}`));
  }
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
        ...(analysis.translation && { translation: analysis.translation }),
        ...(analysis.selectionOnly && { selectionOnly: true, selectionTruncated: Boolean(capture.page.selectionTruncated) }),
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
