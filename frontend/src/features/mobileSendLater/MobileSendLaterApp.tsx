import { t } from "../../shared/i18n";

export function MobileSendLaterBanner({
  active,
  connected,
  busy,
  onSendNow,
  onKeepDraft,
}: {
  active: boolean;
  connected: boolean;
  busy: boolean;
  onSendNow(): void;
  onKeepDraft(): void;
}) {
  return (
    <aside className="mobile-send-later" aria-live="polite" hidden={!active}>
      <div className="mobile-send-later-copy">
        <strong>
          {t(connected ? "Ready to send" : "Saved for reconnect")}
        </strong>
        <span>
          {t(
            connected
              ? "Connection restored. Review the draft, then send it."
              : "The encrypted draft is saved on this device and will not send automatically.",
          )}
        </span>
      </div>
      <div className="mobile-send-later-actions">
        <button
          type="button"
          className="ui-button ui-button--primary ui-button--sm"
          disabled={busy || !connected}
          aria-busy={busy}
          onClick={onSendNow}
        >
          {t("Send now")}
        </button>
        <button
          type="button"
          className="ui-button ui-button--ghost ui-button--sm"
          disabled={busy}
          onClick={onKeepDraft}
        >
          {t("Keep as draft")}
        </button>
      </div>
    </aside>
  );
}
