import { t } from "../../shared/i18n";
import type { AnimationIntent } from "./AnimationPanel";
import { type AnimationReviewActions, useAnimationReview } from "./useAnimationReview";

interface RetryDetails {
  destination: string;
  intent: AnimationIntent;
}

function readRetry(response: unknown) {
  const result = response as { token?: string; cancelled?: boolean; retry?: RetryDetails };
  if (result.cancelled) return undefined;
  const retry = result.retry;
  if (
    typeof result.token !== "string" ||
    typeof retry?.destination !== "string" ||
    !["atlas", "sequence"].includes(retry.intent?.source?.kind) ||
    !Array.isArray(retry.intent?.recipe?.frames)
  ) {
    throw new Error("Invalid animation retry plan");
  }
  return { token: result.token, details: retry };
}

export function AnimationRetry({
  disabled,
  actions,
}: {
  disabled: boolean;
  actions: AnimationReviewActions & { plan: () => Promise<unknown> };
}) {
  const { review, busy, error, plan, finish } = useAnimationReview(
    actions,
    readRetry,
    "Could not review the retry. Select the original folder and refresh the animation status if it has changed.",
    "The animation retry could not start. Refresh its status and review it again.",
  );

  return (
    <>
      {review ? (
        <div className="ui-card">
          <p className="visual-assets-backup-path">
            {t("Animation folder")} {review.destination.replace(/^\\\\\?\\/, "")}
          </p>
          <p>
            {t(review.intent.format === "pngSequence" ? "PNG frame sequence" : "Godot project")}
          </p>
          <SavedRecipe intent={review.intent} />
          <div className="ui-toolbar">
            <button
              type="button"
              className="ui-button ui-button--primary"
              disabled={disabled || busy}
              onClick={() => void finish(true)}
            >
              {t("Retry animation")}
            </button>
            <button type="button" className="ui-button" onClick={() => void finish(false)}>
              {t("Cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="ui-button"
          disabled={disabled || busy}
          onClick={() => void plan(actions.plan)}
        >
          {t("Choose original folder and review retry")}
        </button>
      )}
      {busy && <p role="status">{t("Preparing animation retry...")}</p>}
      {error && <p role="alert">{error}</p>}
    </>
  );
}

function SavedRecipe({ intent: { source, recipe } }: { intent: AnimationIntent }) {
  const atlas = source.kind === "atlas";
  return (
    <>
      <p>
        {t(atlas ? "Sprite atlas" : "Image sequence")} ·{" "}
        {t(recipe.looped ? "Loop animation" : "Play once")}
      </p>
      <details>
        <summary>
          {t("Saved frame settings")} ({recipe.frames.length})
        </summary>
        {atlas && (
          <p>
            {t("Asset ID")} {source.assetId} · {t("Revision")} {source.revision}
          </p>
        )}
        <ol>
          {recipe.frames.map((frame, index) => (
            // Frame position identifies each item in this immutable recipe.
            // biome-ignore lint/suspicious/noArrayIndexKey: a saved recipe cannot be reordered.
            <li key={index}>
              {atlas
                ? `${t("Left (px)")} ${frame.x} · ${t("Top (px)")} ${frame.y} · ${t("Width (px)")} ${frame.width} · ${t("Height (px)")} ${frame.height}`
                : `${t("Asset ID")} ${frame.assetId} · ${t("Revision")} ${frame.revision}`}
              {` · ${t("Duration (ms)")} ${frame.durationMs} · ${t("Anchor X")} ${frame.anchorX} · ${t("Anchor Y")} ${frame.anchorY}`}
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
