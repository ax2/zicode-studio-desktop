import { t } from "../../shared/i18n";
import type { ManualTool, ToolDetail } from "./manual-tools";

export function ManualToolInformation({ tool, detail, busy, onOpenApplication }: {
  tool: ManualTool; detail: ToolDetail | null; busy: boolean; onOpenApplication?(): void;
}) {
  return <details className="tool-information">
    <summary>{t("Tool information")}</summary>
    <div className="tool-information-content">
      <p className="tool-center-source">{tool.applicationName} · {tool.version}</p>
      {tool.description && <p className="tool-input-description">{tool.description}</p>}
      {detail && detail.permissions.length > 0 && <section aria-label={t("Declared permissions")}>
        <h3>{t("Declared permissions")}</h3>
        {detail.permissions.map(permission => <p key={permission.name}>
          {permission.name} · {t(permission.granted ? "Granted" : "Not granted")} — {permission.reason}
        </p>)}
      </section>}
      {onOpenApplication && <button type="button" className="ui-button ui-button--secondary"
        disabled={busy} onClick={onOpenApplication}>{t("Open tool interface")}</button>}
    </div>
  </details>;
}
