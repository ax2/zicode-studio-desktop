import { useRef, useState } from "react";
import type { Root } from "react-dom/client";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { t } from "../../shared/i18n";
import { FirstRunGuide } from "../../shared/FirstRunGuide";
import { Select } from "../../shared/Select";
import { downscaleImage, OCR_LANGUAGES } from "./ocrLogic";
import { createOcrStore, type OcrOptions, type OcrStore } from "./ocrStore";

export type OcrAppApi = {
  renderNavigation(container: HTMLElement): void;
  renderContent(container: HTMLElement): void;
  deactivate(): void;
  destroy(): void;
  handlesCommand(commandId: string): boolean;
  executeCommand(): void;
  refresh(): Promise<void>;
};

function OcrNav() {
  return <nav className="ocr-nav" aria-label={t("OCR")} />;
}

function OcrMain({ store }: { store: OcrStore }) {
  const image = store((state) => state.image);
  const fileName = store((state) => state.fileName);
  const result = store((state) => state.result);
  const editedText = store((state) => state.editedText);
  const language = store((state) => state.language);
  const busy = store((state) => state.busy);
  const error = store((state) => state.error);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);

  const pickFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      store.setState({ error: t("Only image files are supported") });
      return;
    }
    downscaleImage(file)
      .then((dataUrl) => void store.getState().extractImage(dataUrl, file.name))
      .catch((reason: unknown) => {
        store.setState({ error: reason instanceof Error ? reason.message : String(reason) });
      });
  };

  return (
    <div className="ocr-main">
      <header className="ocr-header">
        <h1>{t("Text Extraction")}</h1>
        <p>{t("Extract text from screenshots and images using the system OCR engine.")}</p>
      </header>

      <FirstRunGuide
        storageKey="ocr"
        title={t("Extract text from images")}
        steps={[
          t("Choose or drop a screenshot or image."),
          t("Pick the recognition language if needed."),
          t("Copy, download, or send the extracted text to a note."),
        ]}
        ctaLabel={t("Choose an image")}
        onCta={() => fileRef.current?.click()}
      />

      <section className="ui-card ocr-source">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => pickFiles(event.target.files)}
        />
        <button
          type="button"
          className={`ocr-dropzone${dragging ? " is-dragging" : ""}`}
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
          <strong>{t("Choose or drop an image")}</strong>
          <span>{t("JPG / PNG / WEBP")}</span>
        </button>
        {image ? (
          <div className="ocr-preview-row">
            <img className="ocr-preview" src={image} alt={fileName} />
            <div className="ocr-preview-actions">
              <span className="ocr-file-name">{fileName}</span>
              <div className="settings-field">
                <span>{t("OCR language")}</span>
                <Select
                  id="ocr-language"
                  value={language}
                  label={t("OCR language")}
                  options={OCR_LANGUAGES.map((candidate) => ({
                    value: candidate.id,
                    label: t(candidate.name),
                  }))}
                  onChange={(value) => store.getState().setLanguage(value)}
                />
              </div>
              <button
                type="button"
                className="ui-button ui-button--primary ui-button--sm"
                disabled={busy}
                aria-busy={busy}
                onClick={() => void store.getState().run()}
              >
                {busy ? t("Extracting…") : t("Extract text")}
              </button>
              <button
                type="button"
                className="ui-button ui-button--ghost ui-button--sm"
                onClick={() => store.getState().clear()}
              >
                {t("Remove")}
              </button>
            </div>
          </div>
        ) : null}
        {error ? (
          <p className="idphoto-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <section className="ui-card ocr-result">
        <div className="ocr-result-header">
          <h2>{t("Result")}</h2>
          {result ? (
            <div className="ocr-result-actions">
              <button
                type="button"
                className="ui-button ui-button--secondary ui-button--sm"
                disabled={busy}
                onClick={() => void store.getState().sendToNote()}
              >
                {t("Send to note")}
              </button>
              <button
                type="button"
                className="ui-button ui-button--primary ui-button--sm"
                disabled={busy}
                onClick={() => void store.getState().discussInChat()}
              >
                {t("Add to chat")}
              </button>
              <button
                type="button"
                className="ui-button ui-button--ghost ui-button--sm"
                onClick={() => {
                  void store.getState().copy();
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? t("Copied") : t("Copy")}
              </button>
              <button
                type="button"
                className="ui-button ui-button--ghost ui-button--sm"
                onClick={() => store.getState().download()}
              >
                {t("Download")}
              </button>
            </div>
          ) : null}
        </div>
        {result ? (
          <>
            <textarea
              className="ocr-result-text"
              value={editedText}
              aria-label={t("Result")}
              onChange={(event) => store.getState().setEditedText(event.target.value)}
            />
            <p className="ocr-result-meta">
              {editedText.length} {t("characters")}
            </p>
          </>
        ) : (
          <p className="idphoto-result-empty">{t("No text extracted yet")}</p>
        )}
      </section>
    </div>
  );
}

export function createOcrApp(options: OcrOptions): OcrAppApi {
  const store = createOcrStore(options);
  let navRoot: Root | null = null;
  let contentRoot: Root | null = null;
  return {
    renderNavigation(container) {
      navRoot = mountPluginSurface(container, <OcrNav />, navRoot);
    },
    renderContent(container) {
      contentRoot = mountPluginSurface(container, <OcrMain store={store} />, contentRoot);
    },
    deactivate() {},
    destroy() {
      navRoot?.unmount();
      contentRoot?.unmount();
      navRoot = null;
      contentRoot = null;
    },
    handlesCommand(commandId) {
      return commandId === "ocr.open";
    },
    executeCommand() {},
    refresh() {
      return Promise.resolve();
    },
  };
}
