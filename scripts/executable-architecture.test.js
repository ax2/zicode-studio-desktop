// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executableTarget, verifyExecutableTarget } from "./executable-architecture.mjs";

function pe(machine = 0x8664) {
  const header = Buffer.alloc(512);
  header.write("MZ");
  header.writeUInt32LE(128, 0x3c);
  header.write("PE\0\0", 128, "binary");
  header.writeUInt16LE(machine, 132);
  header.writeUInt16LE(0x20b, 152);
  return header;
}
function elf(machine = 62) {
  const header = Buffer.alloc(64);
  header.write("\x7fELF", "binary");
  header[4] = 2; header[5] = 1; header[6] = 1;
  header.writeUInt16LE(machine, 18);
  return header;
}
function macho(cpu) {
  const header = Buffer.alloc(64);
  header.writeUInt32LE(0xfeedfacf);
  header.writeUInt32LE(cpu, 4);
  return header;
}

describe("executable architecture headers", () => {
  it.each([
    ["windows-x64", pe()], ["linux-x64", elf()],
    ["darwin-x64", macho(0x01000007)], ["darwin-arm64", macho(0x0100000c)],
  ])("identifies %s without relying on the filename", (target, header) => {
    expect(executableTarget(header)).toBe(target);
  });
  it("rejects wrong architecture, 32-bit, malformed and truncated headers", () => {
    const pe32 = pe(); pe32.writeUInt16LE(0x10b, 152);
    const badOffset = pe(); badOffset.writeUInt32LE(0xffffffff, 0x3c);
    const elf32 = elf(); elf32[4] = 1;
    const bigEndian = elf(); bigEndian[5] = 2;
    for (const header of [Buffer.alloc(12), Buffer.alloc(64), pe(0xaa64), pe32, badOffset,
      elf(183), elf32, bigEndian, macho(7)]) {
      expect(() => executableTarget(header)).toThrow();
    }
  });
  it("rejects a renamed executable for another target and closes the file", () => {
    const directory = mkdtempSync(join(tmpdir(), "zicode-binary-header-"));
    try {
      const file = join(directory, "looks-like-windows.exe");
      writeFileSync(file, elf());
      expect(() => verifyExecutableTarget(file, "windows-x64")).toThrow("target mismatch");
      expect(verifyExecutableTarget(file, "linux-x64")).toBe("linux-x64");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
