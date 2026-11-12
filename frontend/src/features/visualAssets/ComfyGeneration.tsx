import { useEffect, useMemo, useState } from "react";
import { t } from "../../shared/i18n";
import { ComfyOutputs, useComfyOutputReview } from "./ComfyOutputReview";
import type { ArchivedOutput } from "./ComfyOutputReview";
import { useAnimationReview } from "./useAnimationReview";
import type { CharacterRequest } from "./useCharacterRecords";

interface Selection {
  characterId: string;
  recipeId: string;
  version: number;
}
type Props = Selection & { disabled: boolean; request: CharacterRequest };

interface Plan {
  port: number;
  budget: Budget;
  inputs: {
    settings: {
      checkpoint: string;
      width: number;
      height: number;
      steps: number;
      cfg: number;
      seed: string;
      denoise: number;
    };
    references: { assetId: number; revision: number; name: string; sha256: string }[];
    positive: string;
    negative: string;
  };
}

const states = {
  submitting: "Preparing generation.",
  unknown: "Submission status is unknown. Check status before starting again.",
  submitted: "Generation submitted.",
  queued: "Generation queued.",
  running: "Generating images.",
  rejected: "ComfyUI rejected the request.",
  upload_failed: "Could not upload the reference images.",
  ready: "ComfyUI saved the generated images.",
  failed: "ComfyUI reported a generation error.",
  no_output: "ComfyUI returned no matching image output.",
} as const;

type Attempt = {
  id: string;
  port: number;
  promptId?: string | null;
  providerFee?: number;
  executionUsage?: { startedAtMs: number; finishedAtMs: number } | null;
  state: keyof typeof states;
  interruptedBeforeSubmit?: boolean;
  outputs: { filename: string; subfolder: string }[];
  archived: ArchivedOutput[];
};
type Budget = { providerFeeLimit: number };
const pending = new Set(["submitting", "unknown", "submitted", "queued", "running"]);
const completed = new Set(["ready", "no_output", "failed"]);

function readPlan(response: unknown) {
  const result = response as { token?: string; plan?: Plan };
  if (typeof result.token !== "string" || !result.plan) throw new Error("Invalid ComfyUI plan");
  return { token: result.token, details: result.plan };
}

export function ComfyGeneration(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <section className="ui-card" aria-label={t("Local ComfyUI generation")}>
      <button
        type="button"
        className="ui-button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {t("Local ComfyUI generation")}
      </button>
      {open && <GenerationControls {...props} />}
    </section>
  );
}

