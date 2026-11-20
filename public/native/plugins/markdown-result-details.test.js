import { expect, it } from "vitest";
import { setLocale } from "../../i18n.js";
import { createMarkdownResultDetails } from "./markdown-result-details.js";
it("keeps the exact diagnostic value collapsed, changes only the label and restores the owning node on disposal", () => {
  setLocale("en"); const host = document.createElement("div"), raw = document.createElement("pre"); host.append(raw);
  const value='{"ok":true,"inputBytes":0}'; raw.textContent=value;
  expect(createMarkdownResultDetails({raw})).toBeNull();
  const view=createMarkdownResultDetails({raw,executionProfile:"resource.wasi.markdown.v1"});
  expect(host.querySelector("details").hidden).toBe(true);view.show();expect(host.querySelector("details").open).toBe(false);
  expect(host.querySelector("pre")).toBe(raw);setLocale("zh-CN");expect(host.querySelector("summary").textContent).toBe("执行详情");expect(raw.textContent).toBe(value);
  host.querySelector("details").open=true;view.clear();expect(host.querySelector("details").hidden).toBe(true);expect(host.querySelector("details").open).toBe(false);
  view.destroy();expect(host.querySelector("details")).toBeNull();expect(host.firstChild).toBe(raw);setLocale("en");
});
