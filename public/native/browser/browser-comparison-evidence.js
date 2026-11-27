import { t } from "../../i18n.js";
import { appendPartialCapture } from "./browser-capture-status.js";

function showNotice(element, key, visible) {
  element.hidden = !visible;
  element.textContent = visible ? t(key) : "";
  if (visible) element.dataset.i18nText = key; else delete element.dataset.i18nText;
}

function selectedEvidence({ text: _text, textTruncated: _textTruncated, ...source }) {
  return { ...source, selectionOnly: true, truncated: source.selectionTruncated };
}

function previewSource(source, position, selectionOnlyTabs, onChange) {
  const element = document.createElement("details");
  const summary = document.createElement("summary");
  const title = source.title || source.url;
  const url = document.createElement("p"); url.textContent = source.url;
  const time = document.createElement("p"); time.textContent = t("Captured at") + " · " + source.capturedAt;
  const excerpt = document.createElement("textarea");
  excerpt.className = "ui-textarea";
  excerpt.readOnly = true;
  excerpt.setAttribute("aria-label", t("Comparison source text"));
  element.append(summary, url, time);

  const hasSelection = Boolean(source.selection.trim());
  const hasExcerpt = hasSelection || Boolean(source.text.trim());
  let choice;
  if (hasSelection || selectionOnlyTabs.has(source.tab)) {
    const key = "Use only selected text";
    const label = document.createElement("label"); label.className = "ui-toolbar";
    choice = document.createElement("input"); choice.type = "checkbox";
    choice.checked = selectionOnlyTabs.has(source.tab);
    choice.setAttribute("aria-label", t(key) + " · [" + position + "] " + title);
    label.append(choice, t(key));
    element.append(label);
  }

  const missing = document.createElement("p");
  const bodyLimit = document.createElement("p");
  const selectionLimit = document.createElement("p");
  element.append(missing, excerpt, bodyLimit, selectionLimit);
  function render() {
    const only = choice?.checked;
    summary.textContent = "[" + position + "] " + title;
    if (only) summary.append(" · ", t("Selected text"));
    if (only ? source.selectionTruncated : source.truncated) appendPartialCapture(summary);
    const unavailable = only ? !hasSelection : !hasExcerpt;
    const missingMessage = hasExcerpt
      ? "No selected text is available for this source. Select some text and read the tabs again, or use its page excerpt."
      : "No readable text is available for this source. Read the tab again before comparing.";
    showNotice(missing, missingMessage, unavailable);
    excerpt.hidden = unavailable;
    excerpt.value = only ? source.selection : [source.selection && t("Selected text") + "\n" + source.selection, source.text].filter(Boolean).join("\n\n");
    excerpt.setSelectionRange(0, 0);
    excerpt.scrollTop = 0;
    showNotice(bodyLimit, "Page content was shortened", !only && source.textTruncated);
    showNotice(selectionLimit, "Selected text was shortened", source.selectionTruncated);
  }
  choice?.addEventListener("change", () => {
    if (choice.checked) selectionOnlyTabs.add(source.tab); else selectionOnlyTabs.delete(source.tab);
    render();
    onChange();
  });
  render();
  return { element, choice, evidence() {
    if (choice?.checked) return hasSelection ? selectedEvidence(source) : null;
    return hasExcerpt ? source : null;
  } };
}

export function showBrowserComparisonEvidence(container, sources, selectionOnlyTabs, open, onChange) {
  const previews = sources.map((source, index) => previewSource(source, index + 1, selectionOnlyTabs, onChange));
  for (const { element } of previews) element.open = open;
  container.replaceChildren(...previews.map(preview => preview.element));
  return {
    material() {
      const materials = previews.map(preview => preview.evidence());
      return materials.every(Boolean) ? materials : null;
    },
    setDisabled(disabled) {
      for (const { choice } of previews) if (choice) choice.disabled = disabled;
    },
  };
}
