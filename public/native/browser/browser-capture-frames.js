import { t } from "../../i18n.js";
import { createBrowserCaptureImageList } from "./browser-capture-media.js";
import { renderBrowserCaptureTables } from "./browser-capture-tables.js";

function paragraph(value) {
  const element = document.createElement("p");
  element.textContent = value;
  return element;
}

export function createBrowserCaptureFrames(page, recognizeImage) {
  const frames = page.frames ?? [];
  const imageLists = [];
  const imageText = () => imageLists.flatMap(list => list.imageText());
  const include = document.createElement("input"); include.type = "checkbox";
  if (!frames.length && !page.framesOmitted) return { include, imageText };

  const element = document.createElement("details"); element.className = "browser-capture-frames";
  const summary = document.createElement("summary");
  summary.append(t("Page frames"), " (", String(frames.length), ")");
  element.append(summary);
  if (frames.length) {
    const label = document.createElement("label");
    label.append(include, t("Include frames in the page note or chat draft"));
    element.append(label);
  }
  for (const frame of frames) {
    const details = document.createElement("details");
    const name = document.createElement("summary");
    name.textContent = frame.title || frame.url || t("Inline frame");
    details.append(name);
    const source = paragraph(frame.url || t("Inline frame"));
    source.setAttribute("translate", "no");
    details.append(source);
    if (frame.selection) details.append(paragraph(t("Selected text")), paragraph(frame.selection));
    if (frame.text) {
      const text = document.createElement("textarea");
      text.className = "ui-textarea browser-capture-text";
      text.readOnly = true;
      text.setAttribute("aria-label", t("Frame content"));
      text.value = frame.text;
      details.append(text);
    }
    if (frame.tables?.length) details.append(renderBrowserCaptureTables(frame.tables));
    if (frame.textTruncated) details.append(paragraph(t("Page content was shortened")));
    if (frame.selectionTruncated) details.append(paragraph(t("Selected text was shortened")));
    if (frame.tablesTruncated) details.append(paragraph(t("Only some table data is shown.")));
    if (frame.images?.length) {
      const recognize = recognizeImage && frame.imageLocator && (image => recognizeImage(image, {
        title: frame.title, url: frame.url, locator: frame.imageLocator,
      }));
      const images = createBrowserCaptureImageList(frame.images, recognize);
      const scroll = document.createElement("div");
      scroll.className = "browser-capture-media-scroll";
      scroll.append(images.element);
      details.append(scroll);
      imageLists.push(images);
    }
    if (frame.imagesTruncated) details.append(paragraph(t("Only some loaded images are shown.")));
    element.append(details);
  }
  if (page.framesOmitted) element.append(paragraph(t("Some frames were unavailable or exceeded capture limits.")));
  return { include, element, imageText };
}
