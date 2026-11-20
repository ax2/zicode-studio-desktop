import { t } from "../i18n.js";

// Remember the product label even when code blocks first render in Chinese.
// The content itself remains inside its translate="no" owner.
export function setCopyLabel(element, source) {
  if (!element) return;
  element.setAttribute("data-i18n-text", source);
  element.textContent = t(source);
}
