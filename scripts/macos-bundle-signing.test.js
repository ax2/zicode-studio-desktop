// @vitest-environment node
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  macosBundleOverride,
  macosHelperTargets,
  signMacosHelpers,
  signMacosRelay,
} from "./macos-bundle-signing.mjs";

const directory = mkdtempSync(join(tmpdir(), "zicode-macos-signing-"));
const binary = join(directory, "zicode-relay");
const helper = join(directory, "e2ee_key");
const header = Buffer.alloc(64);
header.writeUInt32LE(0xfeedfacf, 0);
header.writeUInt32LE(0x01000007, 4);
writeFileSync(binary, header);
writeFileSync(helper, header);
afterAll(() => {
  unlinkSync(binary);
  unlinkSync(helper);
  rmdirSync(directory);
});

describe("macOS helper signing before bundle creation", () => {
  it("discovers all Cargo binaries including auto-discovered helpers", () => {
    const bin = (name) => ({ name, kind: ["bin"] });
    expect(
      macosHelperTargets({
        packages: [
          {
            name: "zicode-studio-desktop",
            targets: [
              bin("zicode-studio-desktop"),
              bin("zicode-relay"),
              bin("e2ee_key"),
              bin("future-helper"),
              { name: "library", kind: ["lib"] },
            ],
          },
        ],
      }),
    ).toEqual(["zicode-relay", "e2ee_key", "future-helper"]);
  });
  it("rejects missing required targets or unsafe binary paths", () => {
    expect(() => macosHelperTargets({ packages: [] })).toThrow("Studio Cargo package");
    expect(() =>
      macosHelperTargets({ packages: [{ name: "zicode-studio-desktop", targets: [] }] }),
    ).toThrow("Missing Studio application");
    expect(() =>
      macosHelperTargets({
        packages: [
          {
            name: "zicode-studio-desktop",
            targets: [
              { name: "zicode-studio-desktop", kind: ["bin"] },
              { name: "zicode-relay", kind: ["bin"] },
              { name: "../outside", kind: ["bin"] },
            ],
          },
        ],
      }),
    ).toThrow("Unsafe Cargo binary name");
  });
  it("signs and verifies relay and e2ee_key before the main app is bundled", () => {
    const execute = vi.fn();
    signMacosHelpers(directory, ["zicode-relay", "e2ee_key"], "darwin-x64", execute, "darwin");
    expect(execute).toHaveBeenCalledTimes(4);
    expect(execute.mock.calls[2][1]).toEqual(["--force", "--sign", "-", helper]);
  });
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
    expect(workflow).toContain('verify-macos-dmg.mjs"');
    expect(workflow).toMatch(/\$\{DMGS\[0\]\}.*PI_TARGET_PLATFORM.*RELEASE_TAG#v.*PI_VERSION/);
  });
});
