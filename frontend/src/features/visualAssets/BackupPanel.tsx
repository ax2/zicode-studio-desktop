import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { type AnimationAsset, type AnimationIntent, AnimationPanel } from "./AnimationPanel";
import { AnimationRetry } from "./AnimationRetry";
import type { Invoke } from "./VisualAssetsApp";

interface Job {
  id: string;
  state: string;
  destination: string;
  operation?: "backup" | "restore" | "animation";
  phase?: string;
}
interface Status {
  job?: Job | null;
  cancelled?: boolean;
}
const activeStates = new Set(["queued", "running", "publishing", "cancelling"]);
const messages: Record<string, string> = {
  queued: "Backup is waiting.",
  running: "Backing up your visual library...",
  publishing: "Finishing backup...",
  cancelling: "Cancelling backup...",
  completed: "Visual library backup complete.",
  cancelled: "Backup cancelled. Any partial files were kept.",
  failed: "Backup did not finish. Its files were kept. Start a new backup to retry.",
  interrupted: "Backup was interrupted. When the backup folder is available, refresh its status.",
};
const restoreMessages: Record<string, string> = {
  queued: "Restore is waiting.",
  running: "Restoring your visual library...",
  publishing: "Finishing restore...",
  cancelling: "Cancelling restore...",
  completed: "Visual library restored.",
  cancelled: "Restore cancelled.",
  failed: "Restore failed. Check the snapshot and make sure the library is empty.",
  interrupted: "Restore was interrupted. Refresh the library to check its contents.",
};
const animationMessages: Record<string, string> = {
  queued: "Animation export is waiting.",
  running: "Exporting animation...",
  publishing: "Publishing animation...",
  cancelling: "Cancelling animation export...",
  completed: "Animation exported.",
  cancelled: "Animation export cancelled.",
  failed: "Animation export failed. Check the images, frame settings and destination.",
  interrupted: "Animation export was interrupted.",
};

