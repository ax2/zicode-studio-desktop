import { useState } from "react";
import { t } from "../../shared/i18n";

function analyze(image: HTMLImageElement): string[] {
  if (!image.complete || !image.naturalWidth) throw Error();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw Error();
  ctx.drawImage(image, 0, 0, 32, 32);
  const { data } = ctx.getImageData(0, 0, 32, 32);
  let luminance = 0;
  let weight = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    luminance += alpha * (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    weight += alpha;
  }
  const ratio = image.naturalWidth / image.naturalHeight;
  const labels = [ratio > 1 ? "Landscape" : ratio < 1 ? "Portrait" : "Square"];
  if (weight) {
    const mean = luminance / weight;
    labels.push(mean > 170 ? "Light tones" : mean < 85 ? "Dark tones" : "Mid tones");
  }
  return labels;
}

export function PreviewLabels({ saved, available, disabled, onSave }: {
  saved: string[]; available: boolean; disabled: boolean; onSave: (labels: string[]) => Promise<void>;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(labels: string[]) {
    setBusy(true);
    setError("");
    try {
      await onSave(labels);
      setSuggestions([]);
    } catch {
      setError(t("Could not update preview labels. Refresh and try again."));
    } finally { setBusy(false); }
  }
  return <details>
    <summary>{t("Local preview labels")}{saved.length > 0 && " · " + saved.map(label => t(label)).join(", ")}</summary>
    <p>{t("Analyze this thumbnail on this device to suggest orientation and brightness labels.")}</p>
    <button type="button" className="ui-button ui-button--sm" disabled={disabled || busy || !available}
      onClick={event => {
        setError("");
        try {
          const img = event.currentTarget.closest("figure")?.querySelector("img");
          if (!img) throw Error();
          setSuggestions(analyze(img));
        } catch { setError(t("Preview unavailable")); }
      }}>{t("Analyze thumbnail")}</button>
    {suggestions.length > 0 && <div className="ui-toolbar">
      <span>{suggestions.map(label => t(label)).join(", ")}</span>
      <button type="button" className="ui-button ui-button--sm" disabled={disabled || busy} onClick={() => void save(suggestions)}>{t("Save suggested labels")}</button>
      <button type="button" className="ui-button ui-button--sm" disabled={busy} onClick={() => setSuggestions([])}>{t("Cancel")}</button>
    </div>}
    {saved.length > 0 && <button type="button" className="ui-button ui-button--sm" disabled={disabled || busy} onClick={() => void save([])}>{t("Remove preview labels")}</button>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
