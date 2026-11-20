import { t } from "../../i18n.js";

const allowed = new Set("h1 h2 h3 h4 h5 h6 p em strong del pre code blockquote ul ol li table thead tbody tr th td hr br div span sup a input".split(" "));
const omitted = new Set("head title style script link meta base iframe object embed svg math template noscript".split(" "));

// Template contents stay inert and are never adopted into the live document.
// Only newly created, allowlisted elements and text cross into the preview.
export async function createMarkdownOutputPreview({ container, html, isCurrent }) {
  const source = document.createElement("template"); source.innerHTML = html;
  const article = document.createElement("article"); article.className = "markdown-output-document"; article.setAttribute("translate", "no");
  const pending = [{ nodes: source.content.childNodes, parent: article, index: 0 }];
  let visited = 0;
  while (pending.length) {
    if (!isCurrent()) throw new Error("preview_expired");
    const frame = pending[pending.length - 1];
    if (frame.index >= frame.nodes.length) { pending.pop(); continue; }
    const child = frame.nodes[frame.index++];
    if (++visited > 600000) throw new Error("preview_structure_invalid");
    if (child.nodeType === Node.TEXT_NODE) frame.parent.append(document.createTextNode(child.nodeValue));
    else if (child.nodeType === Node.ELEMENT_NODE && child.namespaceURI === "http://www.w3.org/1999/xhtml") {
      const tag = child.localName;
      if (omitted.has(tag)) continue;
      let parent = frame.parent;
      if (allowed.has(tag)) {
        if (tag === "input" && child.getAttribute("type") !== "checkbox") continue;
        const element = document.createElement(tag === "a" ? "span" : tag);
        if (tag === "a") { element.className = "markdown-output-link"; element.title = child.getAttribute("href") ?? ""; }
        if (tag === "input") { element.type = "checkbox"; element.disabled = true; element.checked = child.hasAttribute("checked"); }
        if (tag === "ol" && /^\d{1,20}$/.test(child.getAttribute("start") ?? "")) element.setAttribute("start", child.getAttribute("start"));
        if (["th", "td"].includes(tag) && ["left", "center", "right"].includes(child.style.textAlign)) element.dataset.alignment = child.style.textAlign;
        parent.append(element); parent = element;
      }
      pending.push({ nodes: child.childNodes, parent, index: 0 });
    }
    if (visited % 1024 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (!isCurrent()) throw new Error("preview_expired");
  const panel = document.createElement("section"); panel.className = "markdown-output-preview";
  const heading = document.createElement("h3"), notice = document.createElement("p"), details = document.createElement("details"), summary = document.createElement("summary");
  const editor = document.createElement("textarea"), select = document.createElement("button");
  editor.className = "ui-textarea"; editor.readOnly = true; editor.rows = 8; editor.spellcheck = false; editor.setAttribute("translate", "no");
  select.type = "button"; select.className = "ui-button ui-button--secondary";
  const loadHtml = () => { if (!editor.value) editor.value = html; };
  details.addEventListener("toggle", () => { if (details.open) loadHtml(); });
  select.addEventListener("click", () => { loadHtml(); editor.focus(); editor.select(); });
  const refresh = () => {
    heading.textContent = t("Document preview"); notice.textContent = t("Links and images stay inactive in this preview. Save the complete HTML separately.");
    summary.textContent = t("View complete HTML"); select.textContent = t("Select entire HTML"); editor.setAttribute("aria-label", t("Complete HTML document"));
  };
  refresh(); window.addEventListener("zicode:locale-changed", refresh);
  details.append(summary, select, editor); panel.append(heading, notice, article, details); container.replaceChildren(panel);
  return { destroy() { window.removeEventListener("zicode:locale-changed", refresh); panel.remove(); } };
}
