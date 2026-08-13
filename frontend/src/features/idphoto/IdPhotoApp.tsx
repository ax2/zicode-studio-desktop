import { useEffect, useRef, useState } from "react";
import type { Root } from "react-dom/client";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { t } from "../../shared/i18n";
import {
  downscaleImage,
  formatResultSize,
  IDPHOTO_BACKGROUNDS,
  IDPHOTO_SHEETS,
  IDPHOTO_TEMPLATES,
  templateById,
} from "./idphotoLogic";
import {
  createIdPhotoStore,
  type IdPhotoOptions,
  type IdPhotoState,
  type IdPhotoStore,
} from "./idphotoStore";

export type IdPhotoAppApi = {
  renderNavigation(container: HTMLElement): void;
  renderContent(container: HTMLElement): void;
  deactivate(): void;
  destroy(): void;
  handlesCommand(commandId: string): boolean;
  executeCommand(): void;
  refresh(): Promise<void>;
};

function IdPhotoNav({ store }: { store: IdPhotoStore }) {
  const templateId = store((state) => state.templateId);
  const setTemplate = store((state) => state.setTemplate);
  return (
    <nav className="idphoto-nav" aria-label={t("ID photo templates")}>
      <strong className="idphoto-nav-title">{t("Templates")}</strong>
      {IDPHOTO_TEMPLATES.map((template) => (
        <button
          key={template.id}
          type="button"
          className={`idphoto-nav-item${templateId === template.id ? " active" : ""}`}
          aria-pressed={templateId === template.id}
          onClick={() => setTemplate(template.id)}
        >
          <span>{t(template.name)}</span>
          <small>
            {template.widthMm}×{template.heightMm}mm
          </small>
        </button>
      ))}
    </nav>
  );
}

