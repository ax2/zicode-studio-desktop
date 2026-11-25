
import { t } from "../../i18n.js";

export function createBrowserImageOcr(image, recognize) {
  const element = document.createElement("div");
  element.className = "browser-image-ocr";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ui-button ui-button--secondary";
  button.textContent = t("Recognize text locally");
  const language = document.createElement("select");
  language.className = "ui-select";
  language.setAttribute("aria-label", t("OCR language"));
  language.append(
    new Option(t("Default OCR language"), ""),
    new Option(t("Simplified Chinese"), "zh-CN"),
    new Option(t("English"), "en-US"),
  );
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.hidden = true;
  const output = document.createElement("textarea");
  output.className = "ui-textarea";
  output.setAttribute("aria-label", t("Recognized image text"));
  output.readOnly = true;
  output.rows = 3;
  output.hidden = true;
  const include = document.createElement("input");
  include.type = "checkbox";
  const label = document.createElement("label");
  label.append(include, t("Include this image text in the page note or chat draft"));
  label.hidden = true;
  element.append(language, button, status, label, output);
  let result;
  const clearResult = () => {
    const wasIncluded = include.checked;
    result = undefined;
    include.checked = false;
    label.hidden = output.hidden = true;
    output.value = "";
    button.textContent = t("Recognize text locally");
    if (wasIncluded) include.dispatchEvent(new Event("change", { bubbles: true }));
  };
  language.addEventListener("change", () => {
    if (language.disabled) return;
    clearResult();
    status.hidden = true;
  });
  button.addEventListener("click", async () => {
    const hadFocus = document.activeElement === button;
    if (button.disabled) return;
    button.disabled = language.disabled = true;
    clearResult();
    status.hidden = false;
    status.textContent = t("Recognizing image text…");
    try {
      const recognized = await recognize(image, language.value || undefined);
      if (!element.isConnected) return;
      if (!recognized) { status.hidden = true; return; }
      if (!recognized.text.trim()) {
        status.textContent = t("No text was recognized in the image");
        return;
      }
      result = recognized;
      output.value = result.text;
      output.hidden = false;
      label.hidden = false;
      status.textContent = t(result.truncated ? "Recognized image text was shortened." : "Image text is ready to review.");
      if (hadFocus && (document.activeElement === button || document.activeElement === document.body)) {
        output.focus({ preventScroll: true });
      }
      button.textContent = t("Recognize text again");
    } catch (error) {
      if (element.isConnected) status.textContent = t(String(error?.message ?? error));
    } finally {
      button.disabled = language.disabled = false;
      if (hadFocus && !button.hidden && element.isConnected && document.activeElement === document.body) {
        button.focus({ preventScroll: true });
      }
    }
  });
  return { element, attachment: () => include.checked ? result : undefined };
}
