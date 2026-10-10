import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadResourcePreview } from "./plugin-resource-preview-load.js";
async function fixture(bytes = new TextEncoder().encode("<script>local text</script>"), mimeType = "text/plain") {
  vi.stubGlobal("crypto", webcrypto);
  const hash = Buffer.from(await webcrypto.subtle.digest("SHA-256", bytes)).toString("hex");
  return { resource: { mimeType, byteLength: bytes.length, contentVersion: hash }, isCurrent: () => true,
    read: vi.fn(async (offset, length) => ({ offset, byteLength: Math.min(length, bytes.length - offset),
      eof: offset + length >= bytes.length, dataBase64: Buffer.from(bytes.subarray(offset, offset + length)).toString("base64") })) };
}
afterEach(() => vi.unstubAllGlobals());
describe("bounded parent preview reads", () => {
  it("verifies full digest and decodes plain UTF-8 without rendering HTML", async () => {
    const c = await fixture();
    expect(await loadResourcePreview(c)).toEqual({ kind: "text", text: "<script>local text</script>" });
  });
  it("reads 32KiB chunks and only displays the first 256 binary bytes", async () => {
    const c = await fixture(new Uint8Array(65537).fill(173), "application/octet-stream");
    const result = await loadResourcePreview(c);
    expect(c.read.mock.calls.map((call) => call[0])).toEqual([0, 32768, 65536]);
    expect(result.text.split(" ")).toHaveLength(256); expect(result.text.startsWith("ad ad")).toBe(true);
  });
  it("refuses oversize text before any read and stops after disposal", async () => {
    const c = await fixture(); c.resource.byteLength = 128 * 1024 + 1;
    await expect(loadResourcePreview(c)).rejects.toThrow(); expect(c.read).not.toHaveBeenCalled();
    const pending = await fixture(new Uint8Array(65537), "application/octet-stream");
    let current = true; pending.isCurrent = () => current;
    const read = pending.read; pending.read = vi.fn(async (...args) => { const row = await read(...args); current = false; return row; });
    await expect(loadResourcePreview(pending)).rejects.toThrow(); expect(pending.read).toHaveBeenCalledTimes(1);
  });
  it("rejects hash mismatches, invalid UTF-8 and inconsistent ranges", async () => {
    const c = await fixture(); c.resource.contentVersion = "0".repeat(64);
    await expect(loadResourcePreview(c)).rejects.toThrow();
    await expect(loadResourcePreview(await fixture(new Uint8Array([255]), "text/plain"))).rejects.toThrow();
    for (const patch of [{ offset: 1 }, { byteLength: -1 }, { eof: false }, { dataBase64: "" }]) {
      const next = await fixture(); const read = next.read;
      next.read = async (...args) => ({ ...await read(...args), ...patch });
      await expect(loadResourcePreview(next)).rejects.toThrow();
    }
  });
  it("still checks access for empty outputs", async () => {
    const c = await fixture(new Uint8Array()); expect((await loadResourcePreview(c)).text).toBe("");
    expect(c.read).toHaveBeenCalledWith(0, 1);
  });
});
