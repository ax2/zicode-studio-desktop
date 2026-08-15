import { useRef, useState } from "react";
import type { Root } from "react-dom/client";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { t } from "../../shared/i18n";
import {
  downscaleImage,
  FIT_MODES,
  FLIPS,
  formatBytes,
  OUTPUT_FORMATS,
  ROTATIONS,
} from "./imagetoolsLogic";
import {
  createImageToolsStore,
  type ImageToolsOptions,
  type ImageToolsState,
  type ImageToolsStore,
} from "./imagetoolsStore";

export type ImageToolsAppApi = {
  renderNavigation(container: HTMLElement): void;
  renderContent(container: HTMLElement): void;
  deactivate(): void;
  destroy(): void;
  handlesCommand(commandId: string): boolean;
  executeCommand(): void;
  refresh(): Promise<void>;
};

function ImageToolsNav({ store }: { store: ImageToolsStore }) {
  const mode = store((state) => state.mode);
  const setMode = store((state) => state.setMode);
  return (
    <nav className="imagetools-nav" aria-label={t("Image tools")}>
      <button
        type="button"
        className={`imagetools-nav-item${mode === "process" ? " active" : ""}`}
        onClick={() => setMode("process")}
      >
        {t("Single image")}
      </button>
      <button
        type="button"
        className={`imagetools-nav-item${mode === "concat" ? " active" : ""}`}
        onClick={() => setMode("concat")}
      >
        {t("Concat grid")}
      </button>
    </nav>
  );
}

