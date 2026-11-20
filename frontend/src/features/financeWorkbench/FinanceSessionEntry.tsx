import { t } from "../../shared/i18n";
import type { FinanceSessionEntryStore } from "./finance-session-entry";

export function FinanceSessionEntry({ store }: { store: FinanceSessionEntryStore }) {
  const { busy, failed, open } = store();
  return <section className="finance-scene-guard ui-card">
    <h1>{t("Finance Workbench")}</h1>
    <p>{t("Open the Finance Workbench in its dedicated session.")}</p>
    {failed && <p role="alert">{t("Could not open the Finance Workbench. Try again.")}</p>}
    <div className="finance-scene-guard-actions">
      <button type="button" className="ui-button ui-button--primary" disabled={busy} aria-busy={busy}
        onClick={() => { void open(); }}>
        {busy ? t("Opening workbench…") : t("Open Finance Workbench")}
      </button>
    </div>
  </section>;
}
