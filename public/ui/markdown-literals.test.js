import { expect, it } from "vitest";
import { renderMarkdown } from "./markdown.js";
import { quotedPageText } from "../native/browser/browser-note-snapshot.js";
const render = text => { const div = document.createElement("div"); div.innerHTML = renderMarkdown(text); return div; };
it("renders clipped Markdown and HTML as readable literal text without active content", () => {
  const text = '![remote](https://tracker.invalid/image.png) <img src=x onerror=alert(1)> **bold** `code` [x](javascript:alert(1)) & 中文';
  const div = render(quotedPageText(text));
  expect(div.textContent).toBe(text); expect(div.querySelector("img,script,iframe,strong,code")).toBeNull();
  expect([...div.querySelectorAll("a")].every(a => !a.href.startsWith("javascript:"))).toBe(true);
});
it("keeps ordinary Markdown and literal code semantics", () => {
  const div = render('**bold** and `\\* &lt;` and &lt;tag&gt;');
  expect(div.querySelector("strong")?.textContent).toBe("bold");
  expect(div.querySelector("code")?.textContent).toBe("\\* &lt;");
  expect(div.textContent).toContain("<tag>"); expect(div.querySelector("tag")).toBeNull();
});
it("validates restored link schemes before emitting attributes", () => {
  const div = render('[bad](javascript\\:alert) ![bad](javascript\\:alert)');
  expect(div.querySelector("a")?.getAttribute("href")).toBe("");
  expect(div.querySelector("img")?.getAttribute("src")).toBe("");
});
it("does not confuse website text with internal literal tokens", () => {
  const text = "literal \uE0000\uE001 \uE000\uE0001\uE001 <tag>";
  expect(render(quotedPageText(text)).textContent).toBe(text);
});

it("keeps website list markers, separators and renderer-like tokens as text", () => {
  const text = "- item\n+ item\n1. item\n---\n===\n%%CODEBLOCK_0%%\n%%ICODE0%%";
  const div = render(quotedPageText(text));
  expect(div.querySelector("ul,ol,hr,pre")).toBeNull();
  for (const line of text.split("\n")) expect(div.textContent).toContain(line);
  expect(div.textContent).not.toContain("undefined");
});
