import { describe, expect, it } from "vitest";
import { assessRequirement, type EnvironmentRequirement } from "./environment-requirements";

function assess(
  tool: string,
  kind: EnvironmentRequirement["kind"],
  constraint: string,
  version: string,
) {
  return assessRequirement({ tool, kind, constraint }, [
    { id: tool, version, status: "ready", executable: "/host/tool" },
  ]).status;
}

describe("Rust and Go host version comparisons", () => {
  it.each([
    ["1.78", "1.88.0", "satisfied"],
    ["1.88.1", "1.88.0", "mismatch"],
    ["1.88", "1.88.0", "satisfied"],
    ["1.89.0", "1.88.9", "mismatch"],
    ["^1.88", "1.88.0", "invalid"],
    ["1.88.0-beta.1", "1.88.0", "invalid"],
    ["1.088", "1.88.0", "invalid"],
  ])("compares Rust minimum %s against %s as %s", (constraint, version, expected) => {
    expect(assess("rustc", "minimum", constraint, `rustc ${version} (6b00bc388 2025-06-23)`)).toBe(
      expected,
    );
  });

  it("distinguishes exact Rust pins, inherited values and floating channels", () => {
    const observed = "rustc 1.88.0 (6b00bc388 2025-06-23)";
    expect(assess("rustc", "toolchain", "1.88.0", observed)).toBe("satisfied");
    expect(assess("rustc", "toolchain", "1.87.0", observed)).toBe("mismatch");
    for (const channel of [
      "stable",
      "nightly-2026-09-01",
      "beta",
      "1.88",
      "1.88.0-x86_64-pc-windows-msvc",
    ]) {
      expect(assess("rustc", "toolchain", channel, observed)).toBe("unsupported");
    }
    expect(assess("rustc", "inherited", "workspace", observed)).toBe("unsupported");
    expect(assess("rustc", "minimum", "1.88", "cargo 1.88.0 (6b00bc388 2025-06-23)")).toBe(
      "unknown-version",
    );
    expect(assess("rustc", "minimum", "1.88", "rustc 1.89.0-nightly (6b00bc388 2025-06-23)")).toBe(
      "unknown-version",
    );
  });

  it.each([
    ["1.23", "go1.23.0", "satisfied"],
    ["1.23.1", "go1.23.0", "mismatch"],
    ["1.23", "go1.22.9", "mismatch"],
    ["1.23", "go1.23rc1", "satisfied"],
    ["1.23.0", "go1.23rc2", "mismatch"],
    ["1.23rc2", "go1.23beta9", "mismatch"],
    ["1.23beta2", "go1.23rc1", "satisfied"],
    ["1.23rc2", "go1.23rc10", "satisfied"],
    ["1.20", "go1.20rc3", "mismatch"],
    ["1.20", "go1.20", "satisfied"],
    ["1.20.1", "go1.20", "mismatch"],
    ["go1.23", "go1.23.0", "invalid"],
    ["1.23.00", "go1.23.0", "invalid"],
  ])("compares Go minimum %s against %s as %s", (constraint, version, expected) => {
    expect(assess("go", "minimum", constraint, `go version ${version} windows/amd64`)).toBe(
      expected,
    );
  });

  it("handles recommendations, invalid output and unavailable tools conservatively", () => {
    expect(assess("go", "recommended", "go1.23.4", "go version go1.23.5 linux/arm64")).toBe(
      "satisfied",
    );
    expect(assess("go", "recommended", "go1.23.4", "go version go1.23.3 darwin/arm64")).toBe(
      "mismatch",
    );
    expect(assess("go", "recommended", "default", "go version go1.23.4 linux/amd64")).toBe(
      "unsupported",
    );
    for (const output of [
      "go version devel go1.24-abcdef linux/amd64",
      "warning go1.23.4",
      "go version go1.23.4 linux/amd64 extra",
    ]) {
      expect(assess("go", "minimum", "1.23", output)).toBe("unknown-version");
    }
    for (const tool of ["go", "rustc"]) {
      const requirement: EnvironmentRequirement = { tool, kind: "minimum", constraint: "1.23" };
      expect(assessRequirement(requirement, []).status).toBe("unavailable");
      expect(
        assessRequirement(requirement, [
          { id: tool, status: "missing", version: null, executable: null },
        ]).status,
      ).toBe("missing");
      expect(assessRequirement({ ...requirement, truncated: true }, []).status).toBe("truncated");
      expect(assessRequirement({ ...requirement, kind: undefined }, []).status).toBe("unsupported");
    }
  });
});
