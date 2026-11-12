import { useState } from "react";
import { t } from "../../shared/i18n";
import type { AnimationIntent } from "./AnimationPanel";
import { type AnimationReviewActions, useAnimationReview } from "./useAnimationReview";

export interface AnimationInstallActions extends AnimationReviewActions {
  plan: (name: string, intent: AnimationIntent) => Promise<unknown>;
}

interface InstallPlan {
  token: string;
  plan: { destination: string; resourcePath: string; previous: string | null };
}

function readInstallPlan(response: unknown) {
  const result = response as Partial<InstallPlan> & { cancelled?: boolean };
  if (result.cancelled) return undefined;
  if (
    typeof result.token !== "string" ||
    !result.plan ||
    typeof result.plan.destination !== "string" ||
    typeof result.plan.resourcePath !== "string" ||
    (result.plan.previous !== null && typeof result.plan.previous !== "string")
  ) {
    throw new Error("Invalid Godot installation plan");
  }
  return { token: result.token, details: result.plan };
}

export function AnimationInstall({
  intent,
  disabled,
  actions,
}: {
  intent: AnimationIntent | null;
  disabled: boolean;
  actions: AnimationInstallActions;
}) {
  const [name, setName] = useState("");
  return (
    <section className="ui-panel" aria-label={t("Godot project installation")}>
      <div className="ui-toolbar">
        <label>
          {t("Animation name")}
          <input
            type="text"
            className="ui-input"
            value={name}
            maxLength={48}
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      </div>
      <p>{t("Use lowercase letters, digits and hyphens for the animation name.")}</p>
      <InstallReview
        key={JSON.stringify([intent, name])}
        name={name}
        intent={intent}
        disabled={disabled}
        actions={actions}
      />
    </section>
  );
}

function InstallReview({
  intent,
  name,
  disabled,
  actions,
}: {
  intent: AnimationIntent | null;
  name: string;
  disabled: boolean;
  actions: AnimationInstallActions;
}) {
  const { review, busy, error, plan, finish } = useAnimationReview(
    actions,
    readInstallPlan,
    "Could not review the update. Choose a Godot 4 project with an available animation name.",
    "The Godot animation was not submitted. Review the project again.",
  );
  const validName = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(name);

  return (
    <>
      {!review && (
        <button
          type="button"
          className="ui-button"
          disabled={disabled || busy || !intent || !validName}
          onClick={() => intent && validName && void plan(() => actions.plan(name, intent))}
        >
          {t("Choose Godot project and review")}
        </button>
      )}
      {review && (
        <div className="ui-card">
          <p>
            {t(
              review.previous
                ? "Update the managed animation. Its previous version will be kept."
                : "Create a managed animation in this project.",
            )}
          </p>
          <p className="visual-assets-backup-path">{review.destination.replace(/^\\\\\?\\/, "")}</p>
          <p className="visual-assets-backup-path">
            {t("Scene reference")} {review.resourcePath}
          </p>
          <div className="ui-toolbar">
            <button
              type="button"
              className="ui-button ui-button--primary"
              disabled={disabled || busy}
              onClick={() => void finish(true)}
            >
              {t(review.previous ? "Confirm animation update" : "Confirm animation installation")}
            </button>
            <button
              type="button"
              className="ui-button"
              disabled={busy}
              onClick={() => void finish(false)}
            >
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}
      {busy && <p role="status">{t("Preparing Godot project update...")}</p>}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
