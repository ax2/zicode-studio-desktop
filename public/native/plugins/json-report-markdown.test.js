import { expect, it } from "vitest";
import { renderMarkdown } from "../../ui/markdown.js";
import { jsonReportMarkdown } from "./json-report-markdown.js";

it("keeps triple-backtick report text inside the actual note renderer code block", () => {
  const report = { name: "before```\n# misleading\n<img src=x> [link](https://example.com)", unicode: "😀" };
  const text = jsonReportMarkdown(JSON.stringify(report, null, 2));
  const container = document.createElement("div"); container.innerHTML = renderMarkdown(text);
  expect(container.querySelectorAll("pre")).toHaveLength(1);
  expect(container.querySelector("h1")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("a")).toBeNull();
  expect(JSON.parse(container.querySelector("code").textContent)).toEqual(report);
});