export function BackupPanel({
  invoke,
  workspaceId,
  disabled,
  onBusyChange,
  canRestore,
  onRestored,
  animation,
}: {
  invoke: Invoke;
  workspaceId: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  canRestore?: boolean;
  onRestored?: () => void;
  animation?: { libraryId: string; assets: AnimationAsset[] };
}) {
  const [job, setJob] = useState<Job | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState("");
  const [animationError, setAnimationError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [includeReferencedOriginals, setIncludeReferencedOriginals] = useState(false);
  const active = job != null && activeStates.has(job.state);
  const restoring = job?.operation === "restore";
  const exporting = job?.operation === "animation";
  const reportedRestore = useRef<string | null>(null);

  useEffect(() => {
    if (
      job?.operation === "restore" &&
      job.state === "completed" &&
      reportedRestore.current !== job.id
    ) {
      reportedRestore.current = job.id;
      onRestored?.();
    }
  }, [job, onRestored]);

  useEffect(() => {
    onBusyChange(active || requesting);
  }, [active, requesting, onBusyChange]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh restarts polling after a submitted action or retry.
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const result = (await invoke("visual_assets_control", {
          workspaceId,
          request: { kind: "backupStatus" },
        })) as Status;
        if (!current) return;
        setJob(result.job ?? null);
        setLoaded(true);
        setError("");
        if (result.job && activeStates.has(result.job.state))
          timer = setTimeout(() => void poll(), 2000);
      } catch {
        if (current) setError(t("Backup status is unavailable. Refresh to try again."));
      }
    }
    if (workspaceId) void poll();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [invoke, workspaceId, refresh]);

  async function act(
    kind: "startBackup" | "startRestore" | "cancelBackup" | "startAnimation",
    intent?: AnimationIntent,
  ) {
    const animationAction = kind === "startAnimation" || (kind === "cancelBackup" && exporting);
    setRequesting(true);
    if (animationAction) setAnimationError("");
    else setError("");
    try {
      const result = (await invoke("visual_assets_control", {
        workspaceId,
        request:
          kind === "cancelBackup"
            ? { kind, jobId: job?.id }
            : kind === "startAnimation"
              ? { kind, intent }
              : {
                  kind,
                  ...(kind === "startBackup" && includeReferencedOriginals
                    ? { includeReferencedOriginals: true }
                    : {}),
                },
      })) as Status;
      if (!result.cancelled) setJob(result.job ?? null);
    } catch (reason) {
      if (animationAction) {
        setAnimationError(
          t(
            String(reason).includes("visual_assets_animation_recipe_invalid")
              ? "Check the animation frame settings."
              : "The animation request could not be completed. Refresh its status before retrying.",
          ),
        );
      } else {
        setError(
          t(
            kind === "startRestore" || restoring
              ? "The restore request could not be completed."
              : "The backup request could not be completed. Check its status before trying again.",
          ),
        );
      }
    } finally {
      if (kind === "startBackup") setIncludeReferencedOriginals(false);
      setRequesting(false);
      setRefresh((value) => value + 1);
    }
  }

  async function confirmAnimation(
    kind: "confirmAnimationInstall" | "confirmAnimationRetry",
    token: string,
  ) {
    setRequesting(true);
    try {
      const result = (await invoke("visual_assets_control", {
        workspaceId,
        request: { kind, token },
      })) as Status;
      setJob(result.job ?? null);
    } finally {
      setRequesting(false);
      setRefresh((value) => value + 1);
    }
  }

  return (
    <>
      <section className="ui-panel" aria-label={t("Visual library backup")}>
        <div className="ui-toolbar">
          <button
            type="button"
            className="ui-button"
            disabled={disabled || !loaded || active || requesting}
            onClick={() => void act("startBackup")}
          >
            {t("Back up library")}
          </button>
          <label>
            <input
              type="checkbox"
              checked={includeReferencedOriginals}
              disabled={disabled || !loaded || active || requesting}
              onChange={(event) => setIncludeReferencedOriginals(event.target.checked)}
            />
            {t("Include referenced originals for offline restore")}
          </label>
          <button
            type="button"
            className="ui-button"
            disabled={disabled || !canRestore || !loaded || active || requesting}
            onClick={() => void act("startRestore")}
          >
            {t("Restore library")}
          </button>
          {active && !exporting && (
            <button
              type="button"
              className="ui-button"
              disabled={requesting || job?.state === "publishing" || job?.state === "cancelling"}
              onClick={() => void act("cancelBackup")}
            >
              {t(restoring ? "Cancel restore" : "Cancel backup")}
            </button>
          )}
          <button
            type="button"
            className="ui-button"
            disabled={requesting}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {t("Refresh backup status")}
          </button>
        </div>
        <p>{t("Choose a folder. A new backup folder will be created inside it.")}</p>
        <p>{t("To restore an empty library, select the snapshot folder inside your backup.")}</p>
        {active && !exporting && (
          <p>
            {t(
              restoring
                ? "Restore continues when you leave this view. Library changes are paused until it finishes."
                : "Backup continues when you leave this view. Library changes are paused until it finishes.",
            )}
          </p>
        )}
        {job && !exporting && (
          <p role="status">
            {t(
              (job.state === "failed" && job.phase === "copying-referenced-originals"
                ? "Could not include a referenced original. Check its source and the backup folder."
                : (restoring ? restoreMessages : messages)[job.state]) ??
                "Backup status is unavailable. Refresh to try again.",
            )}
          </p>
        )}
        {job && !restoring && !exporting && (
          <p className="visual-assets-backup-path">
            {t("Backup folder")}: {job.destination.replace(/^\\\\\?\\/, "")}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
      {(animation || exporting) && (
        <AnimationPanel
          key={animation?.libraryId ?? "pending-library"}
          libraryId={animation?.libraryId ?? ""}
          assets={animation?.assets ?? []}
          disabled={disabled || !animation || !loaded || active || requesting}
          onExport={(intent) => void act("startAnimation", intent)}
          onPreview={(intent) =>
            invoke("visual_assets_control", {
              workspaceId,
              request: { kind: "previewAnimation", intent },
            })
          }
          install={{
            plan: (name, intent) =>
              invoke("visual_assets_control", {
                workspaceId,
                request: { kind: "planAnimationInstall", name, intent },
              }),
            confirm: (token) => confirmAnimation("confirmAnimationInstall", token),
            cancel: (token) =>
              invoke("visual_assets_control", {
                workspaceId,
                request: { kind: "cancelAnimationInstall", token },
              }),
          }}
          status={
            <>
              {exporting && (
                <>
                  <p role="status">
                    {t(
                      animationMessages[job.state] ??
                        "Backup status is unavailable. Refresh to try again.",
                    )}
                  </p>
                  {job.state === "completed" && (
                    <p className="visual-assets-backup-path">
                      {t("Animation folder")}: {job.destination.replace(/^\\\\\?\\/, "")}
                    </p>
                  )}
                  {job.state === "interrupted" && (
                    <AnimationRetry
                      key={JSON.stringify([workspaceId, job.id])}
                      disabled={disabled || requesting}
                      actions={{
                        plan: () =>
                          invoke("visual_assets_control", {
                            workspaceId,
                            request: { kind: "planAnimationRetry", jobId: job.id },
                          }),
                        confirm: (token) => confirmAnimation("confirmAnimationRetry", token),
                        cancel: (token) =>
                          invoke("visual_assets_control", {
                            workspaceId,
                            request: { kind: "cancelAnimationRetry", token },
                          }),
                      }}
                    />
                  )}
                  {active && (
                    <button
                      type="button"
                      className="ui-button"
                      disabled={
                        requesting || job.state === "publishing" || job.state === "cancelling"
                      }
                      onClick={() => void act("cancelBackup")}
                    >
                      {t("Cancel animation export")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="ui-button"
                    disabled={requesting}
                    onClick={() => setRefresh((value) => value + 1)}
                  >
                    {t("Refresh animation status")}
                  </button>
                </>
              )}
              {animationError && <p role="alert">{animationError}</p>}
            </>
          }
        />
      )}
    </>
  );
}
