import { afterEach, expect, it, vi } from "vitest";
import { createBrowserTabIcon } from "./browser-tab-icon.js";
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1cAAAAASUVORK5CYII=";
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
it("never uses remote favicon URLs, SVG, malformed or oversized payloads as image sources", () => {
  const spy = vi.spyOn(HTMLImageElement.prototype, "src", "set");
  for (const value of ["https://tracking.example/favicon.png", "data:image/svg+xml,<svg/>", "data:image/png;base64,broken", `${png}${"A".repeat(90000)}`, null]) {
    expect(createBrowserTabIcon("https://example.org", value).querySelector("svg")).not.toBeNull();
  }
  expect(spy).not.toHaveBeenCalled();
});
it("shows an engine PNG only after successful decoding, keeping title accessibility unchanged", () => {
  let image; vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(function () { image = this; });
  const icon = createBrowserTabIcon("https://example.org", png); document.body.append(icon);
  expect(icon.querySelector("img")).toBeNull();
  Object.defineProperties(image, { naturalWidth: { value: 16 }, naturalHeight: { value: 16 } }); image.dispatchEvent(new Event("load"));
  expect(icon.querySelector("img")).toBe(image); expect(image.alt).toBe(""); expect(icon.getAttribute("aria-hidden")).toBe("true");
});
it("keeps the default icon on decode failure or dimensions beyond the Host contract", () => {
  let image; vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(function () { image = this; });
  const icon = createBrowserTabIcon("https://example.org", png); image.dispatchEvent(new Event("error")); expect(icon.querySelector("svg")).not.toBeNull();
  Object.defineProperties(image, { naturalWidth: { value: 1024 }, naturalHeight: { value: 1024 } }); image.dispatchEvent(new Event("load")); expect(icon.querySelector("img")).toBeNull();
});
