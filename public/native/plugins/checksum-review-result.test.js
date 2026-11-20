import { expect, it } from "vitest";
import { checksumReviewFiles, checksumReviewResult, checksumReviewManifestWire } from "./checksum-review-result.js";
const hash = "a".repeat(64), files = [{ name: "a.txt", sha256: hash }];
function result(rows) { return { contractVersion: "1.0.0-rc.1", ok: true, data: { text: JSON.stringify({ schemaVersion: 1, entries: rows }) } }; }
it("binds names, order, expected hashes and verdicts to the actual request", () => {
  const manifest = `${hash}  A.txt\n${"b".repeat(64)}  absent.txt\n`;
  const rows = [{ name: "A.txt", expected: hash, status: "match" }, { name: "absent.txt", expected: "b".repeat(64), status: "not_provided" }];
  expect(checksumReviewResult(result(rows), manifest, files)).toEqual(rows);
  expect(() => checksumReviewResult(result([{ ...rows[0], status: "mismatch" }, rows[1]]), manifest, files)).toThrow();
  expect(() => checksumReviewResult(result([...rows].reverse()), manifest, files)).toThrow();
  expect(() => checksumReviewResult(result([{ ...rows[0], name: "other.txt" }, rows[1]]), manifest, files)).toThrow();
});
it("rejects malformed source identity and duplicate case-insensitive names", () => {
  const source = { ok: true, schemaVersion: 2, material: "file-integrity-report-list", files: [{ index: 0, sha256: hash }, { index: 1, sha256: hash }] };
  expect(checksumReviewFiles(source, ["one.txt", "two.txt"])).toEqual([{ name: "one.txt", sha256: hash }, { name: "two.txt", sha256: hash }]);
  expect(() => checksumReviewFiles(source, ["One", "one"])).toThrow();
  expect(() => checksumReviewFiles(source, ["../one", "two"])).toThrow();
});

it("omits only native-ignored blank lines from wire input and retains BOM significance", () => {
  const text = `${hash}  a.txt\r\n` + "\n".repeat(32600);
  expect(checksumReviewManifestWire(text)).toBe(`${hash}  a.txt`);
  expect(checksumReviewManifestWire(`\u0085\n${hash}  a.txt\n`)).toBe(`${hash}  a.txt`);
  expect(checksumReviewManifestWire(`\ufeff\n${hash}  a.txt\n`)).toBe(`\ufeff\n${hash}  a.txt`);
});
