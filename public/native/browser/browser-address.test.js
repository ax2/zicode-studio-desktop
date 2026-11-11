import { expect, it } from "vitest";
import { resolveBrowserAddress } from "./browser-address.js";
it.each([
  ["bing", "https://www.bing.com/search", "q"], ["baidu", "https://www.baidu.com/s", "wd"],
  ["google", "https://www.google.com/search", "q"], ["duckDuckGo", "https://duckduckgo.com/", "q"],
])("encodes search text without interpreting URL parameters for %s", (engine, base, key) => {
  const input = "中文 & a+b # ? x=1"; const result = new URL(resolveBrowserAddress(input, engine));
  expect(result.origin + result.pathname).toBe(base); expect([...result.searchParams]).toEqual([[key, input]]);
});
it.each(["example.org/path?q=a", "localhost:3000/a", "192.168.1.1", "[::1]:8080", "printer:8080", "example.local"])('keeps address %s for Host policy instead of searching it', input => {
  expect(resolveBrowserAddress(input)).toBe(new URL(`https://${input}`).href);
});
it.each(["about:blank", "http://example.org/", "https://例子.com/path"])('preserves explicit web address %s', input => {
  expect(resolveBrowserAddress(input)).toBe(new URL(input).href);
});
it.each(["hello", "你好世界", "site:example.com", "filetype:pdf browser", "C++ programming"])('searches %s', input => {
  expect(new URL(resolveBrowserAddress(input)).searchParams.get("q")).toBe(input);
});
it.each(["javascript:alert(1)", "file:///C:/notes", "C:\\Users\\private.txt", "\\\\server\\private", "/home/notes", "data:text/html,hi", "mailto:private@example.org", "https://alice:secret@example.org", "https://", "https://bad host", "x\u0000y", "字".repeat(1366)])('rejects invalid or local input without searching', input => {
  expect(() => resolveBrowserAddress(input)).toThrow();
});
