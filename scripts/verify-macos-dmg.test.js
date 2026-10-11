// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { verifyMacosDmg, verifyMountedMacosApp } from "./verify-macos-dmg.mjs";

function appExecutor() {
  return vi.fn((command) => {
    command = command.replaceAll("\\", "/");
    if (command === "/usr/libexec/PlistBuddy") return Buffer.from("0.4.2\n");
    if (command.endsWith("/pi/pi")) return Buffer.from("1.1.0\n");
    if (command.endsWith("/bun/bun")) return Buffer.from("1.3.14\n");
    return Buffer.alloc(0);
  });
}

describe("final DMG application verification", () => {
  it("checks app version, four executable architectures, signatures and both runtimes", () => {
    const execute = appExecutor();
    const architecture = vi.fn();
    expect(
      verifyMountedMacosApp("/volume/app", "darwin-x64", "0.4.2", "1.1.0", execute, architecture),
    ).toEqual({ version: "0.4.2", pi: "1.1.0", bun: "1.3.14", target: "darwin-x64" });
    expect(architecture).toHaveBeenCalledTimes(4);
    expect(execute).toHaveBeenCalledWith(
      "codesign",
      ["--verify", "--deep", "--strict", "--verbose=2", "/volume/app"],
      expect.any(Object),
    );
    expect(execute).toHaveBeenCalledWith(
      "codesign",
      ["--verify", "--strict", "--verbose=2", expect.stringContaining("zicode-relay")],
      expect.any(Object),
    );
  });
  it("rejects mismatched app version before checking signatures or running binaries", () => {
    const execute = appExecutor();
    expect(() =>
      verifyMountedMacosApp("/app", "darwin-x64", "0.4.3", "1.1.0", execute, vi.fn()),
    ).toThrow("App version mismatch");
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("rejects architecture mismatch before running any bundled runtime", () => {
    const execute = appExecutor();
    expect(() =>
      verifyMountedMacosApp("/app", "darwin-x64", "0.4.2", "1.1.0", execute, () => {
        throw new Error("architecture mismatch");
      }),
    ).toThrow("architecture mismatch");
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("propagates signature failure without executing Pi", () => {
    const execute = appExecutor()
      .mockImplementationOnce(() => Buffer.from("0.4.2"))
      .mockImplementationOnce(() => {
        throw new Error("signature failed");
      });
    expect(() =>
      verifyMountedMacosApp("/app", "darwin-x64", "0.4.2", "1.1.0", execute, vi.fn()),
    ).toThrow("signature failed");
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it("rejects a different Pi version", () => {
    expect(() =>
      verifyMountedMacosApp("/app", "darwin-x64", "0.4.2", "9.9.9", appExecutor(), vi.fn()),
    ).toThrow("Embedded Pi version mismatch");
  });
});

describe("read-only disk image lifecycle", () => {
  it("mounts read-only, validates the mounted app, then detaches", () => {
    const execute = vi.fn();
    const verify = vi.fn(() => ({ passed: true }));
    expect(
      verifyMacosDmg("final.dmg", "darwin-x64", "0.4.2", "1.1.0", execute, "darwin", verify),
    ).toEqual({ passed: true });
    expect(execute.mock.calls[0][1]).toEqual(
      expect.arrayContaining(["attach", "-readonly", "-nobrowse", "-mountpoint"]),
    );
    expect(execute.mock.calls[1][1][0]).toBe("detach");
    expect(verify.mock.calls[0][0]).toContain("ZiCode Studio Desktop.app");
  });
  it("detaches even when app validation fails", () => {
    const execute = vi.fn();
    expect(() =>
      verifyMacosDmg("final.dmg", "darwin-x64", "0.4.2", "1.1.0", execute, "darwin", () => {
        throw new Error("invalid app");
      }),
    ).toThrow("invalid app");
    expect(execute.mock.calls[1][1][0]).toBe("detach");
  });
  it("does not validate or detach if mounting failed", () => {
    const execute = vi.fn(() => {
      throw new Error("mount failed");
    });
    const verify = vi.fn();
    expect(() =>
      verifyMacosDmg("final.dmg", "darwin-x64", "0.4.2", "1.1.0", execute, "darwin", verify),
    ).toThrow("mount failed");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(verify).not.toHaveBeenCalled();
  });
  it("refuses non-macOS before mounting", () => {
    const execute = vi.fn();
    expect(() =>
      verifyMacosDmg("final.dmg", "darwin-x64", "0.4.2", "1.1.0", execute, "win32"),
    ).toThrow("native macOS");
    expect(execute).not.toHaveBeenCalled();
  });
});
