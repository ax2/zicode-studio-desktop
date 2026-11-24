import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { ArtifactGateway } from "../plugins/artifact-gateway.js";
import { browserAnalysisArtifact, createBrowserAnalysisArtifacts } from "./browser-analysis-artifact.js";
import fixture from "../../../tests/fixtures/browser-analysis-artifact.json";

const capture = { page: { url: "https://example.org/synthetic?view=analysis", title: "Synthetic page · 中文" },
  capturedAt: "2026-11-18T06:00:00Z", documentRevision: "doc-synthetic-1" };
const analysis = { kind: "summary", text: "合成摘要\n<script>inert</script>", generatedAt: "2026-11-18T06:01:00Z",
  model: { provider: "fixture", modelId: "synthetic-model" } };
afterEach(() => { setLocale("zh-CN"); vi.restoreAllMocks(); });

function writer() {
  setLocale("en");
  let target = { sceneId: "programming", workspaceId: "11111111-1111-4111-8111-111111111111" };
  let current = true;
  const gateway = { create: vi.fn(async () => ({ artifact: { id: "22222222-2222-4222-8222-222222222222" } })) };
  const artifacts = createBrowserAnalysisArtifacts({ capture, getTarget: () => target, isCurrent: () => current, gateway });
  return { artifacts, gateway, change() { target = { ...target, workspaceId: "other" }; }, close() { current = false; } };
}

it("produces the same sourced synthetic payload exercised by the real Host restart test", () => {
  setLocale("en");
  expect(browserAnalysisArtifact(capture, analysis)).toEqual(fixture);
  expect(fixture.mimeType).toBe("text/plain"); // Reopened model/website text remains inert.
});

it("does nothing until explicit save and reuses a successfully saved result", async () => {
  const f = writer();
  expect(f.gateway.create).not.toHaveBeenCalled();
  const saved = await f.artifacts.save(analysis);
  expect(await f.artifacts.save(analysis)).toEqual(saved);
  expect(f.gateway.create).toHaveBeenCalledOnce();
  expect(f.gateway.create).toHaveBeenCalledWith("programming", "11111111-1111-4111-8111-111111111111", fixture);
});

it("opens only the saved artifact in its original current scope", async () => {
  const f = writer(), listener = vi.fn();
  window.addEventListener("zicode:open-artifact", listener);
  try {
    const saved = await f.artifacts.save(analysis);
    f.artifacts.open(saved);
    expect(listener.mock.calls[0][0].detail).toEqual({ artifactId: saved.id, sceneId: "programming", workspaceId: "11111111-1111-4111-8111-111111111111" });
    f.change();
    expect(() => f.artifacts.open(saved)).toThrow("destination changed");
    await expect(f.artifacts.save(analysis)).rejects.toThrow("destination changed");
    expect(listener).toHaveBeenCalledOnce();
  } finally { window.removeEventListener("zicode:open-artifact", listener); }
});

it("allows retry after storage failure without changing the reviewed content", async () => {
  const f = writer();
  f.gateway.create.mockRejectedValueOnce(Error("Storage unavailable"));
  await expect(f.artifacts.save(analysis)).rejects.toThrow("Storage unavailable");
  await f.artifacts.save(analysis);
  expect(f.gateway.create).toHaveBeenCalledTimes(2);
  expect(f.gateway.create.mock.calls[0]).toEqual(f.gateway.create.mock.calls[1]);
});

it("guards simultaneous saves and rejects a closed preview before writing", async () => {
  const f = writer(); let finish;
  f.gateway.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = f.artifacts.save(analysis);
  await expect(f.artifacts.save(analysis)).rejects.toThrow("Saving");
  finish({ artifact: { id: "saved" } }); await first;
  f.close();
  await expect(f.artifacts.save({ ...analysis })).rejects.toThrow("destination changed");
  expect(f.gateway.create).toHaveBeenCalledOnce();
});

it("rejects credentialed/non-web sources and empty analysis without calling storage", () => {
  setLocale("en");
  for (const url of ["file:///C:/private.txt", "https://name:secret@example.org/"]) {
    expect(() => browserAnalysisArtifact({ ...capture, page: { ...capture.page, url } }, analysis)).toThrow("cannot be saved");
  }
  expect(() => browserAnalysisArtifact(capture, { ...analysis, text: " " })).toThrow("cannot be saved");
});

