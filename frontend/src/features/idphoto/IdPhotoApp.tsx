import { useEffect, useMemo, useRef, useState } from "react";
import type { Root } from "react-dom/client";
import { FirstRunGuide } from "../../shared/FirstRunGuide";
import { t } from "../../shared/i18n";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { Select } from "../../shared/Select";
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

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function defaultCrop(aspect: number): CropRect {
  // Centered: 84% width, height derived from the aspect, capped at 90% height.
  const w = 0.84;
  let h = w / aspect;
  if (h > 0.9) {
    h = 0.9;
    const w2 = h * aspect;
    return { x: (1 - w2) / 2, y: (1 - h) / 2, w: w2, h };
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

function CropBox({
  src,
  aspect,
  value,
  onChange,
}: {
  src: string;
  aspect: number;
  value: CropRect | null;
  onChange(crop: CropRect): void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const drag = useRef<{
    mode: "move" | "se" | "nw";
    startX: number;
    startY: number;
    start: CropRect;
  } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () =>
      setContainerSize({ w: container.clientWidth, h: container.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const displayed = useMemo(() => {
    if (!natural || containerSize.w === 0 || containerSize.h === 0) return null;
    const scale = Math.min(containerSize.w / natural.w, containerSize.h / natural.h);
    const w = natural.w * scale;
    const h = natural.h * scale;
    return { x: (containerSize.w - w) / 2, y: (containerSize.h - h) / 2, w, h };
  }, [natural, containerSize]);

  const crop = value ?? defaultCrop(aspect);

  const boxFromCrop = (rect: CropRect) => {
    if (!displayed) return { x: 0, y: 0, w: 0, h: 0 };
    return {
      x: displayed.x + rect.x * displayed.w,
      y: displayed.y + rect.y * displayed.h,
      w: rect.w * displayed.w,
      h: rect.h * displayed.h,
    };
  };

  const onPointerDown = (mode: "move" | "se" | "nw") => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    drag.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      start: crop,
    };
    const move = (moveEvent: PointerEvent) => {
      const session = drag.current;
      if (!session || !displayed) return;
      const dx = (moveEvent.clientX - session.startX) / displayed.w;
      const dy = (moveEvent.clientY - session.startY) / displayed.h;
      let next: CropRect;
      if (session.mode === "move") {
        next = {
          x: clamp01(session.start.x + dx),
          y: clamp01(session.start.y + dy),
          w: session.start.w,
          h: session.start.h,
        };
        // Keep the rectangle inside the photo.
        next.x = Math.min(next.x, 1 - next.w);
        next.y = Math.min(next.y, 1 - next.h);
      } else if (session.mode === "se") {
        const w = clamp01(session.start.w + dx);
        const h = w / aspect;
        const x = Math.min(session.start.x, 1 - w);
        const y = Math.min(session.start.y, 1 - h);
        next = { x, y, w, h };
      } else {
        const w = clamp01(session.start.w - dx);
        const h = w / aspect;
        const x = Math.min(1 - w, session.start.x + (session.start.w - w));
        const y = Math.min(1 - h, session.start.y + (session.start.h - h));
        next = { x: Math.max(0, x), y: Math.max(0, y), w, h };
      }
      onChange(next);
    };
    const up = () => {
      drag.current = null;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  const box = boxFromCrop(crop);
  const handleSize = 16;

  return (
    <div
      ref={containerRef}
      className="idphoto-crop"
      style={{ aspectRatio: natural ? `${natural.w} / ${natural.h}` : "3 / 4" }}
    >
      <img
        className="idphoto-crop-image"
        src={src}
        alt=""
        onLoad={(event) => {
          const img = event.currentTarget;
          setNatural({ w: img.naturalWidth, h: img.naturalHeight });
        }}
      />
      {displayed ? (
        <>
          <div className="idphoto-crop-shade" />
          <div
            className="idphoto-crop-box"
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            onPointerDown={onPointerDown("move")}
            role="presentation"
          >
            <span
              className="idphoto-crop-handle idphoto-crop-handle--nw"
              style={{ width: handleSize, height: handleSize }}
              onPointerDown={onPointerDown("nw")}
            />
            <span
              className="idphoto-crop-handle idphoto-crop-handle--se"
              style={{ width: handleSize, height: handleSize }}
              onPointerDown={onPointerDown("se")}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

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
  const mixed = store((state) => state.mixed);
  const slots = store((state) => state.slots);
  const crop = store((state) => state.crop);
  const setMixed = store((state) => state.setMixed);
  const setCrop = store((state) => state.setCrop);
  const addSlot = store((state) => state.addSlot);
  const removeSlot = store((state) => state.removeSlot);
  const updateSlot = store((state) => state.updateSlot);
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
              "Choose a template and print sheet, optionally replace the background, then generate a ready-to-print sheet. Download the PNG or open it in a new tab.",
            )}
          </p>
        </div>
        <button
          type="button"
          className="ui-button ui-button--ghost ui-button--sm"
          onClick={() => store.getState().resetAll()}
        >
          {t("Reset")}
        </button>
      </header>

      <FirstRunGuide
        storageKey="idphoto"
        title={t("Make a printable ID photo sheet")}
        steps={[
          t("Add a portrait photo."),
          t("Choose a template and print sheet."),
          t("Generate, then download or open the printable PNG."),
        ]}
        ctaLabel={t("Add a photo")}
        onCta={() => fileRef.current?.click()}
      />

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
              {mixed ? (
                <img src={photo} alt={photoName || t("Source photo")} />
              ) : (
                <div className="idphoto-crop-wrap">
                  <CropBox
                    src={photo}
                    aspect={(template?.widthMm ?? 25) / (template?.heightMm ?? 35)}
                    value={crop}
                    onChange={setCrop}
                  />
                  <p className="idphoto-crop-hint">
                    {t("Drag to move, drag the corners to resize")}
                  </p>
                  <button
                    type="button"
                    className="ui-button ui-button--ghost ui-button--sm"
                    onClick={() => setCrop(null)}
                  >
                    {t("Reset crop")}
                  </button>
                </div>
              )}
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
          <div className="settings-field">
            <span>{t("Mixed layout")}</span>
            <label className="idphoto-grid-auto">
              <input
                type="checkbox"
                checked={mixed}
                onChange={(event) => setMixed(event.target.checked)}
              />
              {t("Mixed layout")}
            </label>
          </div>
          {mixed ? (
            <div className="idphoto-slots">
              {slots.map((slot, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: slots are positional and manipulated by index
                <div key={index} className="idphoto-slot">
                  <Select
                    id={`idphoto-slot-template-${index}`}
                    value={slot.template}
                    label={t("Template")}
                    className="idphoto-slot-template"
                    options={IDPHOTO_TEMPLATES.map((candidate) => ({
                      value: candidate.id,
                      label: t(candidate.name),
                    }))}
                    onChange={(value) =>
                      updateSlot(index, value, slot.count)
                    }
                  />
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={slot.count}
                    aria-label={t("Count")}
                    onChange={(event) =>
                      updateSlot(index, slot.template, Number(event.target.value) || 1)
                    }
                  />
                  <button
                    type="button"
                    className="ui-button ui-button--ghost ui-button--sm"
                    aria-label={t("Remove")}
                    onClick={() => removeSlot(index)}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="ui-button ui-button--secondary ui-button--sm"
                onClick={addSlot}
              >
                {t("Add template")}
              </button>
            </div>
          ) : (
            <div className="settings-field">
              <span>{t("Template")}</span>
              <Select
                id="idphoto-template"
                value={templateId}
                label={t("Template")}
                options={IDPHOTO_TEMPLATES.map((candidate) => ({
                  value: candidate.id,
                  label: `${t(candidate.name)} · ${candidate.widthMm}×${candidate.heightMm}mm`,
                }))}
                onChange={(value) => store.getState().setTemplate(value)}
              />
            </div>
          )}
          <div className="settings-field">
            <span>{t("Print sheet")}</span>
            <Select
              id="idphoto-sheet"
              value={sheetId}
              label={t("Print sheet")}
              options={IDPHOTO_SHEETS.map((candidate) => ({
                value: candidate.id,
                label: `${t(candidate.name)} · ${candidate.widthMm}×${candidate.heightMm}mm`,
              }))}
              onChange={(value) => store.getState().setSheet(value)}
            />
          </div>
          <div className="settings-field">
            <span>{t("Background")}</span>
            <Select
              id="idphoto-background"
              value={background}
              label={t("Background")}
              options={IDPHOTO_BACKGROUNDS.map((candidate) => ({
                value: candidate.id,
                label: t(candidate.name),
              }))}
              onChange={(value) => store.getState().setBackground(value)}
            />
          </div>
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
          {!mixed ? (
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
          ) : null}
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
            {mixed ? (
              <span className="settings-help">
                {slots
                  .map((slot) => `${t(templateById(slot.template)?.name ?? slot.template)}×${slot.count}`)
                  .join(" + ")}
                {sheet ? ` → ${t(sheet.name)}` : ""}
              </span>
            ) : template && sheet ? (
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
                {result.mixed && result.slots?.length ? (
                  <strong>
                    {result.slots
                      .map(
                        (slot) =>
                          `${t(templateById(slot.template)?.name ?? slot.template)}×${slot.count}`,
                      )
                      .join(" + ")}{" "}
                    ·{" "}
                    {t("Total {count} photos").replace("{count}", String(result.count))}
                  </strong>
                ) : (
                  <strong>{formatResultSize(result)}</strong>
                )}
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
                <a
                  className="ui-button ui-button--ghost ui-button--sm"
                  href={result.url}
                  download={result.fileName}
                >
                  {t("Download")}
                </a>
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
