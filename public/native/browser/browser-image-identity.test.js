import { afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const identity = readFileSync("src-tauri/src/browser/image_identity.js", "utf8");
const capture = readFileSync("src-tauri/src/browser/capture.js", "utf8");
const captureId = "b0f021473af34f6da1412710c2f30010";
const source = "https://example.org/shared.png";

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

function fixture() {
  let now = 0;
  const sandbox = {
    document, URL, Node, NodeFilter, MutationObserver, AbortController,
    location: { href: "https://example.org/", origin: "https://example.org" },
    performance: { now: () => now },
    getComputedStyle, getSelection: () => document.getSelection(),
  };
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}]);
  return {
    registry: runInNewContext(`(${identity})()`, sandbox),
    read: seed => runInNewContext(`(() => {
      const registerStudioImage = (${identity})().begin(${JSON.stringify(seed)});
      return ${capture};
    })()`, sandbox),
    advance: elapsed => { now += elapsed; },
  };
}

function image(alt) {
  const node = document.createElement("img");
  node.alt = alt;
  node.src = source;
  Object.defineProperties(node, {
    complete: { value: true }, currentSrc: { value: source, configurable: true },
    naturalWidth: { value: 20 }, naturalHeight: { value: 10 },
  });
  return node;
}

test("metadata capture binds each visible selected image to its own ordinary or open component node", () => {
  const { registry, read } = fixture();
  const first = image("First image"), second = image("Second image"), component = image("Component image");
  const host = document.createElement("section");
  host.attachShadow({ mode: "open" }).append(component);
  document.body.append(first, second, host);
  const [firstMetadata, secondMetadata, componentMetadata] = read(captureId).images;
  expect(new Set([firstMetadata.locator, secondMetadata.locator, componentMetadata.locator]).size).toBe(3);
  expect(registry.resolve(firstMetadata, document)).toBe(first);
  expect(registry.resolve(secondMetadata, document)).toBe(second);
  expect(registry.resolve(componentMetadata, document)).toBe(component);
  expect(registry.resolve({ ...secondMetadata, alt: first.alt }, document)).toBeNull();
  expect(registry.resolve(componentMetadata, document.implementation.createHTMLDocument())).toBeNull();

  second.replaceWith(image(second.alt));
  expect(registry.resolve(secondMetadata, document)).toBeNull();
  expect(registry.resolve(firstMetadata, document)).toBe(first);
  host.setAttribute("aria-hidden", "true");
  expect(registry.resolve(componentMetadata, document)).toBeNull();
  Object.defineProperty(first, "currentSrc", { value: "https://example.org/changed.png" });
  expect(registry.resolve(firstMetadata, document)).toBeNull();
});

test("retains only the bounded active capture and clears stale image identity", () => {
  const { registry, advance } = fixture();
  const nodes = Array.from({ length: 25 }, (_, index) => image(`Image ${index}`));
  document.body.append(...nodes);
  const descriptor = node => ({ alt: node.alt, width: 20, height: 10, url: source });
  const register = registry.begin(captureId);
  const locators = nodes.map(node => register(node, descriptor(node)));
  expect(locators.filter(Boolean)).toHaveLength(24);
  expect(locators[24]).toBeNull();
  const first = { ...descriptor(nodes[0]), locator: locators[0] };
  expect(registry.resolve(first, document)).toBe(nodes[0]);
  const newer = registry.begin("c0f021473af34f6da1412710c2f30010");
  const current = { ...descriptor(nodes[0]), locator: newer(nodes[0], descriptor(nodes[0])) };
  expect(registry.resolve(first, document)).toBeNull();
  expect(registry.resolve(current, document)).toBe(nodes[0]);
  advance(10 * 60 * 1000);
  expect(registry.resolve(current, document)).toBeNull();
});

test("invalidates a located node after a same-URL source update or reload", () => {
  const { registry, read } = fixture();
  const node = image("Repeated source");
  document.body.append(node);
  const [first] = read(captureId).images;
  expect(registry.resolve(first, document)).toBe(node);
  node.src = source;
  expect(node.currentSrc).toBe(source);
  expect(registry.resolve(first, document)).toBeNull();
  const [afterMutation] = read("c0f021473af34f6da1412710c2f30010").images;
  expect(registry.resolve(afterMutation, document)).toBe(node);
  node.dispatchEvent(new Event("load"));
  expect(registry.resolve(afterMutation, document)).toBeNull();
});
