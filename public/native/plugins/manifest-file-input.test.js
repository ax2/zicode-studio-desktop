import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createManifestFileInput } from "./manifest-file-input.js";
const roots = [];
function fixture() {
  setLocale("en"); document.body.innerHTML = "<main></main>";
  let content = "existing text", revision = 0;
  const onContent = vi.fn(text => { content = text; revision++; }), onBusy = vi.fn();
  const controller = createManifestFileInput({ container: document.querySelector("main"), isCurrent: () => true,
    getRevision: () => revision, onContent, onBusy }); roots.push(controller);
  const input = document.querySelector("input"), button = document.querySelector("button");
  function select(file) { Object.defineProperty(input, "files", { configurable: true, value: file ? [file] : [] }); input.dispatchEvent(new Event("change")); }
  return { controller, input, button, select, onContent, onBusy, content: () => content, edit: () => { revision++; content = "newer edit"; } };
}
const file = text => { const bytes = new TextEncoder().encode(text); return { name: "SHA256SUMS", size: bytes.length, arrayBuffer: vi.fn(async () => bytes.buffer) }; };
afterEach(() => { for (const root of roots.splice(0)) root.destroy(); document.body.replaceChildren(); setLocale("zh-CN"); });
it("does not read on selection and replaces content only on explicit action", async () => {
  const f = fixture(), source = file("a".repeat(64) + "  文件.txt\r\n"); f.select(source);
  expect(source.arrayBuffer).not.toHaveBeenCalled(); expect(f.content()).toBe("existing text"); f.button.click();
  await vi.waitFor(() => expect(f.onContent).toHaveBeenCalledOnce()); expect(f.content()).toContain("文件.txt\r\n");
  expect(document.body.textContent).toContain("Review has not run yet"); expect(f.onBusy).toHaveBeenLastCalledWith(false);
  setLocale("zh-CN"); expect(document.body.textContent).toContain("尚未执行核对");
});
it("keeps existing text for cancelled, oversized, invalid UTF-8, empty and changed files", async () => {
  const f = fixture(); f.select(null); expect(f.button.disabled).toBe(true); expect(f.content()).toBe("existing text");
  const big = { name: "large.txt", size: 32769, arrayBuffer: vi.fn() }; f.select(big); expect(f.button.disabled).toBe(true); expect(big.arrayBuffer).not.toHaveBeenCalled();
  for (const source of [{ name: "bad.txt", size: 1, arrayBuffer: vi.fn(async () => new Uint8Array([255]).buffer) }, file(" \n"), { name: "changed.txt", size: 3, arrayBuffer: vi.fn(async () => new Uint8Array([1]).buffer) }]) {
    f.select(source); f.button.click(); await vi.waitFor(() => expect(f.onBusy).toHaveBeenLastCalledWith(false)); expect(f.content()).toBe("existing text");
  }
  expect(f.onContent).not.toHaveBeenCalled();
});
it("discards delayed reads after clear or a newer editor revision", async () => {
  for (const change of ["clear", "edit"]) {
    const f = fixture(); let finish; const source = { name: "delayed.txt", size: 3, arrayBuffer: vi.fn(() => new Promise(resolve => { finish = resolve; })) };
    f.select(source); f.button.click(); expect(f.button.disabled).toBe(true);
    if (change === "clear") f.controller.clear(); else f.edit();
    finish(new TextEncoder().encode("abc").buffer); await Promise.resolve(); await Promise.resolve();
    expect(f.onContent).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain("Reading manifest file");
    f.controller.destroy();
  }
});
it("preserves a BOM and displays the file name as text", async () => {
  const f = fixture(), source = file("\ufeff" + "a".repeat(64) + "  a.txt\n"); source.name = "<img onerror=x>\u202e.txt";
  f.select(source); expect(document.querySelector("img")).toBeNull(); expect(document.body.textContent).not.toContain("\u202e"); f.button.click();
  await vi.waitFor(() => expect(f.onContent).toHaveBeenCalledOnce()); expect(f.content().charCodeAt(0)).toBe(0xfeff);
});
