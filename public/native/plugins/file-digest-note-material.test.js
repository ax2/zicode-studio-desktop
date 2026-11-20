import { expect, it } from "vitest";
import { createFileDigestNoteMaterial } from "./file-digest-note-material.js";
const row = { index: 0, bytes: 3, sha256: "a".repeat(64), sha512: "b".repeat(128), matches: null, secret: "private" };
const report = { ok: true, schemaVersion: 2, material: "file-integrity-report-list", files: [row], extra: "private" };
it("creates a fenced report containing only bounded allowed fields", () => {
  const result = createFileDigestNoteMaterial(report, ["name```<img>.txt"]);
  expect(result.title).toBe("File digest report");
  expect(result.content.startsWith("```json\n")).toBe(true);
  expect(result.content).toContain(row.sha512);
  expect(result.content).not.toContain("private");
  expect(JSON.parse(result.content.split("\n").slice(1, -2).join("\n")).files[0].name).toBe("name```<img>.txt");
});
it("rejects unsafe names and malformed digest rows", () => {
  for (const name of ["C:\\secret", "a/b", "x\u202ey", "x\n", "x".repeat(256)])
    expect(() => createFileDigestNoteMaterial(report, [name])).toThrow();
  expect(() => createFileDigestNoteMaterial({ ...report, files: [{ ...row, sha256: "bad" }] }, ["safe"])).toThrow();
  expect(() => createFileDigestNoteMaterial(report, ["a", "b"])).toThrow();
});
