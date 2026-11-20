import { t } from "../../shared/i18n";
import { GenerationSummary } from "./GenerationFields";
import type { OutfitPlan } from "./outfit-types";
import { StyleSummary } from "./StyleFields";

export function CreationReview({
  plan,
  isStyle,
  busy,
  onSubmit,
  onCancel,
}: {
  plan: OutfitPlan;
  isStyle: boolean;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const generation = plan.input.generation;
  return (
    <section
      className="ui-card"
      aria-label={t(
        generation
          ? "Confirm image generation"
          : isStyle
            ? "Confirm style generation"
            : "Confirm outfit generation",
      )}
    >
      <p className="visual-assets-backup-path">
        {plan.settings.model} · {plan.settings.baseUrl}
      </p>
      <p>
        {t("Images to upload")} ·{" "}
        {plan.references.length
          ? plan.references.map((reference) => reference.name).join(" · ")
          : t("No reference image will be uploaded.")}
      </p>
      {generation ? (
        <GenerationSummary value={generation} />
      ) : (
        <p>
          {t("Image size")} · {plan.settings.size} · {t("Image quality")} · {plan.settings.quality}
        </p>
      )}
      <p>
        {t(
          generation
            ? "One image. The request may take up to 180 seconds. Provider charges are not estimated."
            : "One PNG image. The request may take up to 180 seconds. Provider charges are not estimated.",
        )}
      </p>
      {plan.input.style && <StyleSummary value={plan.input.style} />}
      <details>
        <summary>{t("Full image prompt")}</summary>
        <pre className="visual-assets-prompt">{plan.prompt}</pre>
      </details>
      <button
        type="button"
        className="ui-button ui-button--primary"
        disabled={busy}
        onClick={onSubmit}
      >
        {t(
          generation
            ? generation.mode === "text"
              ? "Confirm and generate image"
              : "Confirm upload and generate image"
            : isStyle
              ? "Confirm upload and generate styled image"
              : "Confirm upload and generate outfit",
        )}
      </button>
      <button type="button" className="ui-button" disabled={busy} onClick={onCancel}>
        {t("Cancel")}
      </button>
    </section>
  );
}
