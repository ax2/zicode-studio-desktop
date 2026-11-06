import { afterEach, expect, it } from "vitest";
import { createDomTranslator } from "./i18n-dom.js";

afterEach(() => document.body.replaceChildren());
function fixture(html) {
  document.body.innerHTML = html;
  let locale = "zh";
  const translator = createDomTranslator(text => locale === "zh" ? ({ Settings: "设置", Copy: "复制", Tools: "工具" }[text] ?? text) : text);
  return { translator, sync: () => translator.translateDocument(document.body), locale: next => { locale = next; } };
}

it("keeps inherited user text and its title while translating neighboring controls", () => {
  const c = fixture('<article translate="no"><h1 title="Settings">Settings</h1><p>Tools</p><button translate="yes">Copy</button></article><button>Settings</button>');
  c.sync();
  expect(document.querySelector("h1").textContent).toBe("Settings");
  expect(document.querySelector("h1").title).toBe("Settings");
  expect(document.querySelector("p").textContent).toBe("Tools");
  expect([...document.querySelectorAll("button")].map(e => e.textContent)).toEqual(["复制", "设置"]);
  c.locale("en"); c.sync();
  expect([...document.querySelectorAll("button")].map(e => e.textContent)).toEqual(["Copy", "Settings"]);
});

it("honors the nearest valid declaration including empty yes and inherited invalid values", () => {
  const c = fixture('<div translate="NO"><span translate="invalid">Settings</span><b translate="">Copy</b><i translate="YeS">Tools</i></div>');
  c.sync();
  expect(document.querySelector("span").textContent).toBe("Settings");
  expect(document.querySelector("b").textContent).toBe("复制");
  expect(document.querySelector("i").textContent).toBe("工具");
});

it("preserves raw code and result text including syntax highlighting spans", () => {
  const c = fixture('<main translate="yes"><pre>Settings</pre><code><span>Tools</span></code><p><code>Copy</code></p></main>');
  c.sync();
  expect(document.querySelector("pre").textContent).toBe("Settings");
  expect([...document.querySelectorAll("code")].map(e => e.textContent)).toEqual(["Tools", "Copy"]);
});

it("protects textarea defaults and editable descendants but localizes their UI attributes", () => {
  const c = fixture('<textarea aria-label="Tools" placeholder="Settings">Settings</textarea><div contenteditable="true"><span>Tools</span></div><section contenteditable="plaintext-only">Copy</section>');
  const input = document.querySelector("textarea");
  input.focus(); input.setSelectionRange(1, 4); c.sync();
  expect(input.defaultValue).toBe("Settings"); expect(input.value).toBe("Settings");
  expect(input.getAttribute("aria-label")).toBe("工具"); expect(input.placeholder).toBe("设置");
  expect(input.selectionStart).toBe(1); expect(input.selectionEnd).toBe(4);
  expect(document.querySelector("[contenteditable=true]").textContent).toBe("Tools");
  expect(document.querySelector("section").textContent).toBe("Copy");
});

it("lets a non-editable toolbar localize inside an editor", () => {
  const c = fixture('<div contenteditable="true"><span contenteditable="invalid">Settings</span><button contenteditable="false">Copy</button></div>');
  c.sync();
  expect(document.querySelector("span").textContent).toBe("Settings");
  expect(document.querySelector("button").textContent).toBe("复制");
});

it("guards direct added text nodes used by the shell's mutation observer", () => {
  const c = fixture('<article translate="no"></article><script></script><pre></pre>');
  for (const tag of ["article", "script", "pre"]) {
    const text = document.createTextNode("Settings"); document.querySelector(tag).append(text);
    c.translator.translateTextNode(text); expect(text.nodeValue).toBe("Settings");
  }
});

it("adopts the current source after protected content replaces a previously translated node", () => {
  const c = fixture('<p title="Settings">Settings</p>'), p = document.querySelector("p");
  c.sync(); p.setAttribute("translate", "no"); p.firstChild.nodeValue = "Tools"; p.title = "Tools"; c.sync();
  c.locale("en"); c.sync(); expect(p.textContent).toBe("Tools"); expect(p.title).toBe("Tools");
  p.removeAttribute("translate"); c.locale("zh"); c.sync();
  expect(p.textContent).toBe("工具"); expect(p.title).toBe("工具");
  c.locale("en"); c.sync(); expect(p.textContent).toBe("Tools"); expect(p.title).toBe("Tools");
});

it("uses declared product labels from a Chinese initial render without translating protected text", () => {
  const c = fixture('<article translate="no"><p data-i18n-text="Tools">Settings</p><button translate="yes" data-i18n-text="Copy" data-i18n-title="Tools" title="工具">复制</button></article>');
  const button = document.querySelector("button");
  c.sync(); c.locale("en"); c.sync();
  expect(button.textContent).toBe("Copy"); expect(button.title).toBe("Tools");
  expect(document.querySelector("p").textContent).toBe("Settings");
  button.dataset.i18nText = "Settings"; button.firstChild.nodeValue = "设置";
  c.sync(); expect(button.textContent).toBe("Settings");
  c.locale("zh"); c.sync(); expect(button.textContent).toBe("设置");
});