function ImageToolsMain({ store }: { store: ImageToolsStore }) {
  const mode = store((state) => state.mode);
  const images = store((state) => state.images);
  const names = store((state) => state.names);
  const resizeEnabled = store((state) => state.resizeEnabled);
  const width = store((state) => state.width);
  const height = store((state) => state.height);
  const fit = store((state) => state.fit);
  const format = store((state) => state.format);
  const quality = store((state) => state.quality);
  const rotate = store((state) => state.rotate);
  const flip = store((state) => state.flip);
  const columns = store((state) => state.columns);
  const gap = store((state) => state.gap);
  const busy = store((state) => state.busy);
  const error = store((state) => state.error);
  const result = store((state) => state.result);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const pickFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const entries = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (entries.length === 0) {
      store.setState({ error: t("Only image files are supported") });
      return;
    }
    Promise.all(entries.map((file) => downscaleImage(file)))
      .then((dataUrls) =>
        store.getState().addImages(dataUrls, entries.map((file) => file.name)),
      )
      .catch((error: unknown) => {
        store.setState({ error: error instanceof Error ? error.message : String(error) });
      });
  };

  const setOption = (patch: Partial<ImageToolsState>) => store.getState().setOption(patch);

  return (
    <div className="imagetools-main">
      <header className="imagetools-header">
        <h1>{t("Image Tools")}</h1>
        <p>{t("Resize, convert, rotate, flip or arrange images into a grid.")}</p>
      </header>

      <div className="imagetools-workspace">
        <section className="ui-card imagetools-source">
          <div className="imagetools-source-header">
            <h2>{mode === "concat" ? t("Images") : t("Image")}</h2>
            {images.length > 0 ? (
              <button
                type="button"
                className="ui-button ui-button--ghost ui-button--sm"
                onClick={() => store.getState().clearImages()}
              >
                {t("Clear images")}
              </button>
            ) : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            multiple={mode === "concat"}
            onChange={(event) => pickFiles(event.target.files)}
          />
          <button
            type="button"
            className={`imagetools-dropzone${dragging ? " is-dragging" : ""}`}
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
            <strong>
              {mode === "concat"
                ? t("Choose or drop images")
                : t("Choose or drop an image")}
            </strong>
            <span>{t("JPG / PNG / WEBP")}</span>
          </button>
          {images.length > 0 ? (
            <div className="imagetools-thumbs">
              {images.map((src, index) => (
                <div key={index} className="imagetools-thumb">
                  <img src={src} alt={names[index] || ""} />
                  {mode === "concat" ? (
                    <button
                      type="button"
                      className="imagetools-thumb-remove"
                      aria-label={t("Remove")}
                      onClick={() => store.getState().removeImage(index)}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="ui-card imagetools-options">
          <h2>{t("Options")}</h2>
          {mode === "process" ? (
            <>
              <div className="settings-field">
                <label className="idphoto-grid-auto">
                  <input
                    type="checkbox"
                    checked={resizeEnabled}
                    onChange={(event) => setOption({ resizeEnabled: event.target.checked })}
                  />
                  {t("Resize")}
                </label>
              </div>
              {resizeEnabled ? (
                <div className="imagetools-resize-row">
                  <input
                    type="number"
                    min={1}
                    max={20000}
                    placeholder={t("Width")}
                    value={width || ""}
                    aria-label={t("Width")}
                    onChange={(event) => setOption({ width: Number(event.target.value) || 0 })}
                  />
                  <span>×</span>
                  <input
                    type="number"
                    min={1}
                    max={20000}
                    placeholder={t("Height")}
                    value={height || ""}
                    aria-label={t("Height")}
                    onChange={(event) => setOption({ height: Number(event.target.value) || 0 })}
                  />
                  <select
                    value={fit}
                    onChange={(event) => setOption({ fit: event.target.value })}
                  >
                    {FIT_MODES.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <label className="settings-field">
                <span>{t("Format")}</span>
                <select
                  value={format}
                  onChange={(event) => setOption({ format: event.target.value })}
                >
                  {OUTPUT_FORMATS.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </label>
              {format !== "png" ? (
                <label className="settings-field">
                  <span>
                    {t("Quality")}: {quality}
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={quality}
                    onChange={(event) => setOption({ quality: Number(event.target.value) })}
                  />
                </label>
              ) : null}
              <label className="settings-field">
                <span>{t("Rotate")}</span>
                <select
                  value={String(rotate)}
                  onChange={(event) => setOption({ rotate: Number(event.target.value) })}
                >
                  {ROTATIONS.map((degrees) => (
                    <option key={degrees} value={degrees}>
                      {degrees === 0 ? "0°" : `${degrees}°`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-field">
                <span>{t("Flip")}</span>
                <select
                  value={flip}
                  onChange={(event) => setOption({ flip: event.target.value })}
                >
                  {FLIPS.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {t(candidate.name)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <label className="settings-field">
                <span>{t("Columns")}</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={columns}
                  onChange={(event) =>
                    setOption({ columns: Math.max(1, Number(event.target.value) || 1) })
                  }
                />
              </label>
              <label className="settings-field">
                <span>{t("Gap")}: {gap}px</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={gap}
                  onChange={(event) => setOption({ gap: Number(event.target.value) })}
                />
              </label>
            </>
          )}
          <div className="idphoto-generate-row">
            <button
              type="button"
              className="ui-button ui-button--primary"
              disabled={busy || images.length === 0}
              aria-busy={busy}
              onClick={() => void store.getState().run()}
            >
              {busy ? t("Processing…") : t("Process")}
            </button>
          </div>
          {error ? (
            <p className="idphoto-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>

        <section className="ui-card imagetools-result">
          <h2>{t("Result")}</h2>
          {result?.url ? (
            <>
              <div className="imagetools-result-meta">
                <strong>
                  {result.width}×{result.height} · {result.format?.toUpperCase()} ·{" "}
                  {formatBytes(result.bytes)}
                </strong>
              </div>
              <img className="imagetools-result-image" src={result.url} alt="" />
              <div className="idphoto-result-actions">
                <a
                  className="ui-button ui-button--ghost ui-button--sm"
                  href={result.url}
                  download={result.fileName}
                >
                  {t("Download")}
                </a>
                <a
                  className="ui-button ui-button--secondary ui-button--sm"
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Open in new tab")}
                </a>
              </div>
            </>
          ) : (
            <p className="idphoto-result-empty">
              {t("Run a process to preview the result here.")}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

export function createImageToolsApp(options: ImageToolsOptions): ImageToolsAppApi {
  const store = createImageToolsStore(options);
  let navRoot: Root | null = null;
  let contentRoot: Root | null = null;
  return {
    renderNavigation(container) {
      navRoot = mountPluginSurface(container, <ImageToolsNav store={store} />, navRoot);
    },
    renderContent(container) {
      contentRoot = mountPluginSurface(container, <ImageToolsMain store={store} />, contentRoot);
    },
    deactivate() {},
    destroy() {
      navRoot?.unmount();
      contentRoot?.unmount();
      navRoot = null;
      contentRoot = null;
    },
    handlesCommand(commandId) {
      return commandId === "imagetools.open";
    },
    executeCommand() {},
    refresh() {
      return Promise.resolve();
    },
  };
}

export type ImageToolsStateType = ImageToolsState;
