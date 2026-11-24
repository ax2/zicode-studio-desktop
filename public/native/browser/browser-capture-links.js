import { t } from "../../i18n.js";
import { appendPartialCapture } from "./browser-capture-status.js";

export function selectCapturedLinks(links = [], linkIndexes) {
  return linkIndexes ? links.filter((_, index) => linkIndexes.includes(index)) : links;
}

export function createBrowserCaptureLinks({ links = [], linksTruncated }, canAttach) {
  const all = document.createElement("input");
  all.type = "checkbox";
  const separateChoices = canAttach && links.length > 1;
  const choices = canAttach ? links.map(() => separateChoices ? document.createElement("input") : all) : [];
  const selectedIndexes = () => choices.flatMap((choice, index) => choice.checked ? [index] : []);
  function attachments() {
    const linkIndexes = selectedIndexes();
    return {
      includeLinks: linkIndexes.length > 0,
      ...(linkIndexes.length > 0 && linkIndexes.length < links.length ? { linkIndexes } : {}),
    };
  }
  if (!links.length && !linksTruncated) return { attachments };

  const element = document.createElement("details");
  element.className = "browser-capture-links";
  const summary = document.createElement("summary");
  summary.textContent = `${t("Page links")} (${links.length})`;
  if (linksTruncated) appendPartialCapture(summary);
  element.append(summary);

  if (links.length) {
    if (canAttach) {
      const share = document.createElement("label");
      const text = document.createElement("span");
      text.dataset.i18nText = separateChoices ? "Include all page links" : "Include links in the page note or chat draft";
      text.textContent = t(text.dataset.i18nText);
      share.append(all, text);
      element.append(share);
    }
    if (separateChoices) {
      all.addEventListener("change", () => {
        for (const choice of choices) choice.checked = all.checked;
      });
    }
    const list = document.createElement("ul");
    list.classList.toggle("browser-capture-link-choices", separateChoices);
    list.tabIndex = 0;
    list.setAttribute("aria-label", t("Page links"));
    for (const [index, { label, url }] of links.entries()) {
      const item = document.createElement("li");
      const value = document.createElement(separateChoices ? "span" : "p");
      value.setAttribute("translate", "no");
      value.textContent = label ? `${label} — ${url}` : url;
      if (separateChoices) {
        const choice = choices[index];
        choice.type = "checkbox";
        choice.addEventListener("change", () => {
          const count = selectedIndexes().length;
          all.checked = count === choices.length;
          all.indeterminate = count > 0 && !all.checked;
        });
        const row = document.createElement("label");
        row.append(choice, value);
        item.append(row);
      } else {
        item.append(value);
      }
      list.append(item);
    }
    element.append(list);
  }
  if (linksTruncated) {
    const warning = document.createElement("p");
    warning.textContent = t("Only some page links are shown.");
    element.append(warning);
  }
  return { attachments, element };
}
