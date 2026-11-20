import { afterEach, expect, it, vi } from "vitest";
import { createDomTranslator } from "./i18n-dom.js";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function fixture(markup = "<button>工具</button>") {
  document.body.innerHTML = markup;
  let locale = "zh";
  const chinese = { Tools: "工具", Settings: "设置", "Input text": "输入文本", Favorite: "收藏", "Remove favorite": "取消收藏" };
  const translator = createDomTranslator(source => locale === "zh" ? chinese[source] ?? source : source);
  return { sync: () => translator.translateDocument(document.body), locale: value => { locale = value; } };
}

it("adopts a reused node's new React text instead of restoring its first localized value", () => {
  const c = fixture(), button = document.querySelector("button"), node = button.firstChild;
  c.sync(); c.locale("en"); node.nodeValue = "Tools"; c.sync(); expect(button.textContent).toBe("Tools");
  c.locale("zh"); c.sync(); expect(button.textContent).toBe("工具");
  c.locale("en"); c.sync(); expect(button.textContent).toBe("Tools"); expect(button.firstChild).toBe(node);
});

it("preserves a canonical English source across repeated translation passes", () => {
  const c = fixture("<button>Settings</button>"); c.sync(); c.sync(); expect(document.body.textContent).toBe("设置");
  c.locale("en"); c.sync(); c.sync(); expect(document.body.textContent).toBe("Settings");
  c.locale("zh"); c.sync(); expect(document.body.textContent).toBe("设置");
});

it("adopts changed attributes on the same input without retaining a stale translated source", () => {
  const c = fixture('<input aria-label="输入文本" title="工具" placeholder="输入文本">'), input = document.querySelector("input");
  input.value = "用户输入 Settings 不能改"; input.focus(); input.setSelectionRange(2, 7); c.sync();
  c.locale("en"); input.setAttribute("aria-label", "Input text"); input.setAttribute("title", "Tools"); input.setAttribute("placeholder", "Input text"); c.sync();
  expect(input.getAttribute("aria-label")).toBe("Input text"); expect(input.title).toBe("Tools"); expect(input.placeholder).toBe("Input text");
  c.locale("zh"); c.sync(); expect(input.getAttribute("aria-label")).toBe("输入文本");
  c.locale("en"); c.sync(); expect(input.title).toBe("Tools"); expect(input.value).toBe("用户输入 Settings 不能改");
  expect(input.selectionStart).toBe(2); expect(input.selectionEnd).toBe(7); expect(document.activeElement).toBe(input);
});

it("keeps a dynamic action's new meaning on the same text node", () => {
  const c = fixture("<button>Favorite</button>"), node = document.querySelector("button").firstChild; c.sync();
  node.nodeValue = "Remove favorite"; c.sync(); expect(node.nodeValue).toBe("取消收藏");
  c.locale("en"); c.sync(); expect(node.nodeValue).toBe("Remove favorite");
});

it("never reverse-translates literal Chinese or reverts a newly rendered result to its first value", () => {
  const c = fixture("<p>设置</p><pre>first result</pre>"); c.sync(); c.locale("en"); c.sync();
  expect(document.querySelector("p").textContent).toBe("设置");
  const node = document.querySelector("pre").firstChild; node.nodeValue = "new result 中文"; c.sync();
  c.locale("zh"); c.sync(); expect(node.nodeValue).toBe("new result 中文");
});

it("preserves leading/trailing whitespace and excludes executable/style text", () => {
  const c = fixture("<button>  Settings\n</button><script>Settings</script><style>Tools</style>"); c.sync();
  expect(document.querySelector("button").textContent).toBe("  设置\n");
  expect(document.querySelector("script").textContent).toBe("Settings"); expect(document.querySelector("style").textContent).toBe("Tools");
});

it("does not rewrite unchanged DOM values on repeated layout or localization passes", async () => {
  const c = fixture('<button title="Tools">Settings</button>'); c.sync();
  const records = [], observer = new MutationObserver(changes => records.push(...changes));
  observer.observe(document.body, { subtree: true, characterData: true, attributes: true });
  c.sync(); c.sync(); await Promise.resolve(); observer.disconnect(); expect(records).toHaveLength(0);
});
