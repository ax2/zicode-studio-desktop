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


function captureFrames({ text = "Main body", selection = "Main selection", withImage = false } = {}) {
  const origin = "https://example.org";
  const selectable = value => {
    const visible = { closest: () => null, getClientRects: () => [{}] };
    const node = { nodeType: 3, nodeValue: value, parentElement: visible };
    return { visible, node };
  };
  function doc(title, URL, body, value, frames = []) {
    const { visible, node } = selectable(body);
    return {
      title, URL, body: visible, documentElement: {}, links: [], images: [],
      createTreeWalker() {
        const nodes = [node];
        return { nextNode: () => nodes.shift() };
      },
      querySelectorAll: query => query === "iframe,frame" ? frames : [],
      getElementsByTagName: () => [],
      getSelection: () => ({
        rangeCount: value ? 1 : 0, isCollapsed: !value, toString: () => value,
        getRangeAt: () => ({ startContainer: node, endContainer: node }),
      }),
    };
  }
  function iframe(contentDocument, { sandbox = false, hidden = false, title = "" } = {}) {
    return {
      title, nodeType: 1,
      get contentDocument() {
        if (sandbox || hidden) throw Error("Unreadable frame was accessed");
        return contentDocument;
      },
      hasAttribute: name => name === "sandbox" && sandbox,
      closest: () => null, getClientRects: () => hidden ? [] : [{}],
    };
  }
  const nested = doc("", "about:srcdoc", withImage ? "" : "Nested document", "");
  if (withImage) {
    nested.defaultView = { performance: { timeOrigin: 45.5 } };
    nested.images.push({ naturalWidth: 320, naturalHeight: 160, alt: "Embedded scan", currentSrc: new URL("/scan.png", origin).href,
      getClientRects: () => [{}], closest: () => null, nodeType: 1 });
  }
  const sameOrigin = doc("Same origin", `${origin}/inner`, "😀 for frame", "😀", [iframe(nested, { title: "Inline title" })]);
  const hidden = doc("Invisible title", `${origin}/hidden`, "Hidden content", "");
  const foreign = doc("Foreign title", "https://example.com/frame", "Foreign content", "");
  const document = doc("Main", `${origin}/`, text, selection, [
    iframe(sameOrigin), iframe(hidden, { hidden: true }), iframe(foreign),
    iframe(null), iframe(hidden, { sandbox: true }),
  ]);
  return runInNewContext(script, {
    document, URL, location: { href: document.URL, origin },
    Node: { ELEMENT_NODE: 1 }, NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    getSelection: document.getSelection,
  });
}

test("only reads visible loaded same-origin frames and keeps their source and selection separate", () => {
  const page = captureFrames();
  expect(page.text).toBe("Main body\n");
  expect(page.selection).toBe("Main selection");
  expect(page.frames).toMatchObject([
    { title: "Same origin", url: "https://example.org/inner", text: "😀 for frame\n", selection: "😀" },
    { title: "Inline title", url: null, text: "Nested document\n", selection: "" },
  ]);
  expect(page.framesOmitted).toBe(true);
});

test("embedded documents share the text and selection budget without splitting emoji", () => {
  const page = captureFrames({ text: "a".repeat(47997), selection: "a".repeat(8191) });
  expect(page.textTruncated).toBe(false);
  expect(page.selectionTruncated).toBe(false);
  expect(page.frames[0]).toMatchObject({ text: "😀", textTruncated: true, selection: "", selectionTruncated: true });
  expect(page.frames[1]).toMatchObject({ text: "", textTruncated: true });
});


test("captures image-only embedded documents with a distinct navigation locator", () => {
  const page = captureFrames({ withImage: true });
  expect(page.frames[1]).toMatchObject({
    title: "Inline title", url: null, text: "",
    images: [{ alt: "Embedded scan", width: 320, height: 160, url: "https://example.org/scan.png" }],
    imageLocator: { path: [0, 0], timeOrigin: "45.5" },
  });
});
