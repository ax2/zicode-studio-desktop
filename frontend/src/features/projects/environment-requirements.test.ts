import { describe, expect, it } from "vitest";
import { assessRequirement, type DetectedTool } from "./environment-requirements";

function tool(id: string, version: string | null, status = "ready"): DetectedTool {
  return { id, version, status, executable: "/installed/tool" };
}

describe("JavaScript version requirements", () => {
  it.each([
    [">=22", "v24.0.0", "satisfied"],
    [">=22", "v20.19.0", "mismatch"],
    ["^22.3.0", "22.8.0", "satisfied"],
    ["^22.3.0", "23.0.0", "mismatch"],
    ["~22.3.0", "22.4.0", "mismatch"],
    ["18 || >=22 <25", "v24.2.0", "satisfied"],
    ["20.0.0 - 22.9.0", "22.9.0", "satisfied"],
    ["22.x", "22.99.0", "satisfied"],
    [">=22", "23.0.0-rc.1", "mismatch"],
    [">=23.0.0-rc.1 <24", "23.0.0-rc.2", "satisfied"],
    ["*", "22.1.0", "satisfied"],
    ["nonsense", "22.1.0", "invalid"],
    ["", "22.1.0", "invalid"],
    [">=22", "warning: version 22.1.0", "unknown-version"],
    [">=22", "22", "unknown-version"],
  ])("compares %s against %s as %s", (constraint, version, status) => {
    expect(assessRequirement({ tool: "node", constraint }, [tool("node", version)]).status).toBe(
      status,
    );
  });

  it("compares exact package manager versions without claiming integrity verification", () => {
    expect(
      assessRequirement({ tool: "packageManager", constraint: "bun@1.3.14+sha512.abcdef" }, [
        tool("bun", "1.3.14"),
      ]).status,
    ).toBe("satisfied");
    expect(
      assessRequirement({ tool: "packageManager", constraint: "pnpm@10.0.0" }, [
        tool("pnpm", "10.1.0"),
      ]).status,
    ).toBe("mismatch");
    for (const constraint of [
      "yarn@^4",
      "bun@latest",
      "npm",
      "yarn@https://example.invalid/pkg.tgz",
    ]) {
      expect(assessRequirement({ tool: "packageManager", constraint }, []).status).toBe("invalid");
    }
  });

  it("preserves missing, failed, unsupported and truncated states", () => {
    const requirement = { tool: "node", constraint: ">=22" };
    expect(assessRequirement(requirement, [tool("node", `24.0.0-${"a".repeat(193)}`)]).status).toBe(
      "unknown-version",
    );
    expect(assessRequirement(requirement, [tool("node", null, "missing")]).status).toBe("missing");
    expect(assessRequirement(requirement, [tool("node", "24.0.0", "timeout")]).status).toBe(
      "unavailable",
    );
    expect(assessRequirement(requirement, []).status).toBe("unavailable");
    expect(
      assessRequirement({ tool: "deno", constraint: ">=2" }, [tool("deno", "2.0.0")]).status,
    ).toBe("unsupported");
    expect(
      assessRequirement({ ...requirement, truncated: true }, [tool("node", "24.0.0")]).status,
    ).toBe("truncated");
    expect(
      assessRequirement({ ...requirement, constraint: ">=22".padEnd(200) }, [
        tool("node", "24.0.0"),
      ]).status,
    ).toBe("truncated");
    expect(assessRequirement({ ...requirement, constraint: "1".repeat(201) }, []).status).toBe(
      "truncated",
    );
  });
});
