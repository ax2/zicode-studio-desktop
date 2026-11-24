import { t } from "../../i18n.js";
import { appendPartialCapture } from "./browser-capture-status.js";

export function renderBrowserCaptureLinks({ links = [], linksTruncated }, include) {
  if (!links.length && !linksTruncated) return null;

  const details = document.createElement("details");
  details.className = "browser-capture-links";
  const summary = document.createElement("summary");
  summary.textContent = `${t("Page links")} (${links.length})`;
  if (linksTruncated) appendPartialCapture(summary);
  details.append(summary);

  if (links.length) {
    if (include) {
      const share = document.createElement("label");
      share.append(include, t("Include links in the page note or chat draft"));
      details.append(share);
    }
    const list = document.createElement("ul");
    list.tabIndex = 0;
    list.setAttribute("aria-label", t("Page links"));
    for (const { label, url } of links) {
      const item = document.createElement("li");
      const value = document.createElement("p");
      value.textContent = label ? `${label} — ${url}` : url;
      item.append(value);
      list.append(item);
    }
    details.append(list);
  }
  if (linksTruncated) {
    const warning = document.createElement("p");
    warning.textContent = t("Only some page links are shown.");
    details.append(warning);
  }
  return details;
}
