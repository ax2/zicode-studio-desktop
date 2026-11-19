import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const script = readFileSync("src-tauri/src/browser/capture.js", "utf8");

function capture(title, body, selection) {
  const parentElement = { closest: () => null, getClientRects: () => [{}] };
  const textNode = { nodeType: 3, nodeValue: body, parentElement };
  const range = { startContainer: textNode, endContainer: textNode };
  const nodes = [textNode];
  return runInNewContext(script, {
    document: {
      title, body: parentElement, documentElement: {}, links: [], images: [],
      createTreeWalker: () => ({ nextNode: () => nodes.shift() }),
      querySelectorAll: () => [], getElementsByTagName: () => [],
    },
    location: { href: "https://example.org/" },
    Node: { ELEMENT_NODE: 1 }, NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    getSelection: () => ({ rangeCount: 1, isCollapsed: false, getRangeAt: () => range, toString: () => selection }),
  });
}

test("page capture clips title, text and selection without splitting a Unicode character", () => {
  const prefix = size => "字".repeat(size - 1);
  const page = capture(prefix(512) + "😀", prefix(48000) + "😀", prefix(8192) + "😀");
  expect(page.title).toBe(prefix(512));
  expect(page.text).toBe(prefix(48000));
  expect(page.selection).toBe(prefix(8192));
  expect(page.truncated).toBe(true);
});

test("a whole character fitting exactly at the selection limit survives", () => {
  const selected = "字".repeat(8190) + "😀";
  const page = capture("标题😀", "正文😀", selected);
  expect(page.selection).toBe(selected);
  expect(page.title).toBe("标题😀");
  expect(page.text).toBe("正文😀\n");
  expect(page.truncated).toBe(false);
});

test("a shortened selection marks the capture even when the body fits", () => {
  const page = capture("Page", "Body", "x".repeat(8193));
  expect(page.selection.length).toBe(8192);
  expect(page.truncated).toBe(true);
});

test.each([
  [48001, 8, true, false],
  [48000, 8, false, false],
  [9000, 8193, false, true],
  [48001, 8193, true, true],
  [9000, 8192, false, false],
])("reports body %i and selection %i clipping independently", (body, selected, textTruncated, selectionTruncated) => {
  const page = capture("Page", "x".repeat(body), "x".repeat(selected));
  expect(page).toMatchObject({ textTruncated, selectionTruncated, truncated: textTruncated || selectionTruncated });
});
