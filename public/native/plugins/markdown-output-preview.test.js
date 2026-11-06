import { afterEach, describe, expect, it } from "vitest";
import { setLocale, translateDocument } from "../../i18n.js";
import { createMarkdownOutputPreview } from "./markdown-output-preview.js";

const views = [];
async function render(html, isCurrent = () => true) {
  const container = document.createElement("main"); document.body.append(container);
  const view = await createMarkdownOutputPreview({ container, html, isCurrent }); views.push(view); return container;
}
afterEach(() => { for (const view of views.splice(0)) view.destroy(); document.body.replaceChildren(); setLocale("en"); });
describe("inert complete Markdown document preview", () => {
  it("reconstructs document structure without adopting resource-loading, navigation or event attributes", async () => {
    const html = '<!doctype html><html><head><title>private title</title><style>body{background:url(https://example.invalid/css)}</style></head><body><h1 id="clobber" onclick="alert(1)">Settings</h1><blockquote>quote</blockquote><ol start="4"><li>four</li></ol><table><thead><tr><th style="text-align:right;background:url(https://example.invalid/cell)">head</th></tr></thead><tbody><tr><td>cell</td></tr></tbody></table><p><strong>bold</strong><em>em</em><del>del</del><sup>1</sup><a href="https://example.invalid" target="_top" ping="https://example.invalid/ping">link</a><input type="checkbox" checked><input type="text" autofocus></p><pre><code>&lt;img src=x onerror=alert(1)&gt;</code></pre><img src="https://example.invalid/image"><iframe src="https://example.invalid/frame"></iframe><script>alert(1)</script><svg onload="alert(2)"></svg><form action="https://example.invalid"><button>submit</button></form></body></html>';
    const root = await render(html), doc = root.querySelector("article");
    for (const tag of ["h1", "blockquote", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "strong", "em", "del", "sup", "pre", "code"]) expect(doc.querySelector(tag)).not.toBeNull();
    expect(doc.querySelector("ol").getAttribute("start")).toBe("4"); expect(doc.querySelector("th").dataset.alignment).toBe("right");
    expect(doc.querySelector("h1").attributes.length).toBe(0);
    expect(doc.querySelector("script,img,iframe,svg,form,button,style,title,link,[src],[href],[onclick],[autofocus],[style]")).toBeNull();
    expect(doc.querySelector("input").disabled).toBe(true); expect(doc.querySelector("input").checked).toBe(true); expect(doc.querySelectorAll("input")).toHaveLength(1);
    expect(doc.querySelector("code").textContent).toBe("<img src=x onerror=alert(1)>");
    expect(doc.querySelector(".markdown-output-link").title).toBe("https://example.invalid"); expect(doc.textContent).not.toContain("alert(1)</script>");
    setLocale("zh-CN"); translateDocument(root);
    expect(doc.querySelector("h1").textContent).toBe("Settings");
    const details = root.querySelector("details"); details.open = true;
    root.querySelector("button").click(); const editor = root.querySelector("textarea");
    expect(editor.value).toBe(html); expect(editor.selectionEnd).toBe(html.length); expect(editor.readOnly).toBe(true);
    setLocale("en"); expect(editor.value).toBe(html); expect(editor.selectionEnd).toBe(html.length); expect(details.open).toBe(true);
  });
  it("keeps complete large text and complete HTML, with no preview-size substitute", async () => {
    const text = "a".repeat(2097152), html = `<!doctype html><pre><code>${text}</code></pre>`;
    const root = await render(html); expect(root.querySelector("code").textContent).toBe(text);
    root.querySelector("button").click(); expect(root.querySelector("textarea").value).toBe(html);
  });
  it("yields during large structures, preserves the complete structure and aborts expired work before adoption", async () => {
    const html = "<p>x</p>".repeat(1500);
    const root = await render(html); expect(root.querySelectorAll("article p")).toHaveLength(1500);
    const container = document.createElement("main"); let checks = 0;
    await expect(createMarkdownOutputPreview({ container, html, isCurrent: () => ++checks < 5 })).rejects.toThrow("preview_expired");
    expect(container.childNodes).toHaveLength(0);
  });
});
