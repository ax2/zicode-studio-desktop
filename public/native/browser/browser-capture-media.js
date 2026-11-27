import { t } from "../../i18n.js";
import { createBrowserImageOcr } from "./browser-image-ocr.js";

export function pageMetadataRows(metadata = {}) {
  return [
    [t("Page language"), metadata.language],
    [t("Page description"), metadata.description],
    [t("Declared canonical address"), metadata.canonicalUrl],
  ].filter(([, value]) => value);
}

export function pageImageDescription({ alt, width, height, url }) {
  return [alt || t("No alternative text"), `${width} × ${height}`, url].filter(Boolean).join(" — ");
}

export function hasImageLocator(image) {
  return Boolean(image.url && image.locator);
}

export function createBrowserCaptureImageList(images, recognizeImage, reviewImage) {
  const recognitions = [];
  const list = document.createElement("ul"); list.setAttribute("aria-label", t("Page images"));
  for (const image of images) {
    const item = document.createElement("li"); item.textContent = pageImageDescription(image);
    const located = hasImageLocator(image);
    if (recognizeImage && located) {
      const recognition = createBrowserImageOcr(image, recognizeImage);
      item.append(recognition.element);
      recognitions.push(recognition);
    }
    if (reviewImage && located) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ui-button ui-button--secondary ui-button--sm";
      button.dataset.i18nText = "Preview image for AI";
      button.textContent = t("Preview image for AI");
      button.addEventListener("click", () => void reviewImage(image));
      const action = document.createElement("div");
      action.append(button);
      item.append(action);
    }
    list.append(item);
  }
  return { element: list, imageText: () => recognitions.map(recognition => recognition.attachment()).filter(Boolean) };
}

export function createBrowserCaptureMedia(page, recognizeImage, reviewImage) {
  const images = page.images ?? [];
  const recognizePageImage = recognizeImage && ((image, language) => recognizeImage(image, undefined, language));
  const imageList = createBrowserCaptureImageList(images, recognizePageImage, reviewImage);
  const { imageText } = imageList;
  const metadata = pageMetadataRows(page.metadata);
  const include = document.createElement("input"); include.type = "checkbox";
  if (!images.length && !metadata.length && !page.imagesTruncated) return { include, imageText };

  const element = document.createElement("details"); element.className = "browser-capture-media";
  const summary = document.createElement("summary"); summary.textContent = t("Page images and details");
  element.append(summary);
  if (images.length || metadata.length) {
    const label = document.createElement("label");
    label.append(include, t("Include these details in the page note or chat draft"));
    const scroll = document.createElement("div"); scroll.className = "browser-capture-media-scroll";
    scroll.tabIndex = 0; scroll.setAttribute("role", "region"); scroll.setAttribute("aria-label", t("Page images and details"));
    if (metadata.length) {
      const list = document.createElement("dl");
      for (const [name, value] of metadata) {
        const term = document.createElement("dt"); term.textContent = name;
        const definition = document.createElement("dd"); definition.textContent = value;
        list.append(term, definition);
      }
      scroll.append(list);
    }
    if (images.length) scroll.append(imageList.element);
    element.append(label, scroll);
  }
  if (page.imagesTruncated) {
    const limit = document.createElement("p"); limit.textContent = t("Only some loaded images are shown.");
    element.append(limit);
  }
  return { include, element, imageText };
}
