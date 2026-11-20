import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { loadMarkdownDraft } from "./markdown-draft-load.js";
async function fixture(value) {
  vi.stubGlobal("crypto", webcrypto);
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const resource = { resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", contentVersion: Buffer.from(await webcrypto.subtle.digest("SHA-256", bytes)).toString("hex") };
  return { resource, isCurrent: () => true, read: vi.fn(async (offset, length) => ({ offset,
    byteLength: Math.min(length, bytes.length - offset), eof: offset + length >= bytes.length,
    dataBase64: Buffer.from(bytes.subarray(offset, offset + length)).toString("base64") })) };
}
afterEach(() => vi.unstubAllGlobals());
it("reads a complete confirmed snapshot and removes exactly one BOM, keeping Unicode, empty text and newlines", async () => {
  for (const [input, expected] of [["", ""], ["\ufeff# 标题🙂", "# 标题🙂"], ["\ufeff\ufeff# title", "\ufeff# title"], ["a\r\nb\n", "a\r\nb\n"]]) {
    const f = await fixture(input); expect(await loadMarkdownDraft(f)).toBe(expected);
    expect(f.read).toHaveBeenLastCalledWith(0, 1);
  }
});
it("allows the original full 2MiB input and rejects oversize without reading beyond it", async () => {
  const f = await fixture(new Uint8Array(2097152).fill(97));
  expect(await loadMarkdownDraft(f)).toBe("a".repeat(2097152)); expect(f.read).toHaveBeenCalledTimes(65);
  const large = await fixture(new Uint8Array(2097153).fill(97));
  await expect(loadMarkdownDraft(large)).rejects.toThrow(); expect(large.read).toHaveBeenCalledTimes(64);
  expect(Math.max(...large.read.mock.calls.map(([offset, length]) => offset + length))).toBe(2097152);
});
it("rejects invalid UTF-8, bad digests, malformed ranges and lost permission before adopting text", async () => {
  await expect(loadMarkdownDraft(await fixture(new Uint8Array([255])))).rejects.toThrow();
  const bad = await fixture("original"); bad.resource.contentVersion = "0".repeat(64); await expect(loadMarkdownDraft(bad)).rejects.toThrow();
  for (const patch of [{ offset: 2 }, { byteLength: -1 }, { eof: false }, { dataBase64: "" }]) {
    const f = await fixture("original"), read = f.read; f.read = async (...args) => ({ ...await read(...args), ...patch });
    await expect(loadMarkdownDraft(f)).rejects.toThrow();
  }
  const revoked = await fixture("original"), read = revoked.read;
  revoked.read = vi.fn(async (...args) => { if (revoked.read.mock.calls.length === 2) throw new Error("permission_denied"); return read(...args); });
  await expect(loadMarkdownDraft(revoked)).rejects.toThrow("permission_denied");
});
it("abandons copied bytes after a selection or target changes", async () => {
  const f = await fixture("a".repeat(65536)), read = f.read; let current = true;
  f.isCurrent = () => current; f.read = async (...args) => { const row = await read(...args); current = false; return row; };
  await expect(loadMarkdownDraft(f)).rejects.toThrow(); expect(read).toHaveBeenCalledTimes(1);
});
