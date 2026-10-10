import { type ComponentType, useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { ModelToolPicker } from "../../shared/ModelToolPicker";
import { Select } from "../../shared/Select";
import { stripMarkdown } from "./notesLogic";
import type { NotesStore } from "./notesStore";
import type { CapturePreview } from "./web-capture";

export function CaptureForm({
  store,
  TagEditor,
}: {
  store: NotesStore;
  TagEditor: ComponentType<{ store: NotesStore; tags: string[]; onChange(tags: string[]): void }>;
}) {
  const summaryModel = store((state) => state.summaryModel);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [notebookId, setNotebookId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CapturePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [copiedPreview, setCopiedPreview] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const snapshot = store((state) => state.snapshot);
  const selectedNotebookId = store((state) => state.selectedNotebookId);
  const capturing = store((state) => state.capturing);
  const summarizing = store((state) => state.summarizing);
  const summary = store((state) => state.summary);
  const urlRef = useRef<HTMLInputElement | null>(null);
  const revision = useRef(0);
  const alive = useRef(true);
  const copyTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  useEffect(() => {
    alive.current = true;
    urlRef.current?.focus();
    return () => {
      alive.current = false;
      revision.current += 1;
      for (const timer of copyTimers.current) clearTimeout(timer);
      store.getState().invalidateCaptureView();
    };
  }, [store]);
  const current = (request: number) => alive.current && request === revision.current;
  const resetSource = (value: string) => {
    revision.current += 1;
    store.getState().invalidateCaptureView();
    setUrl(value);
    setPreview(null);
    setPreviewing(false);
    setError(null);
    setCopiedPreview(false);
    setCopiedSummary(false);
    setPreviewExpanded(false);
  };
  const destinationChanged = () => store.getState().invalidateCaptureView(false);
  const copy = async (value: string, summaryCopy: boolean) => {
    const request = revision.current;
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(value);
      if (!current(request)) return;
      const update = summaryCopy ? setCopiedSummary : setCopiedPreview;
      update(true);
      copyTimers.current.push(
        setTimeout(() => {
          if (current(request)) update(false);
        }, 1600),
      );
    } catch {
      if (current(request)) setError(t("Could not copy text. Select and copy it manually."));
    }
  };
  const previewUrl = async () => {
    const request = ++revision.current;
    store.getState().invalidateCaptureView();
    setPreview(null);
    setCopiedPreview(false);
    setCopiedSummary(false);
    setError(null);
    setPreviewing(true);
    try {
      const result = await store.getState().capturePreviewUrl(url);
      if (current(request)) setPreview(result);
    } catch (previewError) {
      if (!current(request)) return;
      setError(previewError instanceof Error ? previewError.message : String(previewError));
      setPreview(null);
    } finally {
      if (current(request)) setPreviewing(false);
    }
  };
  return (
    <section className="notes-state-panel ui-card">
      <h1>{t("Capture web page")}</h1>
      <p>
        {t(
          "ZiCode retrieves readable public content without sending cookies or authorization headers.",
        )}
      </p>
      <form
        className="notes-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const request = revision.current;
          setError(null);
          try {
            await store.getState().captureUrl({
              url,
              title,
              notebookId: notebookId || selectedNotebookId || snapshot.notebooks[0]?.id || "",
              tags,
            });
          } catch (captureError) {
            if (!current(request)) return;
            setError(captureError instanceof Error ? captureError.message : String(captureError));
          }
        }}
      >
        <label>
          <span>{t("Page URL")}</span>
          <input
            ref={urlRef}
            className="notes-field-input"
            type="url"
            required
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://example.com/article"
            value={url}
            onChange={(event) => resetSource(event.target.value)}
          />
        </label>
        <label>
          <span>{t("Title override (optional)")}</span>
          <input
            className="notes-field-input"
            value={title}
            onChange={(event) => {
              destinationChanged();
              setTitle(event.target.value);
            }}
          />
        </label>
        <TagEditor
          store={store}
          tags={tags}
          onChange={(value) => {
            destinationChanged();
            setTags(value);
          }}
        />
        <div className="notes-form-field">
          <span>{t("Notebook")}</span>
          <Select
            id="notes-capture-notebook"
            value={notebookId || selectedNotebookId || ""}
            label={t("Notebook")}
            options={snapshot.notebooks.map((candidate) => ({
              value: candidate.id,
              label: candidate.title,
            }))}
            onChange={(value) => {
              destinationChanged();
              setNotebookId(value);
            }}
          />
        </div>
        {preview ? (
          <section className="notes-capture-preview" aria-label={t("Capture preview")}>
            <h2>{t("Extracted content")}</h2>
            {preview.duplicate ? (
              <p className="notes-capture-preview-note" role="status">
                {t("This page is already in your notes")}
              </p>
            ) : null}
            <strong>{preview.title}</strong>
            {[preview.siteName, preview.author].filter(Boolean).length > 0 ? (
              <p className="notes-capture-preview-meta">
                {[preview.siteName, preview.author].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            <p className="notes-capture-preview-stats">
              {t("About {count} readable characters").replace(
                "{count}",
                stripMarkdown(preview.markdown).replace(/\s+/g, "").length.toLocaleString(),
              )}
            </p>
            {previewExpanded ? (
              <pre className="notes-capture-preview-full">{stripMarkdown(preview.markdown)}</pre>
            ) : (
              <p className="notes-capture-preview-excerpt">
                {stripMarkdown(preview.markdown).slice(0, 320)}
              </p>
            )}
            <button
              type="button"
              className="ui-button ui-button--ghost ui-button--sm notes-capture-expand"
              onClick={() => setPreviewExpanded((expanded) => !expanded)}
            >
              {previewExpanded ? t("Collapse") : t("Show full content")}
            </button>
            <button
              type="button"
              className="ui-button ui-button--ghost ui-button--sm notes-capture-copy"
              onClick={() => void copy(preview.markdown, false)}
            >
              {copiedPreview ? t("Copied") : t("Copy Markdown")}
            </button>
            {summary ? (
              <section className="notes-capture-summary" aria-label={t("Pi summary")}>
                <h3>{t("Pi summary")}</h3>
                <pre>{summary}</pre>
                <button
                  type="button"
                  className="ui-button ui-button--ghost ui-button--sm"
                  onClick={() => void copy(summary, true)}
                >
                  {copiedSummary ? t("Copied") : t("Copy summary")}
                </button>
                <button
                  type="button"
                  className="ui-button ui-button--ghost ui-button--sm"
                  onClick={() => store.getState().clearSummary()}
                >
                  {t("Dismiss")}
                </button>
              </section>
            ) : (
              <>
                <ModelToolPicker
                  sceneId={store.getState().getSceneId()}
                  value={summaryModel}
                  onChange={store.getState().setSummaryModel}
                  load={store.getState().loadSummaryModels}
                  disabled={summarizing}
                />
                <button
                  type="button"
                  className="ui-button ui-button--secondary ui-button--sm notes-capture-summarize"
                  disabled={summarizing}
                  aria-busy={summarizing}
                  onClick={() => {
                    const request = revision.current;
                    setCopiedSummary(false);
                    setError(null);
                    void store
                      .getState()
                      .summarizeText(stripMarkdown(preview.markdown), preview.title)
                      .catch(
                        (summarizeError) =>
                          current(request) &&
                          setError(
                            summarizeError instanceof Error
                              ? summarizeError.message
                              : String(summarizeError),
                          ),
                      );
                  }}
                >
                  {summarizing ? t("Summarizing…") : t("Summarize with selected model")}
                </button>
              </>
            )}
          </section>
        ) : null}
        {error ? <p className="notes-form-error">{error}</p> : null}
        <div className="notes-form-actions">
          <button
            type="button"
            className="ui-button ui-button--secondary"
            onClick={() => store.getState().setMode("library")}
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            className="ui-button ui-button--secondary"
            disabled={previewing || !url.trim()}
            aria-busy={previewing}
            onClick={() => void previewUrl()}
          >
            {previewing ? t("Fetching preview…") : t("Preview")}
          </button>
          <button
            type="submit"
            className="ui-button ui-button--primary"
            disabled={capturing}
            aria-busy={capturing}
          >
            {capturing ? t("Capturing…") : t("Capture")}
          </button>
        </div>
      </form>
    </section>
  );
}
