import { t } from "../../i18n.js";

export function appendPartialCapture(summary) {
  const hint = document.createElement("span");
  hint.dataset.i18nText = "Partial capture";
  hint.textContent = t("Partial capture");
  summary.append(" · ", hint);
}

export function isFrameTextIncomplete(frame) {
  return frame.textTruncated || frame.selectionTruncated || frame.tablesTruncated;
}
