import { useRef, useState } from "react";
import type { Root } from "react-dom/client";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { t } from "../../shared/i18n";
import { downscaleImage } from "./ocrLogic";
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
  const busy = store((state) => state.busy);
  const error = store((state) => state.error);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const pickFiles = (files: FileList | null) => {
    const file = files && files[0];
    if (!file || !file.type.startsWith("image/")) return;
    downscaleImage(file)
      .then((dataUrl) => store.getState().setImage(dataUrl, file.name))
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
            <button
              type="button"
              className="ui-button ui-button--ghost ui-button--sm"
              onClick={() => void store.getState().copy()}
            >
              {t("Copy")}
            </button>
          ) : null}
        </div>
        {result ? (
          <>
            <pre className="ocr-result-text">{result.text}</pre>
            <p className="ocr-result-meta">
              {result.charCount} {t("characters")}
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