function GenerationControls({ characterId, recipeId, version, disabled, request }: Props) {
  const selection = useMemo(
    () => ({ characterId, recipeId, version }),
    [characterId, recipeId, version],
  );
  const [port, setPort] = useState("8188");
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [statusError, setStatusError] = useState(false);
  const [reload, setReload] = useState(0);
  const outputReview = useComfyOutputReview(request, (archived) => {
    setAttempts((entries) =>
      (entries ?? []).map((entry) =>
        entry.outputs.some((output) => output.filename === archived.filename)
          ? { ...entry, archived: [...(entry.archived ?? []), archived] }
          : entry,
      ),
    );
  });
  const review = useAnimationReview(
    {
      confirm: async (token) => {
        const { attempt } = (await request({ kind: "confirm", token })) as { attempt: Attempt };
        setAttempts((entries) => [
          attempt,
          ...(entries ?? []).filter((entry) => entry.id !== attempt.id),
        ]);
      },
      cancel: (token) => request({ kind: "cancel", token }),
    },
    readPlan,
    "Could not prepare generation. Check the local ComfyUI port and the saved checkpoint setting.",
    "Could not confirm generation. Review the saved plan again.",
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload refetches the saved attempts.
  useEffect(() => {
    let current = true;
    setStatusError(false);
    void request({ kind: "list", selection }).then(
      (result) => {
        if (current) setAttempts((result as { attempts: Attempt[] }).attempts);
      },
      () => {
        if (current) setStatusError(true);
      },
    );
    return () => {
      current = false;
    };
  }, [request, selection, reload]);

  async function refresh(id: string) {
    setChecking(true);
    setStatusError(false);
    try {
      const { attempt } = (await request({ kind: "refresh", id })) as { attempt: Attempt };
      setAttempts((entries) => (entries ?? []).map((entry) => (entry.id === id ? attempt : entry)));
    } catch {
      setStatusError(true);
    } finally {
      setChecking(false);
    }
  }

  const active = attempts?.some((entry) => pending.has(entry.state));
  const validPort = Number.isInteger(Number(port)) && Number(port) >= 1 && Number(port) <= 65535;
  return (
    <>
      {review.review ? (
        <div className="ui-card">
          <PlanDetails plan={review.review} />
          <div className="ui-toolbar">
            <button
              type="button"
              className="ui-button ui-button--primary"
              disabled={disabled || review.busy}
              onClick={() => void review.finish(true)}
            >
              {t("Confirm local generation")}
            </button>
            <button type="button" className="ui-button" onClick={() => void review.finish(false)}>
              {t("Cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="ui-toolbar">
          <label>
            {t("Local ComfyUI port")}
            <input
              className="ui-input"
              type="number"
              min={1}
              max={65535}
              value={port}
              disabled={disabled || review.busy}
              onChange={(event) => setPort(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="ui-button"
            disabled={disabled || review.busy || !validPort || active || !attempts}
            onClick={() =>
              void review.plan(() => request({ kind: "plan", selection, port: Number(port) }))
            }
          >
            {t("Review local generation")}
          </button>
        </div>
      )}
      {review.busy && <p role="status">{t("Checking the generation request…")}</p>}
      {review.error && <p role="alert">{review.error}</p>}
      {outputReview.busy && <p role="status">{t("Checking generated image…")}</p>}
      {outputReview.error && <p role="alert">{outputReview.error}</p>}
      {statusError && (
        <button type="button" className="ui-button" onClick={() => setReload((value) => value + 1)}>
          {t("Reload generation attempts")}
        </button>
      )}
      {attempts?.map((attempt) => (
        <div className="ui-card" key={attempt.id}>
          <p>
            {t(
              attempt.interruptedBeforeSubmit
                ? "Generation stopped before submission. Review the plan to try again."
                : states[attempt.state],
            )}{" "}
            · 127.0.0.1:{attempt.port}
          </p>
          {attempt.providerFee !== undefined && (
            <p>
              {t("Provider charge through Studio")} · {attempt.providerFee}
            </p>
          )}
          {completed.has(attempt.state) && (
            <p>
              {t("ComfyUI execution time")} ·{" "}
              {attempt.executionUsage
                ? `${(attempt.executionUsage.finishedAtMs - attempt.executionUsage.startedAtMs).toLocaleString()} ms`
                : t("Unavailable")}
            </p>
          )}
          {(pending.has(attempt.state) ||
            (completed.has(attempt.state) && attempt.promptId && !attempt.executionUsage)) && (
            <button
              type="button"
              className="ui-button"
              disabled={checking || review.busy}
              onClick={() => void refresh(attempt.id)}
            >
              {t(completed.has(attempt.state) ? "Check execution time" : "Check generation status")}
            </button>
          )}
          {attempt.outputs.length > 0 && (
            <ComfyOutputs
              attemptId={attempt.id}
              files={attempt.outputs}
              archived={attempt.archived ?? []}
              control={outputReview}
              disabled={disabled || review.busy}
            />
          )}
        </div>
      ))}
    </>
  );
}

function PlanDetails({ plan }: { plan: Plan }) {
  const { settings, references, positive, negative } = plan.inputs;
  return (
    <>
      <p>
        {t("Generation destination")} · 127.0.0.1:{plan.port}
      </p>
      {plan.budget && (
        <p>
          {t("Local provider fee limit")} · {plan.budget.providerFeeLimit}
        </p>
      )}
      <p>
        {t("Local electricity cost")} · {t("Unavailable")}
      </p>
      <p className="visual-assets-backup-path">
        {t("Checkpoint")} · {settings.checkpoint}
      </p>
      <p>
        {settings.width} × {settings.height} · {t("Steps")} {settings.steps} · {t("Seed")}{" "}
        {settings.seed} · CFG {settings.cfg} · {t("Denoise")} {settings.denoise}
      </p>
      {references.length > 0 && (
        <>
          <p>{t("Reference images to upload")}</p>
          <ul>
            {references.map((item) => (
              <li key={`${item.assetId}:${item.revision}`} className="visual-assets-backup-path">
                {item.name} · {t("Revision")} {item.revision} · <code>{item.sha256}</code>
              </li>
            ))}
          </ul>
        </>
      )}
      <details>
        <summary>{t("Generation prompt")}</summary>
        <p>{positive}</p>
        {negative && (
          <p>
            {t("Negative prompt")} · {negative}
          </p>
        )}
      </details>
    </>
  );
}
