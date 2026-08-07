import { t } from "../../shared/i18n";

export function HistoryWindowNotice({
  onReveal,
}: {
  onReveal?: () => void;
}) {
  return (
    <aside
      className="history-window-notice"
      aria-label={t("Earlier conversation")}
    >
      <HistoryWindowNoticeContent onReveal={onReveal} />
    </aside>
  );
}

export function HistoryWindowNoticeContent({
  onReveal,
}: {
  onReveal?: () => void;
}) {
  return (
    <>
      <span>{t("Earlier messages are folded to keep this conversation fast.")}</span>
      <button
        type="button"
        className="ui-button ui-button--secondary history-window-load"
        onClick={onReveal}
      >
        {t("Load earlier messages")}
      </button>
    </>
  );
}

export function HistoryLoadedStatus() {
  return (
    <p className="history-window-loaded" tabIndex={-1} role="status">
      <HistoryLoadedStatusContent />
    </p>
  );
}

export function HistoryLoadedStatusContent() {
  return <>{t("All earlier messages loaded.")}</>;
}
