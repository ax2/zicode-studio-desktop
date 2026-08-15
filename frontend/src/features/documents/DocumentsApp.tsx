import { useEffect, useRef, useState } from "react";
import type { Root } from "react-dom/client";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { t } from "../../shared/i18n";
import { Select } from "../../shared/Select";
// @ts-expect-error plain JS module without type declarations (public/ui/markdown.js)
import { initCodeCopyDelegation, renderMarkdown } from "../../../../public/ui/markdown.js";
import { isSupportedDocument, readFileAsDataUrl } from "./documentsLogic";
import {
  createDocumentsStore,
  type DocumentsOptions,
  type DocumentsStore,
  type PreviewMode,
} from "./documentsStore";

export type DocumentsAppApi = {
  renderNavigation(container: HTMLElement): void;
  renderContent(container: HTMLElement): void;
  deactivate(): void;
  destroy(): void;
  handlesCommand(commandId: string): boolean;
  executeCommand(): void;
  refresh(): Promise<void>;
  setTarget(): Promise<void>;
};

function DocumentsNav() {
  return <nav className="documents-nav" aria-label={t("Documents")} />;
}

function DocumentsMain({ store }: { store: DocumentsStore }) {
  const fileName = store((state) => state.fileName);
  const busy = store((state) => state.busy);
  const saving = store((state) => state.saving);
  const error = store((state) => state.error);
  const result = store((state) => state.result);
  const preview = store((state) => state.preview);
  const notebooks = store((state) => state.notebooks);
  const selectedNotebookId = store((state) => state.selectedNotebookId);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (previewRef.current && result) initCodeCopyDelegation(previewRef.current);
  }, [result]);

  const pickFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!isSupportedDocument(file.name)) {
      store.setState({ error: t("Only PDF and DOCX files are supported") });
      return;
    }
    readFileAsDataUrl(file)
      .then((dataUrl) => store.getState().setFile(file.name, dataUrl))
      .catch((reason: unknown) => {
        store.setState({ error: reason instanceof Error ? reason.message : String(reason) });
      });
  };

  return (
    <div className="documents-main">
      <header className="documents-header">
        <h1>{t("Document Import")}</h1>
        <p>{t("Import PDF and DOCX files as readable Markdown.")}</p>
      </header>

      <section className="ui-card documents-source">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          hidden
          onChange={(event) => pickFiles(event.target.files)}
        />
        <button
          type="button"
          className={`documents-dropzone${dragging ? " is-dragging" : ""}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            pickFiles(event.dataTransfer.files);
          }}
        >
          <strong>{t("Choose or drop a PDF or DOCX")}</strong>
          <span>{t("PDF / DOCX")}</span>
        </button>
        {fileName ? (
          <div className="documents-file">
            <span className="documents-file-name">{fileName}</span>
            <button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void store.getState().run()}
            >
              {busy ? t("Importing…") : t("Import")}
            </button>
            <button
              type="button"
              className="ui-button ui-button--ghost ui-button--sm"
              disabled={busy}
              onClick={() => store.getState().clear()}
            >
              {t("Clear")}
            </button>
          </div>
        ) : null}
        {error ? (
          <p className="idphoto-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <section className="ui-card documents-result">
        <div className="documents-result-header">
          <h2>{t("Result")}</h2>
          {result ? (
            <div className="documents-view-toggle" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={preview === "rendered"}
                className={`ui-button ui-button--ghost ui-button--sm${preview === "rendered" ? " is-active" : ""}`}
                onClick={() => store.getState().setPreview("rendered")}
              >
                {t("Preview")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={preview === "source"}
                className={`ui-button ui-button--ghost ui-button--sm${preview === "source" ? " is-active" : ""}`}
                onClick={() => store.getState().setPreview("source")}
              >
                {t("Markdown source")}
              </button>
            </div>
          ) : null}
        </div>

        {result ? (
          <>
            <div className="documents-meta">
              <strong>
                {result.title} · {result.kind.toUpperCase()} · {result.charCount}{" "}
                {t("characters")}
              </strong>
            </div>
            {preview === "source" ? (
              <pre className="documents-markdown-source">{result.markdown}</pre>
            ) : (
              <article
                ref={previewRef}
                className="markdown-body documents-preview" // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown escapes HTML before returning the preview
                dangerouslySetInnerHTML={{ __html: renderMarkdown(result.markdown) }}
              />
            )}
            <div className="idphoto-result-actions">
              {notebooks.length > 0 ? (
                <div className="settings-field documents-notebook">
                  <span>{t("Save to notebook")}</span>
                  <Select
                    id="documents-notebook"
                    value={selectedNotebookId}
                    label={t("Save to notebook")}
                    className="documents-notebook-select"
                    options={notebooks.map((notebook) => ({
                      value: notebook.id,
                      label: notebook.title,
                    }))}
                    onChange={(value) => store.getState().setNotebook(value)}
                  />
                </div>
              ) : null}
              <button
                type="button"
                className="ui-button ui-button--ghost ui-button--sm"
                onClick={() => store.getState().download()}
              >
                {t("Download Markdown")}
              </button>
              <button
                type="button"
                className="ui-button ui-button--secondary ui-button--sm"
                onClick={() => void store.getState().copyMarkdown()}
              >
                {t("Copy Markdown")}
              </button>
              <button
                type="button"
                className="ui-button ui-button--primary ui-button--sm"
                disabled={saving}
                aria-busy={saving}
                onClick={() => void store.getState().save()}
              >
                {saving ? t("Saving…") : t("Save to notes")}
              </button>
            </div>
          </>
        ) : (
          <p className="idphoto-result-empty">
            {t("Import a document to preview its Markdown here.")}
          </p>
        )}
      </section>
    </div>
  );
}

export function createDocumentsApp(options: DocumentsOptions): DocumentsAppApi {
  const store = createDocumentsStore(options);
  let navRoot: Root | null = null;
  let contentRoot: Root | null = null;
  return {
    renderNavigation(container) {
      navRoot = mountPluginSurface(container, <DocumentsNav />, navRoot);
    },
    renderContent(container) {
      contentRoot = mountPluginSurface(container, <DocumentsMain store={store} />, contentRoot);
    },
    deactivate() {},
    destroy() {
      navRoot?.unmount();
      contentRoot?.unmount();
      navRoot = null;
      contentRoot = null;
    },
    handlesCommand(commandId) {
      return commandId === "documents.open";
    },
    executeCommand() {},
    refresh() {
      return Promise.resolve();
    },
    setTarget() {
      return store.getState().loadNotebooks();
    },
  };
}

export type { PreviewMode };
