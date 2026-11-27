import { t } from "../../i18n.js";

const textElement = (tag, text) => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};

export function showBrowserReader(page, onClose, position = {}) {
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
  let size = position.size ?? 1;
  let scrollTop = position.scrollTop ?? 0;
  const smaller = button("Smaller reading text", "A−", () => resize(-1));
  const larger = button("Larger reading text", "A+", () => resize(1));
  const close = button("Close", t("Close"), closeReader);
  function paintSize() {
    dialog.dataset.readerSize = String(size);
    smaller.setAttribute("aria-disabled", String(size === 0));
    larger.setAttribute("aria-disabled", String(size === 3));
  }
  function resize(step) {
    const next = Math.max(0, Math.min(3, size + step));
    if (next === size) return;
    const anchor = scroll.scrollTop ? reflowReadingAnchor() : undefined;
    size = next;
    paintSize();
    restoreReadingAnchor(anchor);
    rememberReflowPosition();
  }
  function readingAnchor() {
    const viewportTop = scroll.getBoundingClientRect().top;
    for (const block of readingBlocks) {
      const { left, top, bottom, height } = block.getBoundingClientRect();
      if (bottom > viewportTop) return { block, viewportTop, offset: viewportTop - top, left, top, height };
    }
  }
  function reflowReadingAnchor() {
    const anchor = readingAnchor();
    if (!anchor) return;
    const { left, top, height } = anchor;
    // The text position survives line wrapping, including in long paragraphs and code blocks.
    const style = getComputedStyle(anchor.block);
    const x = left + parseFloat(style.borderLeftWidth || "0") + parseFloat(style.paddingLeft || "0") + 1;
    const y = Math.max(anchor.viewportTop + 1, top + Math.min(8, height / 2));
    let range;
    if (typeof document.caretPositionFromPoint === "function") {
      const caret = document.caretPositionFromPoint(x, y);
      if (caret) {
        range = document.createRange();
        range.setStart(caret.offsetNode, caret.offset);
      }
    } else {
      range = document.caretRangeFromPoint?.(x, y);
    }
    if (!range || range.startContainer.nodeType !== Node.TEXT_NODE || !anchor.block.contains(range.startContainer)) return anchor;
    const line = range.getBoundingClientRect();
    return line.height ? { ...anchor, range, lineOffset: line.top - anchor.viewportTop } : anchor;
  }
  function restoreReadingAnchor(anchor) {
    if (!anchor) return;
    const viewportTop = scroll.getBoundingClientRect().top;
    const line = anchor.range?.getBoundingClientRect();
    if (line?.height) {
      scroll.scrollTop += line.top - viewportTop - anchor.lineOffset;
      return;
    }
    const { top, height } = anchor.block.getBoundingClientRect();
    const offset = anchor.offset > 0 && anchor.height ? anchor.offset * height / anchor.height : anchor.offset;
    scroll.scrollTop += top + offset - viewportTop;
  }
  function storedReflowAnchor() {
    if (!reflowAnchor) return;
    const { block, offset, height, range, lineOffset } = reflowAnchor;
    return {
      index: readingBlocks.indexOf(block),
      text: block.textContent,
      offset,
      height,
      textOffset: range?.startOffset,
      lineOffset,
    };
  }
  function restoreSavedAnchor(saved) {
    if (!saved) return;
    const { index, text, offset, height, textOffset, lineOffset } = saved;
    const block = readingBlocks[index];
    if (!block || block.textContent !== text) return;
    let range;
    const node = block.firstChild;
    if (textOffset !== undefined && node?.nodeType === Node.TEXT_NODE && textOffset <= node.length) {
      range = document.createRange();
      range.setStart(node, textOffset);
    }
    return { block, offset, height, range, lineOffset };
  }
  paintSize();
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
  const readingBlocks = Array.from(article.querySelectorAll(":scope > :not(ol, ul), :scope > :is(ol, ul) > li"));
  scroll.append(article);
  dialog.append(header, scroll);
  const rememberPosition = () => { scrollTop = scroll.scrollTop; };
  let observedWidth, reflowAnchor;
  function rememberReflowPosition() {
    rememberPosition();
    observedWidth = scroll.clientWidth;
    reflowAnchor = scrollTop ? reflowReadingAnchor() : undefined;
  }
  scroll.addEventListener("scroll", () => {
    // Keep the pre-reflow anchor even if the width change itself fires a scroll event.
    if (scroll.scrollTop !== scrollTop && scroll.clientWidth === observedWidth) rememberReflowPosition();
  });
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
    const width = scroll.clientWidth;
    if (!width || width === observedWidth) return;
    observedWidth = width;
    restoreReadingAnchor(reflowAnchor);
    rememberPosition();
  }) : undefined;
  function rememberBeforeClose() {
    if (scroll.scrollTop !== scrollTop && scroll.clientWidth === observedWidth) rememberReflowPosition();
    else rememberPosition();
  }
  // Capture before native Escape closes the dialog and the scroll box no longer has layout.
  dialog.addEventListener("cancel", rememberBeforeClose);
  function finishClose() {
    if (!dialog.isConnected) return;
    observer?.disconnect();
    const anchor = storedReflowAnchor();
    dialog.remove();
    onClose({ scrollTop, size, width: observedWidth, anchor });
  }
  function closeReader() {
    if (dialog.open) {
      rememberBeforeClose();
      dialog.close();
    }
    // Close events can be deferred until after Browser has been reactivated.
    finishClose();
  }
  dialog.addEventListener("close", finishClose, { once: true });
  document.body.append(dialog);
  try { dialog.showModal(); }
  catch (error) { dialog.remove(); throw error; }
  scroll.focus({ preventScroll: true });
  scroll.scrollTop = scrollTop;
  reflowAnchor = restoreSavedAnchor(position.anchor);
  if (reflowAnchor) {
    observedWidth = scroll.clientWidth;
    if (observedWidth !== position.width) restoreReadingAnchor(reflowAnchor);
    rememberPosition();
  } else {
    rememberReflowPosition();
  }
  observer?.observe(scroll);
  return { close: closeReader };
}
