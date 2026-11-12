import { type ReactNode, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { AnimationInstall, type AnimationInstallActions } from "./AnimationInstall";
import { AnimationPlayback } from "./AnimationPlayback";

export interface AnimationAsset {
  id: number;
  name: string;
}

type AnimationSource = { kind: "sequence" } | { kind: "atlas"; assetId: number; revision: number };
type AnimationExportFormat = "godot" | "pngSequence";

export interface AnimationIntent {
  libraryId: string;
  source: AnimationSource;
  recipe: { looped: boolean; frames: Record<string, number>[] };
  format?: AnimationExportFormat;
}

const timingFields = [
  ["durationMs", "Duration (ms)", 1, 60_000],
  ["anchorX", "Anchor X", 0, 2048],
  ["anchorY", "Anchor Y", 0, 2048],
] as const;
const cropFields = [
  ["x", "Left (px)", 0, 4095],
  ["y", "Top (px)", 0, 4095],
  ["width", "Width (px)", 1, 2048],
  ["height", "Height (px)", 1, 2048],
] as const;
type Field = (typeof timingFields | typeof cropFields)[number][0];

interface Draft {
  key: number;
  asset?: AnimationAsset;
  values: Record<Field, string>;
}

export function AnimationPanel({
  libraryId,
  assets,
  disabled,
  onExport,
  onPreview,
  install,
  status,
}: {
  libraryId: string;
  assets: AnimationAsset[];
  disabled: boolean;
  onExport: (intent: AnimationIntent) => void;
  onPreview: (intent: AnimationIntent) => Promise<unknown>;
  install?: AnimationInstallActions;
  status?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AnimationSource["kind"]>("sequence");
  const [selected, setSelected] = useState<AnimationAsset>();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [looped, setLooped] = useState(true);
  const [format, setFormat] = useState<AnimationExportFormat>("godot");
  const nextKey = useRef(0);
  const atlas = mode === "atlas";
  const fields = atlas ? [...cropFields, ...timingFields] : timingFields;
  const selectedOnPage = assets.some((asset) => asset.id === selected?.id);
  const valid = drafts.every((draft) =>
    fields.every(([field, , min, max]) => {
      const value = Number(draft.values[field]);
      return draft.values[field] !== "" && Number.isInteger(value) && value >= min && value <= max;
    }),
  );

  function move(index: number, direction: -1 | 1) {
    setDrafts((current) => {
      const next = [...current];
      const other = index + direction;
      [next[index], next[other]] = [next[other], next[index]];
      return next;
    });
  }

  function addFrame() {
    if (!selected) return;
    const draft: Draft = {
      key: nextKey.current++,
      asset: atlas ? undefined : selected,
      values: {
        x: "0",
        y: "0",
        width: "1",
        height: "1",
        durationMs: "100",
        anchorX: "0",
        anchorY: "0",
      },
    };
    setDrafts((current) => [...current, draft]);
  }

  function buildIntent(): AnimationIntent | null {
    if (!valid || !drafts.length || (atlas && !selected)) return null;
    const source: AnimationSource =
      atlas && selected
        ? { kind: "atlas", assetId: selected.id, revision: 1 }
        : { kind: "sequence" };
    const frames = drafts.map((draft) => {
      const values = Object.fromEntries(
        fields.map(([field]) => [field, Number(draft.values[field])]),
      );
      return draft.asset ? { ...values, assetId: draft.asset.id, revision: 1 } : values;
    });
    return { libraryId, source, recipe: { looped, frames } };
  }
  const intent = buildIntent();

  return (
    <section className="ui-panel" aria-label={t("Animation")}>
      <button
        type="button"
        className="ui-button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {t("Animation")}
      </button>
      {open && (
        <form
          className="visual-assets-animation"
          onSubmit={(event) => {
            event.preventDefault();
            if (!disabled && intent) {
              onExport(format === "pngSequence" ? { ...intent, format } : intent);
            }
          }}
        >
          <div className="ui-toolbar">
            <select
              className="ui-select"
              aria-label={t("Animation source")}
              value={mode}
              disabled={disabled}
              onChange={(event) => {
                setMode(event.target.value === "atlas" ? "atlas" : "sequence");
                setSelected(undefined);
                setDrafts([]);
              }}
            >
              <option value="sequence">{t("Image sequence")}</option>
              <option value="atlas">{t("Sprite atlas")}</option>
            </select>
            <select
              className="ui-select"
              aria-label={t(atlas ? "Atlas image" : "Frame image")}
              disabled={disabled}
              value={selectedOnPage || atlas ? (selected?.id ?? "") : ""}
              onChange={(event) =>
                setSelected(assets.find((asset) => asset.id === Number(event.target.value)))
              }
            >
              <option value="">{t("Select an image from this page")}</option>
              {atlas && selected && !selectedOnPage && (
                <option value={selected.id}>{selected.name}</option>
              )}
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ui-button"
              disabled={
                disabled || !selected || (!atlas && !selectedOnPage) || drafts.length >= 128
              }
              onClick={addFrame}
            >
              {t("Add frame")}
            </button>
            <label>
              <input
                type="checkbox"
                checked={looped}
                disabled={disabled}
                onChange={(event) => setLooped(event.target.checked)}
              />
              {t("Loop animation")}
            </label>
          </div>
          {atlas && (
            <p>
              {t(
                "Atlas coordinates start at the image’s top-left. Anchors start at each frame’s top-left.",
              )}
            </p>
          )}
          {drafts.map((draft, index) => (
            <fieldset
              key={draft.key}
              disabled={disabled}
              className="ui-card visual-assets-animation-frame"
            >
              <legend>
                {t("Frame")} {index + 1}
                {draft.asset && ` · ${draft.asset.name}`}
              </legend>
              <div className="ui-toolbar">
                {fields.map(([field, label, min, max]) => (
                  <label key={field}>
                    {t(label)}
                    <input
                      className="ui-input"
                      type="number"
                      required
                      min={min}
                      max={max}
                      value={draft.values[field]}
                      onChange={(event) => {
                        const value = event.target.value;
                        setDrafts((current) =>
                          current.map((item) =>
                            item.key === draft.key
                              ? { ...item, values: { ...item.values, [field]: value } }
                              : item,
                          ),
                        );
                      }}
                    />
                  </label>
                ))}
              </div>
              <div className="ui-toolbar">
                <button
                  type="button"
                  className="ui-button"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  {t("Move earlier")}
                </button>
                <button
                  type="button"
                  className="ui-button"
                  disabled={index === drafts.length - 1}
                  onClick={() => move(index, 1)}
                >
                  {t("Move later")}
                </button>
                <button
                  type="button"
                  className="ui-button"
                  onClick={() =>
                    setDrafts((current) => current.filter((item) => item.key !== draft.key))
                  }
                >
                  {t("Remove frame")}
                </button>
              </div>
            </fieldset>
          ))}
          <AnimationPlayback
            key={JSON.stringify(intent)}
            intent={intent}
            disabled={disabled}
            onPreview={onPreview}
          />
          <div className="ui-toolbar">
            <label>
              {t("Animation export format")}
              <select
                className="ui-select"
                value={format}
                disabled={disabled}
                onChange={(event) =>
                  setFormat(event.target.value === "pngSequence" ? "pngSequence" : "godot")
                }
              >
                <option value="godot">{t("Godot project")}</option>
                <option value="pngSequence">{t("PNG frame sequence")}</option>
              </select>
            </label>
            <button
              type="submit"
              className="ui-button ui-button--primary"
              disabled={disabled || !intent}
            >
              {t("Choose folder and export")}
            </button>
          </div>
          {install && <AnimationInstall intent={intent} disabled={disabled} actions={install} />}
        </form>
      )}
      {status}
    </section>
  );
}
