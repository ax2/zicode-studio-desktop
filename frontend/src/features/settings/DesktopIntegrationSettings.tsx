import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";

type Action = "status" | "install" | "remove";
type Invoke = (command: string, params: { action: Action }) => Promise<unknown>;
interface MenuStatus {
  supported: boolean;
  installed?: number;
  stale?: number;
  total?: number;
  reason?: string;
}

function nativeInvoke(): Invoke | undefined {
  return (globalThis as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke;
}

export function DesktopIntegrationSettings({ invoke = nativeInvoke() }: { invoke?: Invoke }) {
  const [status, setStatus] = useState<MenuStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState<"install" | "remove" | null>(null);
  const held = useRef(false);
  const generation = useRef(0);
  const request = useCallback(
    async (action: Action) => {
      if (!invoke || held.current) return;
      held.current = true;
      const current = ++generation.current;
      setBusy(true);
      setError(false);
      setPending(null);
      try {
        const raw = await invoke("desktop_explorer_menu", { action });
        const value = raw as MenuStatus | null;
        const total = value?.total ?? 4;
        if (
          !value ||
          typeof value.supported !== "boolean" ||
          (value.supported &&
            (!Number.isInteger(total) || total < 4 || total > 16 ||
              !Number.isInteger(value.installed) ||
              (value.installed ?? -1) < 0 ||
              (value.installed ?? total + 1) > total ||
              (value.stale !== undefined &&
                (!Number.isInteger(value.stale) || value.stale < 0 || value.stale > (value.installed ?? -1)))))
        ) {
          throw new Error("Invalid Explorer status");
        }
        if (generation.current === current) setStatus(value);
      } catch {
        if (generation.current === current) {
          setStatus(null);
          setError(true);
        }
      } finally {
        held.current = false;
        if (generation.current === current) setBusy(false);
      }
    },
    [invoke],
  );
  // This section only reads on mount. Registration always requires a user action.
  useEffect(() => {
    void request("status");
  }, [request]);

  if (!invoke) return null;
  const enabled = status?.supported === true && !busy;
  const unavailable =
    status?.reason === "isolated-profile"
      ? t("Explorer menu changes are disabled in this acceptance profile.")
      : t("Explorer menus are available in the Windows desktop app.");
  return (
    <div className="settings-section" id="desktop-integration-settings">
      <div className="settings-section-title">{t("Desktop integration")}</div>
      <p>
        {t(
          "Open files in the tool center or folders in Studio from Explorer. Windows 11 may show this under Show more options.",
        )}
      </p>
      <p role="status" aria-live="polite">
        {busy
          ? t("Checking Explorer menu…")
          : error
            ? t(
                "Explorer menu status is unknown. Check again before changing it. An existing entry may belong to another installation.",
              )
            : status?.supported
              ? `${t("Registered Explorer entries")}: ${status.installed}/${status.total ?? 4}${status.stale ? ` · ${status.stale} ${t("need repair after Studio moved")}` : ""}`
              : unavailable}
      </p>
      <div className="desktop-integration-actions">
        <button
          type="button"
          className="ui-button ui-button--secondary ui-button--sm"
          disabled={busy}
          onClick={() => void request("status")}
        >
          {t("Check menu status")}
        </button>
        <button
          type="button"
          className="ui-button ui-button--secondary ui-button--sm"
          disabled={!enabled || (status?.installed === (status?.total ?? 4) && !status.stale)}
          onClick={() => setPending("install")}
        >
          {status?.stale ? t("Repair Explorer menu") : t("Add Explorer menu")}
        </button>
        <button
          type="button"
          className="ui-button ui-button--secondary ui-button--sm"
          disabled={!enabled || !status?.installed}
          onClick={() => setPending("remove")}
        >
          {t("Remove Explorer menu")}
        </button>
      </div>
      {pending ? (
        <fieldset aria-label={t("Confirm Explorer menu change")}>
          <p>
            {pending === "install"
              ? t(
                  "Add or repair file, folder, folder background and drive menus for this Windows user? Files open the tool center; sharing and execution require separate confirmation.",
                )
              : t(
                  "Remove the file and folder menus owned by this Studio installation for this Windows user?",
                )}
          </p>
          <div className="desktop-integration-actions">
            <button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm"
              onClick={() => void request(pending)}
            >
              {t("Confirm Explorer menu change")}
            </button>
            <button
              type="button"
              className="ui-button ui-button--secondary ui-button--sm"
              onClick={() => setPending(null)}
            >
              {t("Cancel")}
            </button>
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
