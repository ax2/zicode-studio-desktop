import { t } from "i18n";

// This panel is owned by the trusted parent, including inside a React result view.
export function appendResultCaptureNotice(panel, code) {
  const notice = document.createElement("p");
  notice.setAttribute("role", "status");
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const diagnostic = document.createElement("p");
  details.append(summary, diagnostic);
  panel.append(notice, details);
  const source = code === "result_budget_exceeded"
    ? "Tool completed. Saving or sending this result exceeds the current capacity. You can still use the displayed result."
    : code === "result_profile_unsupported"
      ? "Tool completed. This result format cannot be saved or sent to another tool yet."
      : "Tool completed, but this result could not be prepared for saving or sending. You can still use the displayed result.";
  const refresh = () => {
    notice.textContent = t(source);
    summary.textContent = t("Technical details");
    diagnostic.textContent = `${t("Error code")}: ${code}`;
  };
  refresh();
  window.addEventListener("zicode:locale-changed", refresh);
  return () => window.removeEventListener("zicode:locale-changed", refresh);
}
