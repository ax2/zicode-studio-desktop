import { t } from "../../i18n.js";

const textElement = (tag, text) => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};

export function showBrowserReader(page, onClose) {
  const dialog = document.createElement("dialog");
  dialog.className = "browser-reader-dialog ui-panel";
  dialog.setAttribute("aria-label", t("Reading mode"));
  const header = document.createElement("header");
  header.className = "browser-reader-header";
  const controls = document.createElement("div");
  const button = (label, text, action) => {
    const control = textElement("button", text);
    control.type = "button";
    control.className = "ui-button ui-button--secondary ui-button--sm";
    control.title = t(label);
    control.setAttribute("aria-label", control.title);
    control.addEventListener("click", action);
    return control;
  };
  let size = 1;
  const smaller = button("Smaller reading text", "A−", () => resize(-1));
  const larger = button("Larger reading text", "A+", () => resize(1));
  const close = button("Close", t("Close"), () => dialog.close());
  function resize(step) {
    size = Math.max(0, Math.min(3, size + step));
    dialog.dataset.readerSize = String(size);
    smaller.disabled = size === 0;
    larger.disabled = size === 3;
  }
  controls.append(smaller, larger, close);
  header.append(textElement("span", t("Reading mode")), controls);
  const scroll = document.createElement("div");
  scroll.className = "browser-reader-scroll";
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", t("Page content"));
  const article = document.createElement("article");
  const source = textElement("p", page.url);
  source.className = "browser-reader-source";
  article.append(textElement("h1", page.title || t("Page content")), source);
  let list;
  for (const { kind, text } of page.blocks) {
    if (kind === "ordered" || kind === "bullet") {
      const tag = kind === "ordered" ? "ol" : "ul";
      if (list?.localName !== tag) { list = document.createElement(tag); article.append(list); }
      list.append(textElement("li", text));
      continue;
    }
    list = null;
    const tag = { h1: "h2", h2: "h2", h3: "h3", h4: "h4", h5: "h5", h6: "h6", code: "pre", quote: "blockquote" }[kind] ?? "p";
    article.append(textElement(tag, text));
  }
  if (page.truncated) article.append(textElement("p", t("Page content was shortened")));
  scroll.append(article);
  dialog.append(header, scroll);
  dialog.addEventListener("close", () => { dialog.remove(); onClose(); }, { once: true });
  document.body.append(dialog);
  try { dialog.showModal(); }
  catch (error) { dialog.remove(); throw error; }
  scroll.focus({ preventScroll: true });
}
