import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { loadImageReportNoteMaterial } from "./image-report-note-material.js";

async function fixture(
  text = JSON.stringify({ schemaVersion: 2, material: "image-metadata-report", note: "````" }),
) {
  vi.stubGlobal("crypto", webcrypto);
  const bytes = new TextEncoder().encode(text);
  const resource = {
    origin: "host-report",
    saved: false,
    mimeType: "application/json",
    byteLength: bytes.length,
    contentVersion: Buffer.from(await webcrypto.subtle.digest("SHA-256", bytes)).toString("hex"),
  };
  const owner = { capabilityId: "devtools.image.metadata.inspect" };
  const read = vi.fn(async (_owner, _resource, offset, length) => {
    const slice = bytes.subarray(offset, offset + length);
    return {
      offset,
      byteLength: slice.length,
      eof: offset + slice.length === bytes.length,
      dataBase64: Buffer.from(slice).toString("base64"),
    };
  });
  return { resource, owner, read, isCurrent: () => true, text };
}
afterEach(() => vi.unstubAllGlobals());

it("rechecks and preserves the complete report as inert Markdown with a safe fence", async () => {
  const c = await fixture();
  const result = await loadImageReportNoteMaterial(c);
  expect(JSON.parse(result.content.split("\n").slice(1, -2).join("\n"))).toEqual(JSON.parse(c.text));
  expect(c.read).toHaveBeenCalledWith(c.owner, c.resource, 0, c.resource.byteLength, c.isCurrent);
});
it("reads a large report in bounded chunks without truncation", async () => {
  const text = JSON.stringify({
    schemaVersion: 2,
    material: "image-metadata-report",
    data: "a".repeat(45000),
  });
  const c = await fixture(text);
  expect((await loadImageReportNoteMaterial(c)).content).toContain(text);
  expect(c.read.mock.calls.map((call) => call[2])).toEqual([0, 32768]);
});
it("stops if the source is revoked, the result changes, or the owner changes", async () => {
  const c = await fixture();
  c.read.mockRejectedValueOnce(new Error("permission denied"));
  await expect(loadImageReportNoteMaterial(c)).rejects.toThrow();
  c.resource.contentVersion = "0".repeat(64);
  await expect(loadImageReportNoteMaterial(c)).rejects.toThrow();
  c.owner.capabilityId = "another.tool";
  c.read.mockClear();
  await expect(loadImageReportNoteMaterial(c)).rejects.toThrow();
  expect(c.read).not.toHaveBeenCalled();
});
it("aborts a stale read and rejects invalid or oversized reports", async () => {
  const c = await fixture();
  let current = true;
  c.isCurrent = () => current;
  const read = c.read;
  c.read = vi.fn(async (...args) => {
    const row = await read(...args);
    current = false;
    return row;
  });
  await expect(loadImageReportNoteMaterial(c)).rejects.toThrow();
  const invalid = await fixture('{"schemaVersion":1}');
  await expect(loadImageReportNoteMaterial(invalid)).rejects.toThrow();
  const big = await fixture();
  big.resource.byteLength = 48 * 1024 + 1;
  await expect(loadImageReportNoteMaterial(big)).rejects.toThrow();
  expect(big.read).not.toHaveBeenCalled();
});
