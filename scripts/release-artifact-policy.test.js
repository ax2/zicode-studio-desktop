// @vitest-environment node
import { describe, expect, it } from "vitest";
import { missingReleaseBundlesMessage, validateReleaseBundleName, validateReleaseBundleTypes } from "./release-artifact-policy.mjs";

describe("release bundle architecture policy", () => {
  it.each([
    ["windows-x64", "nsis", "_x64-setup.exe"],
    ["darwin-arm64", "dmg", "_aarch64.dmg"],
    ["darwin-x64", "dmg", "_x64.dmg"],
    ["linux-x64", "appimage", "_amd64.AppImage"],
    ["linux-x64", "deb", "_amd64.deb"],
  ])("accepts the %s %s filename and rejects another architecture", (target, type, suffix) => {
    expect(() => validateReleaseBundleName(target, type, `ZiCode Studio Desktop_0.1.0${suffix}`)).not.toThrow();
    expect(() => validateReleaseBundleName(target, type, `ZiCode_0.1.0${suffix.replace(/x64|amd64|aarch64/, "wrong")}`)).toThrow("architecture");
  });

  it("requires the complete platform bundle set without duplicates", () => {
    expect(() => validateReleaseBundleTypes("linux-x64", ["deb", "appimage"])).not.toThrow();
    for (const requested of [[], ["deb"], ["appimage", "deb", "deb"], ["nsis", "deb"]]) {
      expect(() => validateReleaseBundleTypes("linux-x64", requested)).toThrow("exactly");
    }
    expect(() => validateReleaseBundleTypes("windows-x64", ["nsis"])).not.toThrow();
    expect(() => validateReleaseBundleTypes("darwin-arm64", ["dmg"])).not.toThrow();
    expect(() => validateReleaseBundleTypes("darwin-x64", ["dmg"])).not.toThrow();
    expect(() => validateReleaseBundleTypes(undefined, ["nsis"])).toThrow("Unsupported");
    expect(() => validateReleaseBundleName("windows-x64", "dmg", "test_x64.dmg")).toThrow("architecture");
  });

  it("reports multiple missing bundles by name without treating array indexes as suffixes", () => {
    expect(missingReleaseBundlesMessage(["target/release/a.exe", "target/release/b.deb"]))
      .toBe("Draft release is missing matching bundles: a.exe, b.deb");
  });
});
