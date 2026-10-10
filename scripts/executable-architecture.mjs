import { closeSync, fstatSync, openSync, readSync } from "node:fs";

// PE/COFF, ELF64 and thin Mach-O64 headers. Universal binaries require a
// separate slice inventory before they can be accepted by this release policy.
export function executableTarget(header) {
  if (header.length < 64) throw new Error("Truncated executable header");
  if (header.toString("ascii", 0, 2) === "MZ") {
    const offset = header.readUInt32LE(0x3c);
    if (offset < 64 || offset > header.length - 26
      || header.toString("binary", offset, offset + 4) !== "PE\0\0") {
      throw new Error("Invalid or truncated PE header");
    }
    if (header.readUInt16LE(offset + 4) === 0x8664
      && header.readUInt16LE(offset + 24) === 0x20b) return "windows-x64";
    throw new Error("Unsupported PE architecture or optional header");
  }
  if (header.toString("binary", 0, 4) === "\x7fELF") {
    if (header[4] === 2 && header[5] === 1 && header[6] === 1
      && header.readUInt16LE(18) === 62) return "linux-x64";
    throw new Error("Unsupported ELF architecture, class or byte order");
  }
  if (header.readUInt32LE(0) === 0xfeedfacf) {
    const cpu = header.readUInt32LE(4);
    if (cpu === 0x01000007) return "darwin-x64";
    if (cpu === 0x0100000c) return "darwin-arm64";
    throw new Error("Unsupported Mach-O CPU type");
  }
  throw new Error("Unsupported executable format");
}

export function verifyExecutableTarget(filePath, expected) {
  const file = openSync(filePath, "r");
  try {
    const stat = fstatSync(file);
    if (!stat.isFile()) throw new Error(`Executable is not a regular file: ${filePath}`);
    const header = Buffer.alloc(Math.min(stat.size, 1024 * 1024));
    let offset = 0;
    while (offset < header.length) {
      const count = readSync(file, header, offset, header.length - offset, offset);
      if (!count) break;
      offset += count;
    }
    const actual = executableTarget(header.subarray(0, offset));
    if (actual !== expected) throw new Error(`Executable target mismatch: expected ${expected}, found ${actual}: ${filePath}`);
    return actual;
  } finally {
    closeSync(file);
  }
}
