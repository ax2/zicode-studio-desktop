import { t } from "../../i18n.js";
import { createBrowserCaptureImageList } from "./browser-capture-media.js";
import { createBrowserCaptureLinks } from "./browser-capture-links.js";
import { renderBrowserCaptureTables } from "./browser-capture-tables.js";
import { appendPartialCapture, isFrameTextIncomplete } from "./browser-capture-status.js";

const hasFrameLinks = frame => frame.links?.length || frame.linksTruncated;
const isFrameIncomplete = frame => isFrameTextIncomplete(frame) || frame.imagesTruncated || frame.linksTruncated;

export function selectCapturedFrames(frames = [], frameIndexes) {
  return frameIndexes ? frames.filter((_, index) => frameIndexes.includes(index)) : frames;
}

function paragraph(value) {
  const element = document.createElement("p");
  element.textContent = value;
  return element;
}

export function createBrowserCaptureFrames(page, recognizeImage, reviewImage) {
  const frames = page.frames ?? [];
  const imageLists = [];
  const imageText = () => imageLists.flatMap(list => list.imageText());
  const include = document.createElement("input"); include.type = "checkbox";
  const includeLinks = document.createElement("input"); includeLinks.type = "checkbox"; includeLinks.disabled = true;
  const multiple = frames.length > 1;
  const choices = frames.map(() => multiple ? document.createElement("input") : include);
  const selectedIndexes = () => choices.flatMap((choice, index) => choice.checked ? [index] : []);
  function updateSelection() {
    const selected = selectedIndexes();
    include.checked = selected.length === frames.length;
    include.indeterminate = selected.length > 0 && !include.checked;
    includeLinks.disabled = !selected.some(index => hasFrameLinks(frames[index]));
    if (includeLinks.disabled) includeLinks.checked = false;
  }
  function attachments() {
    const selected = selectedIndexes();
    if (!selected.length) return {};
    return {
      includeFrames: true,
      ...(selected.length === frames.length ? {} : { frameIndexes: selected }),
      ...(includeLinks.checked ? { includeFrameLinks: true } : {}),
    };
  }
  if (!frames.length && !page.framesOmitted) return { attachments, imageText };

  const element = document.createElement("details"); element.className = "browser-capture-frames";
  const summary = document.createElement("summary");
  summary.append(t("Page frames"), " (", String(frames.length), ")");
  if (page.framesOmitted || frames.some(isFrameIncomplete)) appendPartialCapture(summary);
  element.append(summary);
  if (frames.length) {
    const label = document.createElement("label");
    label.append(include, t(multiple ? "Include all embedded pages" : "Include frames in the page note or chat draft"));
    element.append(label);
    include.addEventListener("change", () => {
      for (const choice of choices) choice.checked = include.checked;
      updateSelection();
    });
    if (frames.some(hasFrameLinks)) {
      const linksLabel = document.createElement("label");
      linksLabel.append(includeLinks, t("Include links from embedded pages"));
      element.append(linksLabel);
    }
  }
  for (const [index, frame] of frames.entries()) {
    const details = document.createElement("details");
    const name = document.createElement("summary");
    const title = frame.title || frame.url || t("Inline frame");
    name.textContent = title;
    if (isFrameIncomplete(frame)) appendPartialCapture(name);
    details.append(name);
    if (multiple) {
      const choice = choices[index];
      choice.type = "checkbox";
      choice.setAttribute("aria-label", `${t("Include this embedded page")} · ${title}`);
      choice.addEventListener("change", updateSelection);
      const label = document.createElement("label");
      label.append(choice, t("Include this embedded page"));
      details.append(label);
    }
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
    const { element: links } = createBrowserCaptureLinks(frame, false);
    if (links) details.append(links);
    if (frame.tables?.length) details.append(renderBrowserCaptureTables(frame.tables));
    if (frame.textTruncated) details.append(paragraph(t("Page content was shortened")));
    if (frame.selectionTruncated) details.append(paragraph(t("Selected text was shortened")));
    if (frame.tablesTruncated) details.append(paragraph(t("Only some table data is shown.")));
    if (frame.images?.length) {
      const target = { title: frame.title, url: frame.url, locator: frame.imageLocator };
      const bound = action => action && frame.imageLocator && ((image, language) => action(image, target, language));
      const images = createBrowserCaptureImageList(frame.images, bound(recognizeImage), bound(reviewImage));
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
  return { attachments, element, imageText };
}
