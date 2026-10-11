// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { matchingReleaseAsset, readDraftReleaseAssets } from "./release-draft-assets.mjs";

describe("draft release lookup", () => {
  it("queries the authenticated draft through the CLI without the published-only tag endpoint", () => {
    const execute = vi.fn(() => JSON.stringify({ isDraft: true, assets: [{ name: "test.exe" }] }));
    expect(readDraftReleaseAssets("ax2/zicode-studio-desktop", "v0.4.2", execute)).toEqual([
      { name: "test.exe" },
    ]);
    expect(execute).toHaveBeenCalledWith(
      "gh",
      [
        "release",
        "view",
        "v0.4.2",
        "--repo",
        "ax2/zicode-studio-desktop",
        "--json",
        "isDraft,assets",
      ],
      expect.objectContaining({ timeout: 30_000 }),
    );
  });

  it.each([
    { isDraft: false, assets: [] },
    { isDraft: true },
    {},
  ])("rejects a public or malformed release: %j", (release) => {
    expect(() =>
      readDraftReleaseAssets("owner/repo", "v1.0.0", () => JSON.stringify(release)),
    ).toThrow("not a draft");
  });

  it("propagates lookup failures instead of inventing an empty successful inventory", () => {
    expect(() =>
      readDraftReleaseAssets("owner/repo", "v1.0.0", () => {
        throw new Error("denied");
      }),
    ).toThrow("denied");
  });
});

describe("uploaded release filename identity", () => {
  const local = "ZiCode Studio Desktop_0.4.2_amd64.deb";
  it("accepts the exact name", () => {
    const asset = { name: local, size: 123, digest: "sha256:example" };
    expect(matchingReleaseAsset([asset], local)).toBe(asset);
  });
  it("accepts only the observed ASCII-space to period normalization", () => {
    const asset = { name: "ZiCode.Studio.Desktop_0.4.2_amd64.deb" };
    expect(matchingReleaseAsset([asset], local)).toBe(asset);
    expect(
      matchingReleaseAsset([{ name: "ZiCode-Studio-Desktop_0.4.2_amd64.deb" }], local),
    ).toBeUndefined();
  });
  it("does not match another version or architecture", () => {
    expect(
      matchingReleaseAsset([{ name: "ZiCode.Studio.Desktop_0.4.1_amd64.deb" }], local),
    ).toBeUndefined();
    expect(
      matchingReleaseAsset([{ name: "ZiCode.Studio.Desktop_0.4.2_arm64.deb" }], local),
    ).toBeUndefined();
  });
  it("rejects ambiguous aliases rather than selecting an arbitrary asset", () => {
    expect(() =>
      matchingReleaseAsset([{ name: local }, { name: local.replace(/ /g, ".") }], local),
    ).toThrow("Ambiguous");
  });
});

it("pins verifier infrastructure separately and preserves it before checking out the immutable application", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
  const snapshot = workflow.indexOf("- name: Preserve pinned release verification tools");
  const application = workflow.indexOf("- name: Checkout pinned release commit");
  expect(snapshot).toBeGreaterThan(-1);
  expect(application).toBeGreaterThan(snapshot);
  // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expressions are literal workflow syntax.
  expect(workflow).toContain("ref: ${{ github.workflow_sha }}");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expressions are literal workflow syntax.
  expect(workflow).toContain("ref: ${{ needs.prepare-release.outputs.release_sha }}");
  expect(workflow).toContain(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expressions are literal workflow syntax.
    'run: bun "$RUNNER_TEMP/studio-release-verifier/verify-release-artifacts.mjs" "${{ matrix.bundles }}"',
  );
});
