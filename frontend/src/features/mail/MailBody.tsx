import { createElement, useMemo, type ReactNode } from "react";
import { t } from "../../shared/i18n";

const formatting = new Set("p div span br hr b strong i em u s small sub sup h1 h2 h3 h4 h5 h6 ul ol li blockquote pre code table thead tbody tfoot tr th td".split(" "));
const skip = new Set("script style template head title noscript iframe object embed form input button select textarea audio video source link meta base".split(" "));

function formatBody(html: string): ReactNode {
  // Template contents belong to an inert document. Only new, attribute-free
  // React elements and text are placed in the application document.
  const template = document.createElement("template");
  template.innerHTML = html;
  let remaining = 20000;
  let readable = false;
  function children(parent: ParentNode, depth: number): ReactNode[] {
    const result: ReactNode[] = [];
    for (let node = parent.firstChild; node; node = node.nextSibling) {
      if (--remaining < 0 || depth > 64) throw new RangeError("mail_body_too_complex");
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? "";
        if (text.trim()) readable = true;
        result.push(text);
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const element = node as Element;
      const tag = element.localName;
      if (element.namespaceURI !== "http://www.w3.org/1999/xhtml" || skip.has(tag)) continue;
      if (tag === "img") {
        const alt = element.getAttribute("alt") ?? "";
        if (alt.trim()) readable = true;
        result.push(alt || t("Image blocked"));
      } else if (tag === "br" || tag === "hr") {
        result.push(createElement(tag, { key: result.length }));
      } else {
        const content = children(element, depth + 1);
        if (formatting.has(tag)) result.push(createElement(tag, { key: result.length }, content));
        else result.push(content);
      }
    }
    return result;
  }
  try {
    const content = children(template.content, 0);
    return readable ? content : null;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export function MailBody({ text, html }: { text: string | null; html?: string | null }) {
  const formatted = useMemo(() => html ? formatBody(html) : null, [html]);
  if (formatted) return <div className="mail-read-body" translate="no">{formatted}</div>;
  if (text === null) return <p>{t("This email has no plain-text body. Remote content is not loaded.")}</p>;
  return <pre className="mail-read-body" translate="no">{text || t("Empty message")}</pre>;
}
