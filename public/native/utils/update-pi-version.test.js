import { describe, expect, it } from "vitest";
import updater from "../../../scripts/update-pi-version.js";

const { REQUIRED_ASSETS, buildLock, normalizeVersion } = updater;

describe("Pi version updater", () => {
  it("builds a complete deterministic lock from GitHub release digests", () => {
    const assets = REQUIRED_ASSETS.map((name, index) => ({
      name,
      digest: `sha256:${String(index + 1).padStart(64, "0")}`,
    }));
    expect(buildLock({ tag_name: "v0.83.0", assets })).toMatchObject({
      version: "0.83.0",
      sha256: Object.fromEntries(
        REQUIRED_ASSETS.map((name, index) => [name, String(index + 1).padStart(64, "0")]),
      ),
    });
  });

  it("rejects incomplete or unsigned release assets", () => {
    expect(() => buildLock({ tag_name: "v0.83.0", assets: [] })).toThrow(
      "missing required release asset",
    );
    expect(() =>
      buildLock({
        tag_name: "v0.83.0",
        assets: REQUIRED_ASSETS.map((name) => ({ name, digest: null })),
      }),
    ).toThrow("has no trusted SHA-256 digest");
  });

  it("normalizes a tag and rejects non-release input", () => {
    expect(normalizeVersion("v0.83.0")).toBe("0.83.0");
    expect(() => normalizeVersion("main")).toThrow("Invalid Pi version");
  });
});
