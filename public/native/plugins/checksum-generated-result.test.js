import { webcrypto, createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { checksumGeneratedResult } from "./checksum-generated-result.js";
const files = [{ name: "乙.txt", sha256: "b".repeat(64) }, { name: "甲.txt", sha256: "a".repeat(64) }];
const text = `${"a".repeat(64)}  甲.txt\n${"b".repeat(64)}  乙.txt\n`;
const response = () => ({ result: { contractVersion: "1.0.0-rc.1", ok: true, data: { text } }, resultRef: { schemaVersion: 1, resultId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", mimeType: "text/plain", byteLength: new TextEncoder().encode(text).length, contentVersion: createHash("sha256").update(text).digest("hex"), packageVersion: "0.2.0" } });
afterEach(() => vi.unstubAllGlobals());
it("checks complete bytes, ordering, Unicode names, length and the Host snapshot SHA-256", async () => {
  vi.stubGlobal("crypto", webcrypto); expect((await checksumGeneratedResult(response(), files, "0.2.0")).text).toBe(text);
});
it("rejects invented text, partial output, wrong snapshot/hash/version and malformed IDs", async () => {
  vi.stubGlobal("crypto", webcrypto);
  for (const change of [r => { r.result.data.text += "extra"; }, r => { r.resultRef.contentVersion = "0".repeat(64); }, r => { r.resultRef.packageVersion = "0.1.0"; }, r => { r.resultRef.byteLength--; }, r => { r.resultRef.resultId = "other"; }, r => { r.result.ok = false; }]) {
    const r = response(); change(r); await expect(checksumGeneratedResult(r, files, "0.2.0")).rejects.toThrow();
  }
});
