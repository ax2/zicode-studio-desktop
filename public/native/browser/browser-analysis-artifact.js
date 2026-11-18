import { t } from "../../i18n.js";
import { openSavedArtifact } from "../features/artifact-navigation.js";

// Save the reviewed result, not a fresh page read or another model request.
export function browserAnalysisArtifact(capture, analysis) {
  const { url, title } = capture.page;
  const source = new URL(url);
  if (!/^https?:$/.test(source.protocol) || source.username || source.password ||
      !analysis?.text?.trim() || !["summary", "analysis"].includes(analysis.kind)) {
    throw new Error(t("This analysis cannot be saved."));
  }
  const label = t(analysis.kind === "summary" ? "Page summary" : "Page analysis");
  const readableTitle = `${label} · ${title || url}`.replace(/\p{Cc}/gu, " ").replace(/\s+/gu, " ").trim();
  return {
    pluginId: "com.zicode.artifacts", kind: "report",
    title: [...readableTitle].slice(0, 200).join(""),
    mimeType: "text/plain",
    content: `${label}
${title || url}
${url}
${t("Captured at")}: ${capture.capturedAt}
${t("Generated at")}: ${analysis.generatedAt}

${analysis.text}`,
    provenance: { producer: "browser.analysis", sourceTrust: "untrusted-web-content", contentTrust: "untrusted-model-output",
      source: { url, title, capturedAt: capture.capturedAt, documentRevision: capture.documentRevision },
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
