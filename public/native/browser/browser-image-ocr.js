
import { t } from "../../i18n.js";

export function createBrowserImageOcr(image, recognize) {
  const element = document.createElement("div");
  element.className = "browser-image-ocr";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ui-button ui-button--secondary";
  button.textContent = t("Recognize text locally");
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
  element.append(button, status, label, output);
  let result;
  button.addEventListener("click", async () => {
    const hadFocus = document.activeElement === button;
    button.disabled = true;
    status.hidden = false;
    status.textContent = t("Recognizing image text…");
    try {
      const recognized = await recognize(image);
      if (!element.isConnected) return;
      if (!recognized) { status.hidden = true; return; }
      result = recognized;
      output.value = result.text;
      output.hidden = false;
      label.hidden = false;
      status.textContent = t(result.truncated ? "Recognized image text was shortened." : "Image text is ready to review.");
      if (hadFocus && (document.activeElement === button || document.activeElement === document.body)) {
        output.focus({ preventScroll: true });
      }
      button.hidden = true;
    } catch (error) {
      if (element.isConnected) status.textContent = t(String(error?.message ?? error));
    } finally {
      button.disabled = false;
    }
  });
  return { element, attachment: () => include.checked ? result : undefined };
}
