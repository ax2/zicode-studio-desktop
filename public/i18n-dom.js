import { canTranslate } from "./i18n-content-policy.js";

// Reused React/vanilla nodes may receive a new source value after translation.
// Remember our own last write so a later render is adopted, never overwritten
// with the stale original. Literal Chinese content is not reverse-translated.
export function createDomTranslator(lookup) {
  const textSources = new WeakMap();
  const attributeSources = new WeakMap();
  const attributes = ["title", "aria-label", "placeholder"];

  function translateTextNode(node) {
    if (!canTranslate(node.parentElement, { text: true })) {
      textSources.delete(node);
      return;
    }
    const current = node.nodeValue ?? "";
    const declared = node.parentElement.childNodes.length === 1
      ? node.parentElement.getAttribute("data-i18n-text") : null;
    let entry = textSources.get(node);
    if (!entry || current !== entry.last || (declared !== null && declared !== entry.source)) {
      entry = { source: declared ?? current, last: current };
      textSources.set(node, entry);
    }
    const trimmed = entry.source.trim();
    if (!trimmed) return;
    const next = entry.source.replace(trimmed, lookup(trimmed));
    if (current !== next) node.nodeValue = next;
    entry.last = next;
  }

  function translateElement(element) {
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
    }
    if (!canTranslate(element)) {
      attributeSources.delete(element);
      return;
    }
    let sources = attributeSources.get(element);
    if (!sources) { sources = new Map(); attributeSources.set(element, sources); }
    for (const attribute of attributes) {
      if (!element.hasAttribute(attribute)) { sources.delete(attribute); continue; }
      const current = element.getAttribute(attribute);
      const declared = element.getAttribute(`data-i18n-${attribute}`);
      let entry = sources.get(attribute);
      if (!entry || current !== entry.last || (declared !== null && declared !== entry.source)) {
        entry = { source: declared ?? current, last: current };
        sources.set(attribute, entry);
      }
      const next = lookup(entry.source);
      if (current !== next) element.setAttribute(attribute, next);
      entry.last = next;
    }
  }

  return {
    translateTextNode,
    translateDocument(root) {
      if (!root) return;
      if (root instanceof Element) translateElement(root);
      for (const element of root.querySelectorAll("*")) translateElement(element);
    },
  };
}
