import { t } from "../../i18n.js";

function button(label, click) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "ui-button ui-button--secondary ui-button--sm";
  element.dataset.i18nText = label;
  element.textContent = t(label);
  element.addEventListener("click", click);
  return element;
}

function sourceDetails(target, preview) {
  const sources = [
    ["Image source", preview.source.url],
    ["Page URL", preview.pageUrl],
    ["Captured at", preview.capturedAt],
    ["Document version", preview.documentRevision],
  ];
  if (preview.frame) {
    sources.push(["Image frame source", preview.frame.url || t("Inline frame")],
      ["Frame document version", preview.frame.documentRevision]);
  }
  for (const [label, value] of sources) {
    const key = document.createElement("dt");
    key.dataset.i18nText = label;
    key.textContent = t(label);
    const detail = document.createElement("dd");
    detail.textContent = value;
    detail.setAttribute("translate", "no");
    target.append(key, detail);
  }
}

export function sameReviewedImage(before, after) {
  return after && after.pngBase64 === before.pngBase64 &&
    after.pageUrl === before.pageUrl && after.source.url === before.source.url &&
    after.documentRevision === before.documentRevision &&
    after.frame?.url === before.frame?.url &&
    after.frame?.documentRevision === before.frame?.documentRevision;
}

export function createBrowserImageReview(onSend, onDiscard) {
  const element = document.createElement("section");
  element.className = "browser-image-review";
  element.hidden = true;
  element.tabIndex = -1;
  element.setAttribute("aria-label", t("Image preview for AI"));
  element.setAttribute("data-i18n-aria-label", "Image preview for AI");
  const image = document.createElement("img");
  image.alt = t("Image preview for AI");
  const source = document.createElement("dl");
  const destination = document.createElement("p");
  const send = button("Send only this image", onSend);
  const discard = button("Discard image preview", onDiscard);
  const toolbar = document.createElement("div");
  toolbar.className = "ui-toolbar";
  toolbar.append(send, discard);
  element.append(image, source, destination, toolbar);
  const resultSource = document.createElement("dl");
  resultSource.className = "browser-image-result-source";
  resultSource.hidden = true;
  resultSource.setAttribute("aria-label", t("Image analysis source"));
  resultSource.setAttribute("data-i18n-aria-label", "Image analysis source");

  return {
    element, resultSource,
    show(preview) {
      image.src = `data:image/png;base64,${preview.pngBase64}`;
      source.replaceChildren();
      sourceDetails(source, preview);
      element.hidden = false;
      element.focus();
    },
    controls(model, busy) {
      send.disabled = busy || !model?.supportsImages;
      discard.disabled = busy;
      destination.textContent = model?.supportsImages
        ? t("Image destination: {model}").replace("{model}", `${model.provider} / ${model.name || model.modelId}`)
        : t("Use a browser model that supports images.");
    },
    showResult(preview) {
      resultSource.replaceChildren();
      if (preview) sourceDetails(resultSource, preview);
      resultSource.hidden = !preview;
    },
    clear() {
      image.removeAttribute("src");
      source.replaceChildren();
      element.hidden = true;
    },
  };
}
