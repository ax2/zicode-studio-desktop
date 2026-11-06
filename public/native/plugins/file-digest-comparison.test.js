import { expect, it } from "vitest";
import { createFileDigestNoteMaterial } from "./file-digest-note-material.js";
const row = { index: 0, bytes: 3, sha256: "a".repeat(64), sha512: "b".repeat(128), matches: true };
const report = { ok: true, schemaVersion: 2, material: "file-integrity-report-list", files: [row] };
const parse = text => JSON.parse(text.split("\n").slice(1, -2).join("\n"));
it("records the actual normalized SHA-256 or SHA-512 comparison", () => {
  let draft = parse(createFileDigestNoteMaterial(report, ["a.txt"], { expected: ` ${"A".repeat(64)} ` }).content);
  expect(draft.comparison).toEqual({ algorithm: "SHA-256", expected: "a".repeat(64) });
  draft = parse(createFileDigestNoteMaterial(report, ["a.txt"], { expected: "B".repeat(128) }).content);
  expect(draft.comparison).toEqual({ algorithm: "SHA-512", expected: "b".repeat(128) });
  draft = parse(createFileDigestNoteMaterial({ ...report, files: [{ ...row, matches: null }] }, ["a.txt"]).content);
  expect(draft.comparison).toBeNull();
});
it("rejects a malformed or inconsistent comparison", () => {
  for (const expected of ["abc", "x".repeat(64), "c".repeat(64), ""]) {
    expect(() => createFileDigestNoteMaterial(report, ["a.txt"], { expected })).toThrow();
  }
});
