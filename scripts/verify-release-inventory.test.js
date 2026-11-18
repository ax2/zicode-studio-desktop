// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyReleaseInventory } from "./verify-release-inventory.mjs";

const exe = { name: "ZiCode.Studio.Desktop_0.6.5_x64-setup.exe" };
const tools = { name: "zicode-studio-v0.6.5-file-tools.zip",
  digest: "sha256:a06c5e9759bf028eb1b95da8a29ac5cfbeae68487b10f068c0253661e4f87163" };
const all = [exe, ...["_aarch64.dmg", "_x64.dmg", "_amd64.AppImage", "_amd64.deb"].map(suffix => ({ name: `Studio_0.6.5${suffix}` }))];
const verify = (assets, tag = "v0.6.5", platform = "windows") => verifyReleaseInventory(assets, { tag, platform });

describe("strict optional file-tools release inventory", () => {
  it.each(["v0.6.5", "v0.6.6", "v0.7.0-preview.1"])("keeps the default installer-only %s release valid", tag => {
    expect(verify([exe], tag)).toEqual({ installerCount: 1, optionalAttachments: 0 });
  });
  it("accepts only the independently verified optional attachment alongside the full installer set", () => {
    expect(verify([tools, exe])).toEqual({ installerCount: 1, optionalAttachments: 1 });
    expect(verify(all, "v0.6.5", "all")).toEqual({ installerCount: 5, optionalAttachments: 0 });
    expect(verify([...all, tools], "v0.6.5", "all")).toEqual({ installerCount: 5, optionalAttachments: 1 });
  });
  it.each(["v0.6.4", "v0.6.6", "v0.6.5-preview.1"])("rejects the exact ZIP on another tag %s", tag => {
    expect(() => verify([exe, tools], tag)).toThrow("verified tag");
  });
  it.each([undefined, null, "", "a06c5e9759bf028eb1b95da8a29ac5cfbeae68487b10f068c0253661e4f87163", `sha256:${"0".repeat(64)}`])("rejects a missing/wrong GitHub digest %s", digest => {
    expect(() => verify([exe, { ...tools, digest }])).toThrow("GitHub digest");
  });
  it.each(["zicode-studio-v0.6.6-file-tools.zip", "zicode-studio-v0.6.5-file-tools.ZIP", "renamed.zip", "SHA256SUMS.txt", "latest.json", "Studio_x64-setup.exe.sig"])("rejects unapproved attachment %s despite an approved digest", name => {
    expect(() => verify([exe, { ...tools, name }])).toThrow("Unexpected release asset");
  });
  it("never lets the optional ZIP substitute for missing/duplicate/wrong installers", () => {
    for (const assets of [[], [tools], [exe, exe], [exe, tools, tools], [exe, all[1]], [{ name: "Studio_arm64-setup.exe" }, tools]]) {
      expect(() => verify(assets)).toThrow();
    }
    for (const assets of [all.slice(1), [...all, exe], [...all.slice(0, 4), tools]]) {
      expect(() => verify(assets, "v0.6.5", "all")).toThrow();
    }
    expect(() => verify(all, "v0.6.5", "windows")).toThrow("installer set");
    expect(() => verify([exe], "v0.6.5", "macos-intel")).toThrow("Unsupported");
  });
  it("preserves the workflow-source verifier before checkout of the frozen application tag", () => {
    const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
    const publish = workflow.slice(workflow.indexOf("  publish-release:"));
    const preserve = publish.indexOf("- name: Preserve fixed publishing verifier");
    const application = publish.indexOf("- name: Checkout release tag");
    expect(preserve).toBeGreaterThan(-1);
    expect(application).toBeGreaterThan(preserve);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub workflow expression.
    expect(publish.slice(0, preserve)).toContain("ref: ${{ github.workflow_sha }}");
    expect(publish).toContain('run: bun "$RUNNER_TEMP/studio-release-inventory/verify-release-inventory.mjs"');
    expect(publish.indexOf("Verify tag still points to built commit")).toBeLessThan(publish.indexOf("Verify draft contains"));
  });
});
