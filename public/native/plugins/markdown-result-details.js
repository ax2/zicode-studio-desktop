import { t } from "../../i18n.js";

// Keep diagnostic fields available without placing JSON ahead of the document.
export function createMarkdownResultDetails({ raw, executionProfile }) {
  if (executionProfile !== "resource.wasi.markdown.v1") return null;
  const details = document.createElement("details"), summary = document.createElement("summary");
  const refresh = () => { summary.textContent = t("Execution details"); };
  refresh(); details.hidden = true; raw.before(details); details.append(summary, raw);
  window.addEventListener("zicode:locale-changed", refresh);
  return {
    clear() { details.hidden = true; details.open = false; },
    show() { details.hidden = false; },
    destroy() { window.removeEventListener("zicode:locale-changed", refresh); details.before(raw); details.remove(); },
  };
}
