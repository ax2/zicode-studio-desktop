import { t } from "../../i18n.js";

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

export function createBrowserCaptureMedia(page) {
  const images = page.images ?? [];
  const metadata = pageMetadataRows(page.metadata);
  const include = document.createElement("input"); include.type = "checkbox";
  if (!images.length && !metadata.length && !page.imagesTruncated) return { include };

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
    if (images.length) {
      const list = document.createElement("ul"); list.setAttribute("aria-label", t("Page images"));
      for (const image of images) {
        const item = document.createElement("li"); item.textContent = pageImageDescription(image);
        list.append(item);
      }
      scroll.append(list);
    }
    element.append(label, scroll);
  }
  if (page.imagesTruncated) {
    const limit = document.createElement("p"); limit.textContent = t("Only some loaded images are shown.");
    element.append(limit);
  }
  return { include, element };
}
