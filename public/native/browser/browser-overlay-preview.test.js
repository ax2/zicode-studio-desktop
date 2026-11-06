import { afterEach, expect, it, vi } from "vitest";
import { browserOverlayOpen, createBrowserOverlayPreview } from "./browser-overlay-preview.js";
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function fixture(capture) {
  const host = document.createElement("div");document.body.append(host);
  let tab = "first";
  const preview = createBrowserOverlayPreview({ capture, host: () => host, current: id => tab === id });
  return { preview, host, change: id => { tab = id; } };
}
it("captures once for concurrent overlay changes and releases pixels after restore", async () => {
  const capture = vi.fn(async () => "data:image/jpeg;base64,AQ=="); const f = fixture(capture);
  await Promise.all([f.preview.show("first"),f.preview.show("first")]);
  expect(capture).toHaveBeenCalledTimes(1);expect(f.host.querySelector("img").getAttribute("src")).toContain("base64");
  await f.preview.show("first");expect(capture).toHaveBeenCalledTimes(1);
  const image = f.host.firstChild;f.preview.clear();expect(f.host.childElementCount).toBe(0);expect(image.hasAttribute("src")).toBe(false);
});
it("does not display a late preview after tab change or overlay close", async () => {
  let finish;const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.preview.show("first");f.change("second");finish("data:image/jpeg;base64,AQ==");expect(await pending).toBe(false);
  expect(f.host.childElementCount).toBe(0);
  const next = f.preview.show("second");f.preview.clear();finish("data:image/jpeg;base64,AQ==");expect(await next).toBe(false);
});
it("retries a failed capture without poisoning later overlays", async () => {
  const capture = vi.fn().mockRejectedValueOnce(Error("renderer busy")).mockResolvedValue("data:image/jpeg;base64,AQ==");const f = fixture(capture);
  await expect(f.preview.show("first")).rejects.toThrow("renderer busy");await expect(f.preview.show("first")).resolves.toBe(true);
});
it("includes the actual command palette and ignores its closed state", () => {
  vi.spyOn(Element.prototype,"getClientRects").mockReturnValue([{}]);
  document.body.innerHTML = '<div id="command-palette" class="hidden"></div><div id="command-palette-overlay" class="hidden"></div>';
  expect(browserOverlayOpen()).toBe(false);document.getElementById("command-palette").classList.remove("hidden");expect(browserOverlayOpen()).toBe(true);
});