function IdPhotoMain({ store }: { store: IdPhotoStore }) {
  const photo = store((state) => state.photo);
  const photoName = store((state) => state.photoName);
  const templateId = store((state) => state.templateId);
  const sheetId = store((state) => state.sheetId);
  const background = store((state) => state.background);
  const tolerance = store((state) => state.tolerance);
  const borderPx = store((state) => state.borderPx);
  const autoGrid = store((state) => state.autoGrid);
  const cols = store((state) => state.cols);
  const rows = store((state) => state.rows);
  const busy = store((state) => state.busy);
  const error = store((state) => state.error);
  const result = store((state) => state.result);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const template = templateById(templateId);
  const sheet = IDPHOTO_SHEETS.find((candidate) => candidate.id === sheetId);

  const pickFile = (file: File | null | undefined) => {
    if (!file) return;
    void downscaleImage(file)
      .then((dataUrl) => store.getState().setPhoto(dataUrl, file.name))
      .catch((error: unknown) => {
        store.setState({ error: error instanceof Error ? error.message : String(error) });
      });
  };

  const printResult = () => {
    if (!result?.url) return;
    const target = globalThis.open(result.url, "_blank", "noopener");
    if (target) target.focus();
  };

  return (
    <div className="idphoto-main">
      <header className="idphoto-header">
        <div>
          <h1>{t("ID Photo Layout")}</h1>
          <p>
            {t(
              "Choose a template and print sheet, optionally replace the background, then generate a ready-to-print sheet.",
            )}
          </p>
        </div>
      </header>

      <div className="idphoto-workspace">
        <section className="ui-card idphoto-source">
          <h2>{t("Source photo")}</h2>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => pickFile(event.target.files?.[0])}
          />
          {photo ? (
            <div className="idphoto-source-preview">
              <img src={photo} alt={photoName || t("Source photo")} />
              <div className="idphoto-source-actions">
                <span className="idphoto-source-name" title={photoName}>
                  {photoName || t("Pasted photo")}
                </span>
                <button
                  type="button"
                  className="ui-button ui-button--secondary ui-button--sm"
                  onClick={() => fileRef.current?.click()}
                >
                  {t("Replace")}
                </button>
                <button
                  type="button"
                  className="ui-button ui-button--ghost ui-button--sm"
                  onClick={() => store.getState().reset()}
                >
                  {t("Remove")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`idphoto-dropzone${dragging ? " is-dragging" : ""}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                pickFile(event.dataTransfer.files?.[0]);
              }}
            >
              <strong>{t("Choose or drop a photo")}</strong>
              <span>{t("JPG / PNG / WEBP; long edge is downsized to 2048px")}</span>
            </button>
          )}
        </section>

        <section className="ui-card idphoto-options">
          <h2>{t("Options")}</h2>
          <label className="settings-field">
            <span>{t("Template")}</span>
            <select
              value={templateId}
              onChange={(event) => store.getState().setTemplate(event.target.value)}
            >
              {IDPHOTO_TEMPLATES.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {t(candidate.name)} · {candidate.widthMm}×{candidate.heightMm}mm
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span>{t("Print sheet")}</span>
            <select
              value={sheetId}
              onChange={(event) => store.getState().setSheet(event.target.value)}
            >
              {IDPHOTO_SHEETS.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {t(candidate.name)} · {candidate.widthMm}×{candidate.heightMm}mm
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span>{t("Background")}</span>
            <select
              value={background}
              onChange={(event) => store.getState().setBackground(event.target.value)}
            >
              {IDPHOTO_BACKGROUNDS.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {t(candidate.name)}
                </option>
              ))}
            </select>
          </label>
          {background !== "keep" ? (
            <label className="settings-field">
              <span>
                {t("Background tolerance")}: {tolerance}
              </span>
              <input
                type="range"
                min={0}
                max={120}
                value={tolerance}
                onChange={(event) =>
                  store.getState().setTolerance(Number(event.target.value))
                }
              />
            </label>
          ) : null}
          <label className="settings-field">
            <span>
              {t("Photo border")}: {borderPx}px
            </span>
            <input
              type="range"
              min={0}
              max={8}
              value={borderPx}
              onChange={(event) =>
                store.getState().setBorderPx(Number(event.target.value))
              }
            />
          </label>
          <div className="settings-field">
            <span>{t("Grid")}</span>
            <label className="idphoto-grid-auto">
              <input
                type="checkbox"
                checked={autoGrid}
                onChange={(event) =>
                  store.getState().setGrid(cols || 3, rows || 3, event.target.checked)
                }
              />
              {t("Auto fit sheet")}
            </label>
            {!autoGrid ? (
              <div className="idphoto-grid-manual">
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={cols || 1}
                  aria-label={t("Columns")}
                  onChange={(event) =>
                    store.getState().setGrid(
                      Math.max(1, Number(event.target.value) || 1),
                      rows || 1,
                      false,
                    )
                  }
                />
                <span>×</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={rows || 1}
                  aria-label={t("Rows")}
                  onChange={(event) =>
                    store.getState().setGrid(
                      cols || 1,
                      Math.max(1, Number(event.target.value) || 1),
                      false,
                    )
                  }
                />
              </div>
            ) : null}
          </div>
          <div className="idphoto-generate-row">
            <button
              type="button"
              className="ui-button ui-button--primary"
              disabled={busy || !photo}
              aria-busy={busy}
              onClick={() => void store.getState().layout()}
            >
              {busy ? t("Generating…") : t("Generate layout")}
            </button>
            {template && sheet ? (
              <span className="settings-help">
                {t("Template")} {t(template.name)} → {t(sheet.name)}
              </span>
            ) : null}
          </div>
          {error ? (
            <p className="idphoto-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>

        <section className="ui-card idphoto-result">
          <h2>{t("Result")}</h2>
          {result?.url ? (
            <>
              <div className="idphoto-result-meta">
                <strong>{formatResultSize(result)}</strong>
                <span>
                  {result.widthPx}×{result.heightPx}px @300DPI
                </span>
              </div>
              <img
                className="idphoto-result-image"
                src={result.url}
                alt={t("ID photo layout result")}
              />
              <div className="idphoto-result-actions">
                <button
                  type="button"
                  className="ui-button ui-button--primary ui-button--sm"
                  onClick={printResult}
                >
                  {t("Open / Print")}
                </button>
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
              {t("Generate a layout to preview the printable sheet here.")}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

export function createIdPhotoApp(options: IdPhotoOptions): IdPhotoAppApi {
  const store = createIdPhotoStore(options);
  let navRoot: Root | null = null;
  let contentRoot: Root | null = null;
  return {
    renderNavigation(container) {
      navRoot = mountPluginSurface(container, <IdPhotoNav store={store} />, navRoot);
    },
    renderContent(container) {
      contentRoot = mountPluginSurface(container, <IdPhotoMain store={store} />, contentRoot);
    },
    deactivate() {
      // No polling; nothing to clean up.
    },
    destroy() {
      navRoot?.unmount();
      contentRoot?.unmount();
      navRoot = null;
      contentRoot = null;
    },
    handlesCommand(commandId) {
      return commandId === "idphoto.open";
    },
    executeCommand() {
      options.getTarget();
      // The plugin shell handles opening the view for commands.
    },
    refresh() {
      return Promise.resolve();
    },
  };
}

export type IdPhotoStateType = IdPhotoState;
