// @vitest-environment node
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { macosBundleOverride, signMacosRelay } from "./macos-bundle-signing.mjs";

const directory = mkdtempSync(join(tmpdir(), "zicode-macos-signing-"));
const binary = join(directory, "zicode-relay");
const header = Buffer.alloc(64);
header.writeUInt32LE(0xfeedfacf, 0);
header.writeUInt32LE(0x01000007, 4);
writeFileSync(binary, header);
afterAll(() => {
  unlinkSync(binary);
  rmdirSync(directory);
});

describe("macOS helper signing before bundle creation", () => {
  it("signs the checked Intel helper before verifying its signature", () => {
    const execute = vi.fn();
    signMacosRelay(binary, "darwin-x64", execute, "darwin");
    expect(execute).toHaveBeenNthCalledWith(
      1,
      "codesign",
      ["--force", "--sign", "-", binary],
      expect.objectContaining({ timeout: 30_000 }),
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      "codesign",
      ["--verify", "--strict", "--verbose=2", binary],
      expect.any(Object),
    );
  });
  it("refuses a non-macOS platform", () => {
    const execute = vi.fn();
    expect(() => signMacosRelay(binary, "darwin-x64", execute, "win32")).toThrow("macOS");
    expect(execute).not.toHaveBeenCalled();
  });
  it("refuses an architecture mismatch before signing", () => {
    const execute = vi.fn();
    expect(() => signMacosRelay(binary, "darwin-arm64", execute, "darwin")).toThrow(
      "Executable target mismatch: expected darwin-arm64, found darwin-x64",
    );
    expect(execute).not.toHaveBeenCalled();
  });
  it("does not continue after signing fails", () => {
    const execute = vi.fn(() => {
      throw new Error("signing failed");
    });
    expect(() => signMacosRelay(binary, "darwin-x64", execute, "darwin")).toThrow("signing failed");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("immutable application packaging override", () => {
  it("adds only a before-bundle hook and quotes special path characters", () => {
    const config = macosBundleOverride("/tmp/runner O'Brien/$literal/sign.mjs", "/tmp/workspace");
    expect(config).toEqual({
      build: {
        beforeBundleCommand: {
          cwd: "/tmp/workspace",
          script: "bun '/tmp/runner O'\\''Brien/$literal/sign.mjs' --sign",
        },
      },
    });
    expect(Object.keys(config)).toEqual(["build"]);
  });
  it("rejects relative hook or workspace paths", () => {
    expect(() => macosBundleOverride("sign.mjs", "/tmp/workspace")).toThrow("absolute");
    expect(() => macosBundleOverride("/tmp/sign.mjs", "workspace")).toThrow("absolute");
  });
  it("keeps deep bundle validation and bundled runtime startup as release gates", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).toContain("scripts/macos-bundle-signing.mjs");
    expect(workflow).toContain('macos-bundle-signing.mjs" --prepare');
    expect(workflow).toContain('codesign --verify --deep --strict --verbose=2 "$APP"');
    expect(workflow).toContain('"$APP/Contents/Resources/pi/pi" --version');
    expect(workflow).toContain('"$APP/Contents/Resources/bun/bun" --version');
  });
});
