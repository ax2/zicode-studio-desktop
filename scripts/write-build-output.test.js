// @vitest-environment node
import { mkdtempSync, readFileSync, rmdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { writeBuildOutput } from "./write-build-output.cjs";

it("creates missing bundles, keeps unchanged bytes and their mtime, and writes a changed bundle", () => {
  const root = mkdtempSync(path.join(tmpdir(), "studio-build-output-"));
  try {
    const destination = path.join(root, "entry.js");
    const original = new Uint8Array([0, 1, 2]);
    writeBuildOutput(destination, original);
    expect(readFileSync(destination)).toEqual(Buffer.from(original));

    const past = new Date("2020-01-01T00:00:00.000Z");
    utimesSync(destination, past, past);
    const oldMtime = statSync(destination).mtimeMs;
    writeBuildOutput(destination, new Uint8Array(original));
    expect(statSync(destination).mtimeMs).toBe(oldMtime);

    const changed = Buffer.from([0, 1, 3]);
    writeBuildOutput(destination, changed);
    expect(readFileSync(destination)).toEqual(changed);
    expect(statSync(destination).mtimeMs).toBeGreaterThan(oldMtime);
  } finally {
    rmSync(path.join(root, "entry.js"), { force: true });
    rmdirSync(root);
  }
});
