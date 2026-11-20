import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { GenerationSummary } from "./GenerationFields";
import { imageWorkflowLabel } from "./generation-types";
import { type LibraryRequest, OutfitImagePreview } from "./OutfitImagePicker";
import { type ImageUsage, OutfitUsage } from "./OutfitUsage";
import { type CreationRequest, type OutfitPlan, outfitError } from "./outfit-types";
import { StyleSummary } from "./StyleFields";

type Job = {
  id: string;
  state: "unknown" | "ready" | "rejected";
  plan: OutfitPlan;
  created: number;
  error?: string | null;
  usage?: ImageUsage;
};
type Status = { job: Job | null; active: boolean; archived: { assetId: number } | null };
const statusBusyDelays = [250, 500, 1000];
export function OutfitTask({
  id,
  request,
  library,
  libraryId,
}: {
  id: string;
  request: CreationRequest;
  library: LibraryRequest;
  libraryId: string;
}) {
  const [status, setStatus] = useState<Status>();
  const [preview, setPreview] = useState<{ base64: string; sha256: string }>();
  const [loadedDigest, setLoadedDigest] = useState("");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number>();
  const saving = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly re-reads the same job.
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setError("");
    async function read(attempt = 0) {
      let next: Status;
      try {
        next = (await request({ kind: "status", id })) as Status;
      } catch (reason) {
        if (!current) return;
        // Retry only the local status read while the generation worker holds the library lock.
        const delay = statusBusyDelays[attempt];
        if (String(reason) === "visual_assets_busy" && delay !== undefined) {
          timer = setTimeout(() => void read(attempt + 1), delay);
        } else {
          setError(t(outfitError(reason)));
        }
        return;
      }
      if (!current) return;
      setStatus(next);
      try {
        if (next.job?.state === "ready" && !next.archived) {
          const result = (await request({ kind: "preview", id })) as {
            mimeType: string;
            base64: string;
            sha256: string;
          };
          if (current && result.mimeType === "image/png" && result.base64.length <= 700_000)
            setPreview(result);
        }
        if (next.active && next.job?.state === "unknown")
          timer = setTimeout(() => void read(), 2500);
      } catch (reason) {
        if (current) setError(t(outfitError(reason)));
      }
    }
    void read();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [request, id, revision]);
  async function cancel() {
    setBusy(true);
    try {
      await request({ kind: "cancel", id });
      setRevision((value) => value + 1);
    } catch (reason) {
      setError(t(outfitError(reason)));
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (!preview || loadedDigest !== preview.sha256 || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const result = (await request({ kind: "approve", id, sha256: preview.sha256 })) as {
        assetId: number;
      };
      setSaved(result.assetId);
    } catch (reason) {
      setError(t(outfitError(reason)));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const archived = saved ?? status?.archived?.assetId;
  const plan = status?.job?.plan;
  const isStyle = plan?.workflow === "style";
  const isGeneration = !!plan?.input.generation;
  const taskTitle = isGeneration
    ? "Image generation task"
    : isStyle
      ? "Style generation task"
      : "Outfit generation task";
  const resultLabel = isGeneration
    ? "Generated image"
    : isStyle
      ? "Restyled image"
      : "Generated outfit";
  const sourceLabel = isStyle || isGeneration ? "Source image" : "Original person";
  return (
    <section className="ui-card" aria-label={t(taskTitle)}>
      <h4>{t(taskTitle)}</h4>
      <p className="visual-assets-backup-path">
        {t("Request ID")} · {id}
      </p>
      <button
        type="button"
        className="ui-button"
        disabled={busy}
        onClick={() => setRevision((value) => value + 1)}
      >
        {t("Refresh generation status")}
      </button>
      {!status && !error && <p role="status">{t("Loading…")}</p>}
      {status && !status.job && (
        <p role="status">
          {t("No saved image task was found. Check settings and review a new plan.")}
        </p>
      )}
      {status?.job?.state === "unknown" && (
        <p role="status">
          {t(
            status.active
              ? isGeneration
                ? "Generating image…"
                : isStyle
                  ? "Restyling image…"
                  : "Generating outfit…"
              : "The generation outcome is unknown. It will not be sent again automatically.",
          )}
        </p>
      )}
      {status?.job?.state === "rejected" && (
        <p role="status">
          {t(outfitError(status.job.error ?? "visual_assets_creation_provider_rejected"))}
        </p>
      )}
      {status?.active && (
        <>
          <button type="button" className="ui-button" disabled={busy} onClick={() => void cancel()}>
            {t("Cancel generation wait")}
          </button>
          <p>{t("Cancelling the wait does not prove the provider stopped or avoided charges.")}</p>
        </>
      )}
      {plan && (
        <>
          <p className="visual-assets-backup-path">
            {plan.settings.model} · {plan.settings.baseUrl}
          </p>
          <p>{plan.input.description}</p>
          {plan.input.style && <StyleSummary value={plan.input.style} />}
          {plan.input.generation && <GenerationSummary value={plan.input.generation} />}
          <OutfitUsage usage={status?.job?.usage} />
        </>
      )}
      {plan && status?.job?.state === "ready" && (
        <div className="visual-assets-workflows">
          {plan.input.person != null && (
            <figure className="ui-card">
              <figcaption>{t(sourceLabel)}</figcaption>
              <OutfitImagePreview
                request={library}
                libraryId={libraryId}
                assetId={plan.input.person}
                label={t(sourceLabel)}
              />
            </figure>
          )}
          <figure className="ui-card">
            <figcaption>{t(resultLabel)}</figcaption>
            {archived ? (
              <OutfitImagePreview
                request={library}
                libraryId={libraryId}
                assetId={archived}
                label={t(resultLabel)}
              />
            ) : (
              preview && (
                <img
                  key={preview.sha256}
                  alt={t(resultLabel)}
                  src={`data:image/png;base64,${preview.base64}`}
                  onLoad={() => setLoadedDigest(preview.sha256)}
                  onError={() => {
                    setPreview(undefined);
                    setLoadedDigest("");
                    setError(t("Preview unavailable"));
                  }}
                />
              )
            )}
          </figure>
        </div>
      )}
      {archived ? (
        <p role="status">
          {t(
            isGeneration
              ? "Generated image saved to the library."
              : isStyle
                ? "Styled image saved to the library. Your original image is unchanged."
                : "Outfit result saved to the library. Your original image is unchanged.",
          )}
        </p>
      ) : (
        preview && (
          <button
            type="button"
            className="ui-button ui-button--primary"
            disabled={busy || loadedDigest !== preview.sha256}
            onClick={() => void approve()}
          >
            {t(
              isGeneration
                ? "Approve and save generated image"
                : isStyle
                  ? "Approve and save styled image"
                  : "Approve and save outfit result",
            )}
          </button>
        )
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function OutfitTaskHistory({
  request,
  onOpen,
}: {
  request: CreationRequest;
  onOpen: (id: string) => void;
}) {
  const [page, setPage] = useState<{ entries: Job[]; next: number | null }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load(before?: number) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = (await request({ kind: "history", before })) as NonNullable<typeof page>;
      setPage({
        entries: before ? [...(page?.entries ?? []), ...next.entries] : next.entries,
        next: next.next,
      });
    } catch (reason) {
      setError(t(outfitError(reason)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ui-card" aria-label={t("Recent image tasks")}>
      <button type="button" className="ui-button" disabled={busy} onClick={() => void load()}>
        {t("Load saved image tasks")}
      </button>
      {page?.entries.map((job) => (
        <p key={job.id}>
          <button
            type="button"
            className="ui-button"
            disabled={busy}
            onClick={() => onOpen(job.id)}
          >
            {t(imageWorkflowLabel(job.plan.workflow))} · {job.plan.input.description} ·{" "}
            {job.plan.settings.model}
          </button>
        </p>
      ))}
      {page && !page.entries.length && <p>{t("No image tasks yet.")}</p>}
      {page?.next != null && (
        <button
          type="button"
          className="ui-button"
          disabled={busy}
          onClick={() => void load(page.next ?? undefined)}
        >
          {t("Load older image tasks")}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
