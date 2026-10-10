import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n.js";
import type { AutomationAppOptions } from "./store";

type WorkerStatus = "running" | "stopping" | "stopped" | "starting";

type Props = Pick<
  AutomationAppOptions,
  | "backgroundWorkerStatus"
  | "startBackgroundWorker"
  | "stopBackgroundWorker"
  | "backgroundWorkerLoginEnabled"
  | "setBackgroundWorkerLoginEnabled"
>;

function readStatus(value: unknown): WorkerStatus {
  if (value === "running" || value === "stopping" || value === "stopped" || value === "starting") {
    return value;
  }
  throw new Error(t("Background worker returned an invalid status."));
}

export function BackgroundWorkerPanel({
  backgroundWorkerStatus,
  startBackgroundWorker,
  stopBackgroundWorker,
  backgroundWorkerLoginEnabled,
  setBackgroundWorkerLoginEnabled,
}: Props) {
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [loginEnabled, setLoginEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loginError, setLoginError] = useState("");
  const sequence = useRef(0);
  const loginSequence = useRef(0);
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!backgroundWorkerStatus || busyRef.current) return;
    const ticket = ++sequence.current;
    try {
      const next = readStatus(await backgroundWorkerStatus());
      if (ticket === sequence.current) {
        setStatus(next);
        setError("");
      }
    } catch (reason) {
      if (ticket === sequence.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
  }, [backgroundWorkerStatus]);

  const refreshLogin = useCallback(async () => {
    if (!backgroundWorkerLoginEnabled || busyRef.current) return;
    const ticket = ++loginSequence.current;
    try {
      const enabled = await backgroundWorkerLoginEnabled();
      if (typeof enabled !== "boolean") throw new Error(t("Background login setting returned an invalid status."));
      if (ticket === loginSequence.current) {
        setLoginEnabled(enabled);
        setLoginError("");
      }
    } catch (reason) {
      if (ticket === loginSequence.current) {
        setLoginError(reason instanceof Error ? reason.message : String(reason));
      }
    }
  }, [backgroundWorkerLoginEnabled]);

  useEffect(() => {
    void refresh();
    void refreshLogin();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        void refreshLogin();
      }
    };
    const timer = window.setInterval(onVisible, 5_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      sequence.current += 1;
      loginSequence.current += 1;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, refreshLogin]);

  if (!backgroundWorkerStatus || !startBackgroundWorker || !stopBackgroundWorker) return null;

  const perform = async (operation: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const ticket = ++sequence.current;
    try {
      const next = readStatus(await operation());
      if (ticket === sequence.current) {
        setStatus(next);
        setError("");
      }
    } catch (reason) {
      if (ticket === sequence.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const changeLoginStart = async (enabled: boolean) => {
    if (!setBackgroundWorkerLoginEnabled || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const ticket = ++loginSequence.current;
    try {
      const saved = await setBackgroundWorkerLoginEnabled(enabled);
      if (typeof saved !== "boolean") throw new Error(t("Background login setting returned an invalid status."));
      if (ticket === loginSequence.current) {
        setLoginEnabled(saved);
        setLoginError("");
      }
    } catch (reason) {
      if (ticket === loginSequence.current) {
        setLoginError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const statusText = status === "running"
    ? t("Background worker is running")
    : status === "stopping"
      ? t("Background worker is stopping")
      : status === "starting"
        ? t("Background worker is starting")
        : status === "stopped"
          ? t("Background worker is stopped")
          : t("Checking background worker status");

  return (
    <section className="ui-card automation-worker-panel" aria-label={t("Background automation")}>
      <div>
        <h2>{t("Background automation")}</h2>
        <p>{t("Run scheduled checks in a separate process that can stay open when desktop windows close. One process at a time dispatches automatic runs.")}</p>
        <p className="automation-worker-status" role="status">{statusText}</p>
        {error ? <p className="automation-worker-error" role="alert">{error}</p> : null}
        {backgroundWorkerLoginEnabled && setBackgroundWorkerLoginEnabled ? (
          <div className="automation-worker-login">
            <label>
              <input
                type="checkbox"
                checked={loginEnabled === true}
                disabled={busy || loginEnabled === null}
                onChange={(event) => void changeLoginStart(event.target.checked)}
              />
              <span>{t("Start background automation when I sign in")}</span>
            </label>
            <p>{t("This setting takes effect at the next sign-in. Use Start or Stop for this session.")}</p>
            {loginError ? <p className="automation-worker-error" role="alert">{loginError}</p> : null}
          </div>
        ) : null}
      </div>
      <div className="automation-worker-actions">
        <button
          type="button"
          className="ui-button ui-button--primary"
          disabled={busy || status !== "stopped"}
          aria-busy={busy && status === "stopped"}
          onClick={() => void perform(startBackgroundWorker)}
        >
          {t("Start background worker")}
        </button>
        <button
          type="button"
          className="ui-button ui-button--secondary"
          disabled={busy || status !== "running"}
          aria-busy={busy && status === "running"}
          onClick={() => void perform(stopBackgroundWorker)}
        >
          {t("Stop background worker")}
        </button>
        <button type="button" className="ui-button ui-button--ghost" disabled={busy} onClick={() => void refresh()}>
          {t("Refresh status")}
        </button>
      </div>
    </section>
  );
}
