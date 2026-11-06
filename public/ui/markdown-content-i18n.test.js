import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../i18n.js";
import { initCodeCopyDelegation, renderMarkdown } from "./markdown.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers(); vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  setLocale("zh-CN");
});

it.each(["en", "zh-CN"])("keeps content exact and copy controls localized from %s", async initialLocale => {
  vi.useFakeTimers();
  setLocale(initialLocale);
  document.body.innerHTML = '<article translate="no"></article>';
  const article = document.querySelector("article");
  article.innerHTML = renderMarkdown('# Settings\n\nTools\n\n`Copy`\n\n```Settings\nSettings\n```');
  const code = article.querySelector("pre code"), button = article.querySelector("[data-copy-code]");
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  initCodeCopyDelegation(article);
  for (const locale of ["zh-CN", "en", "zh-CN"]) {
    setLocale(locale);
    expect(article.querySelector("h1").textContent).toBe("Settings");
    expect(article.querySelector("p").textContent).toBe("Tools");
    expect(article.querySelector("p code").textContent).toBe("Copy");
    expect(article.querySelector(".code-language").textContent).toBe("Settings");
    expect(code.textContent).toBe("Settings");
    expect(button.textContent).toBe(locale === "en" ? "Copy" : "复制");
    expect(article.querySelector("pre code")).toBe(code);
  }
  button.click(); await vi.advanceTimersByTimeAsync(0);
  expect(writeText).toHaveBeenCalledWith("Settings");
  expect(article.querySelector(".code-copy-status").textContent).toBe("代码已复制");
  setLocale("en");
  expect(button.textContent).toBe("Copied");
  expect(article.querySelector(".code-copy-status").textContent).toBe("Code copied");
  vi.runAllTimers();
  expect(button.textContent).toBe("Copy");
});
