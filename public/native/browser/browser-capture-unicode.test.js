import { afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const script = readFileSync("src-tauri/src/browser/capture.js", "utf8");

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

function capture(title, body, selection) {
  const parentElement = { nodeType: 1, matches: () => false, closest: () => null, getClientRects: () => [{}], querySelectorAll: () => [] };
  const textNode = { nodeType: 3, nodeValue: body, parentElement };
  const range = { startContainer: textNode, endContainer: textNode, commonAncestorContainer: textNode };
  parentElement.childNodes = [textNode];
  return runInNewContext(script, {
    document: {
      title, body: parentElement, documentElement: {}, links: [], images: [],
      querySelectorAll: () => [], getElementsByTagName: () => [],
    },
    location: { href: "https://example.org/" },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 }, NodeFilter: { SHOW_TEXT: 4 },
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


function captureFrames({ text = "Main body", selection = "Main selection", withImage = false, withLinks = false } = {}) {
  const origin = "https://example.org";
  const selectable = value => {
    const visible = { nodeType: 1, matches: () => false, closest: () => null, getClientRects: () => [{}], querySelectorAll: () => [] };
    const node = { nodeType: 3, nodeValue: value, parentElement: visible };
    visible.childNodes = [node];
    return { visible, node };
  };
  function doc(title, URL, body, value, frames = []) {
    const { visible, node } = selectable(body);
    return {
      title, URL, body: visible, documentElement: {}, links: [], images: [],
      querySelectorAll: query => query === "iframe,frame" ? frames : [],
      getElementsByTagName: () => [],
      getSelection: () => ({
        rangeCount: value ? 1 : 0, isCollapsed: !value, toString: () => value,
        getRangeAt: () => ({ startContainer: node, endContainer: node, commonAncestorContainer: node }),
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
  if (withLinks) {
    const anchor = (href, innerText, hidden = false) => ({
      nodeType: 1, localName: "a", href, innerText, closest: () => null,
      getClientRects: () => hidden ? [] : [{}], querySelector: () => null,
    });
    const refs = (name, count) => Array.from({ length: count }, (_, i) =>
      anchor(`${origin}/${name}/${i}`, `${name} ${i}`));
    document.links.push(anchor(`${origin}/main`, "Main"));
    sameOrigin.links.push(...refs("embedded", 7), anchor(`${origin}/not-visible`, "Hidden", true));
    nested.links.push(anchor("mailto:hello@example.org", "Email"), ...refs("nested", 6),
      anchor(`${origin}/nested/0`, "Duplicate"));
    foreign.links.push(anchor("https://example.com/foreign-link", "Foreign"));
    const last = doc("Last", `${origin}/last`, "", "");
    last.links.push(anchor(`${origin}/last-link`, "Last"));
    document.querySelectorAll("iframe,frame").push(iframe(last));
  }
  return runInNewContext(script, {
    document, URL, location: { href: document.URL, origin },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 }, NodeFilter: { SHOW_TEXT: 4 },
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

test("keeps embedded links in their source frames and bounds the subpage budgets", () => {
  const page = captureFrames({ withLinks: true });
  expect(page.links).toEqual([{ label: "Main", url: "https://example.org/main" }]);
  expect(page.linksTruncated).toBe(false);
  expect(page.frames.map(({ links, linksTruncated }) => [links.length, linksTruncated])).toEqual([[6, true], [6, false], [0, true]]);
  expect(page.frames[0].links[0]).toEqual({ label: "embedded 0", url: "https://example.org/embedded/0" });
  expect(page.frames[1].links[5]).toEqual({ label: "nested 5", url: "https://example.org/nested/5" });
  expect(JSON.stringify(page)).not.toMatch(/not-visible|foreign-link|mailto/);
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


function captureSelection(owner = document) {
  return runInNewContext(script, {
    document: owner, location: { href: "https://example.org/", origin: "https://example.org" },
    Node, NodeFilter, URL, getComputedStyle, getSelection: () => owner.getSelection(),
  });
}

function selectRange(start, end = start) {
  const owner = start.ownerDocument;
  const range = owner.createRange();
  range.setStart(start.firstChild, 0);
  range.setEnd(end.lastChild, end.lastChild.length);
  const selection = owner.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

test("retains normal text selection but omits a protected form or a range crossing it", () => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}]);
  document.body.innerHTML = '<p id="before">Before</p><form><output>Form data</output></form><p id="after">After</p>';
  const before = document.getElementById("before");
  selectRange(before);
  expect(captureSelection()).toMatchObject({ selection: "Before", selectionTruncated: false });

  selectRange(document.querySelector("output"));
  expect(captureSelection()).toMatchObject({ selection: "", selectionTruncated: false });
  selectRange(before, document.getElementById("after"));
  expect(captureSelection()).toMatchObject({ selection: "", selectionTruncated: false });
});

test("ignores an old page selection while an input has focus", () => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}]);
  document.body.innerHTML = "<p>Previously selected text</p><input>";
  document.querySelector("input").focus();
  selectRange(document.querySelector("p"));
  expect(document.getSelection().toString()).toBe("Previously selected text");
  expect(captureSelection()).toMatchObject({ selection: "", selectionTruncated: false });
});

test("keeps a focused same-origin frame selection separate from the old main-page selection", () => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}]);
  document.body.innerHTML = "<p>Previous main-page selection</p><iframe></iframe>";
  const frame = document.querySelector("iframe");
  const child = frame.contentDocument;
  vi.spyOn(frame.contentWindow.HTMLElement.prototype, "getClientRects").mockReturnValue([{}]);
  child.body.innerHTML = "<p>Public frame text</p><form><output>Frame form data</output></form>";
  frame.focus();
  selectRange(document.querySelector("p"));
  selectRange(child.querySelector("p"));
  expect(captureSelection()).toMatchObject({
    selection: "",
    frames: [{ selection: "Public frame text", selectionTruncated: false }],
  });

  selectRange(child.querySelector("output"));
  expect(captureSelection().frames[0]).toMatchObject({ selection: "", selectionTruncated: false });
});

test("captures rendered open components in order and keeps private and unslotted text out", () => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}]);
  document.body.innerHTML = '<p>Before</p><div id="host"><span slot="heading">Slotted heading</span><span>Not assigned</span></div><div id="closed"></div><p>After</p>';
  const root = document.getElementById("host").attachShadow({ mode: "open" });
  root.innerHTML = '<p>Component start</p><slot name="heading"><span>Unused fallback</span></slot><slot name="detail"><span>Visible fallback</span></slot><div id="nested"></div><div aria-hidden="true"><div id="hidden"></div></div><section contenteditable><div id="editable"></div></section>';
  root.getElementById("nested").attachShadow({ mode: "open" }).innerHTML = "<p>Nested component</p>";
  root.getElementById("hidden").attachShadow({ mode: "open" }).innerHTML = "<p>Hidden component</p>";
  root.getElementById("editable").attachShadow({ mode: "open" }).innerHTML = "<p>Editable component</p>";
  document.getElementById("closed").attachShadow({ mode: "closed" }).innerHTML = "<p>Closed component</p>";

  expect(captureSelection()).toMatchObject({
    text: "Before\nComponent start\nSlotted heading\nVisible fallback\nNested component\nAfter\n",
    textTruncated: false,
  });
});

test("keeps a paragraph selection on a page with many unrelated controls", () => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}]);
  document.body.innerHTML = "<p>Selected paragraph</p><div>" + "<button>Action</button>".repeat(260) + "</div>";
  selectRange(document.querySelector("p"));
  expect(captureSelection()).toMatchObject({ selection: "Selected paragraph", selectionTruncated: false });
});
