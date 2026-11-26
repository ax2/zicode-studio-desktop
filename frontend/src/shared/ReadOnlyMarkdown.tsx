import { createElement, useMemo, type ReactNode } from "react";
// @ts-expect-error The shared JavaScript renderer has no TypeScript declarations.
import { renderMarkdown } from "../../../public/ui/markdown.js";

const formatting = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "del",
  "blockquote",
  "pre",
  "code",
  "br",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
]);

// Keep the renderer's formatting while building a fresh tree with no source attributes,
// embedded content, or code-copy controls. Template content is inert until inserted.
function safeNode(node: Node, key: number, allowLinks: boolean): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as Element;
  const tag = element.localName;
  if (tag === "img") return element.getAttribute("alt");
  if (["script", "style", "button", "iframe", "object", "svg", "math"].includes(tag)) return null;
  const children = Array.from(element.childNodes, (child, index) =>
    safeNode(child, index, allowLinks),
  );
  if (tag === "a" && allowLinks) {
    try {
      const url = new URL(element.getAttribute("href") || "");
      if (url.protocol === "https:" || url.protocol === "http:") {
        return (
          <a key={key} href={url.href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      }
    } catch {
      /* Display the label for incomplete or relative links. */
    }
    return children;
  }
  if (tag === "br" || tag === "hr") return createElement(tag, { key });
  return formatting.has(tag) ? createElement(tag, { key }, children) : children;
}

export function ReadOnlyMarkdown({
  body,
  allowLinks = false,
}: {
  body: string;
  allowLinks?: boolean;
}) {
  const content = useMemo(() => {
    const template = document.createElement("template");
    template.innerHTML = renderMarkdown(body);
    return Array.from(template.content.childNodes, (child, index) =>
      safeNode(child, index, allowLinks),
    );
  }, [body, allowLinks]);
  return (
    <div className="markdown-body" translate="no">
      {content}
    </div>
  );
}
