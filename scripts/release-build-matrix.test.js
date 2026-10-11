// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { releaseBuildMatrix } from "./release-build-matrix.mjs";

describe("explicit release build scope", () => {
  it("keeps all four platforms as the default", () => {
    expect(releaseBuildMatrix().include.map((entry) => entry.pi_target)).toEqual([
      "windows-x64",
      "darwin-arm64",
      "darwin-x64",
      "linux-x64",
    ]);
  });
  it("can rebuild only Intel while preserving all job gates", () => {
    expect(releaseBuildMatrix("macos-intel")).toEqual({
      include: [
        { name: "macOS Intel", os: "macos-15-intel", pi_target: "darwin-x64", bundles: "dmg" },
      ],
    });
  });
  it("refuses arbitrary platform input", () => {
    expect(() => releaseBuildMatrix("anything")).toThrow("Unsupported");
  });
  it("prohibits automatic publication from a partial build", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).toContain(
      "if: github.event_name != 'workflow_dispatch' || inputs.platform == 'all'",
    );
    expect(workflow).toContain("fromJSON(needs.prepare-release.outputs.build_matrix)");
    expect(workflow).toContain("Verify uploaded platform bundles");
  });
});