it("sends the exact contract through the existing ArtifactGateway rather than introducing a save endpoint", async () => {
  setLocale("en");
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ artifact: { id: "saved" } }) }));
  const gateway = new ArtifactGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
  const writer = createBrowserAnalysisArtifacts({ capture, isCurrent: () => true,
    getTarget: () => ({ sceneId: "programming", workspaceId: "11111111-1111-4111-8111-111111111111" }), gateway });
  await writer.save(analysis);
  expect(fetchImpl.mock.calls[0][0].pathname).toBe("/v2/artifacts/create");
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ sceneId: "programming", workspaceId: "11111111-1111-4111-8111-111111111111", ...fixture, summary: "" });
});

it("preserves image capture time and inline-frame provenance in the reopened plain text", () => {
  setLocale("en");
  const image = { pageUrl: capture.page.url, documentRevision: capture.documentRevision,
    capturedAt: "2026-11-18T06:00:30Z", source: { url: "https://assets.example.org/example.png", alt: "Fixture drawing" },
    frame: { url: null, title: "Inline fixture", documentRevision: "inline-v1" } };
  const draft = browserAnalysisArtifact(capture, { ...analysis, kind: "image", image });
  expect(draft.title).toBe("Image analysis · Fixture drawing");
  expect(draft.mimeType).toBe("text/plain");
  expect(draft.provenance.source).toEqual({ ...capture.page, documentRevision: capture.documentRevision,
    capturedAt: image.capturedAt, image: image.source, frame: image.frame });
  expect(draft.content).toContain("Image frame source: Inline frame");
  expect(draft.content).toContain("Frame document version: inline-v1");
  expect(draft.content).toContain("Captured at: 2026-11-18T06:00:30Z");
  expect(draft.content).toContain("<script>inert</script>");
});

it("rejects images outside the captured document or an allowed frame", () => {
  setLocale("en");
  const image = { pageUrl: capture.page.url, documentRevision: capture.documentRevision,
    capturedAt: capture.capturedAt, source: { url: "https://assets.example.org/example.png", alt: "Fixture drawing" } };
  for (const stale of [{ pageUrl: "https://example.org/changed" }, { documentRevision: "stale" },
    { source: { url: "https://name:secret@example.org/picture.png" } },
    { frame: { url: "https://other.example.org/frame", documentRevision: "frame-v1" } }]) {
    expect(() => browserAnalysisArtifact(capture, { ...analysis, kind: "image", image: { ...image, ...stale } }))
      .toThrow("This analysis cannot be saved.");
  }
});

it("fits real Host title limits without splitting emoji and retains the complete original title as provenance", () => {
  setLocale("en");
  const title = `Synthetic\n${"😀".repeat(220)}`;
  const draft = browserAnalysisArtifact({ ...capture, page: { ...capture.page, title } }, analysis);
  expect([...draft.title]).toHaveLength(200);
  expect(draft.title).not.toContain("\n");
  expect(draft.title.endsWith("😀")).toBe(true);
  expect(draft.provenance.source.title).toBe(title);
});

it("keeps the target language, shortened selection and original document with the saved translation", async () => {
  const f = writer();
  const translation = { language: "en", scope: "selection", truncated: true };
  await f.artifacts.save({ ...analysis, kind: "translation", translation, text: "Translated passage." });
  const draft = f.gateway.create.mock.calls[0][2];
  expect(draft.title).toBe(`Page translation · ${capture.page.title}`);
  expect(draft.provenance).toMatchObject({ source: { ...capture.page, documentRevision: capture.documentRevision },
    analysis: { kind: "translation", translation } });
  expect(draft.content).toContain("Target language: English");
  expect(draft.content).toContain("Source text: Selected text");
  expect(draft.content).toContain("Capture: Partial capture");
  expect(draft.content).toContain("Document revision: doc-synthetic-1");
  expect(draft.content).toContain("Translated passage.");
});

it("keeps the selected-text scope and truncation with a saved answer", () => {
  setLocale("en");
  const draft = browserAnalysisArtifact({ ...capture, page: { ...capture.page, selectionTruncated: true } },
    { ...analysis, selectionOnly: true });
  expect(draft.provenance.analysis).toMatchObject({ selectionOnly: true, selectionTruncated: true });
  expect(draft.content).toContain("Source text: Selected text");
  expect(draft.content).toContain("Selected text was shortened");
});
