import { t } from "../../shared/i18n";
import type { CallDiagnostics } from "./manual-call-diagnostics";
import type { ManualTool } from "./manual-tools";

export function ToolCallDiagnostics({ trace, tool }: { trace: CallDiagnostics | null; tool: ManualTool }) {
  if (!trace) return null;
  const metadata = { ...trace, pluginId: tool.pluginId, capabilityId: tool.capabilityId, packageVersion: tool.version, runtime: tool.runtime };
  return <details className="tool-call-diagnostics">
    <summary>{t("Call troubleshooting details")}</summary>
    <p className="tool-center-source">{t("Only call identifiers, times and status codes are kept here. Inputs, results and raw error messages are excluded. Closing this tool clears this record.")}</p>
    <textarea className="ui-textarea tool-result" readOnly rows={8} aria-label={t("Call troubleshooting record")} value={JSON.stringify(metadata, null, 2)} />
  </details>;
}
