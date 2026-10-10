import { describe, expect, it } from "vitest";
import {
  assessRequirement,
  type DetectedTool,
  type EnvironmentRequirement,
} from "./environment-requirements";

const python: DetectedTool = {
  id: "python",
  status: "ready",
  version: "Python 3.14.7",
  executable: "/host/python3",
};
const assessment = { status: "satisfied", version: "3.14.7", observedVersion: "Python 3.14.7" };
const requirement: EnvironmentRequirement = {
  tool: "python",
  kind: "pep440",
  constraint: ">=3.12,!=3.13.*",
  truncated: false,
  assessment,
};

describe("Python Host assessments", () => {
  it.each([
    "satisfied",
    "mismatch",
    "invalid",
    "unknown-version",
    "unavailable",
  ])("preserves the Host's %s status", (status) => {
    expect(
      assessRequirement({ ...requirement, assessment: { ...assessment, status } }, [
        python,
      ]).status,
    ).toBe(status);
  });

  it("retains missing-tool and truncated states", () => {
    expect(
      assessRequirement(
        { ...requirement, assessment: { status: "missing", version: null, observedVersion: null } },
        [{ ...python, status: "missing", version: null }],
      ).status,
    ).toBe("missing");
    expect(assessRequirement({ ...requirement, truncated: true }, [python]).status).toBe(
      "truncated",
    );
  });

  it("does not apply semver when an older host omitted the assessment", () => {
    expect(assessRequirement({ ...requirement, assessment: undefined }, [python]).status).toBe(
      "unsupported",
    );
    for (const kind of ["dynamic", "poetry", undefined] as const) {
      expect(assessRequirement({ ...requirement, kind }, [python]).status).toBe("unsupported");
    }
  });

  it("rejects stale, malformed and mismatched success reports", () => {
    expect(assessRequirement(requirement, [{ ...python, version: "Python 3.12.0" }]).status).toBe(
      "unavailable",
    );
    expect(assessRequirement(requirement, [{ ...python, status: "failed" }]).status).toBe(
      "unavailable",
    );
    expect(assessRequirement(requirement, []).status).toBe("unavailable");
    for (const patch of [
      { status: "invented" },
      { version: null },
      { version: "" },
      { version: "3".repeat(200) },
      { status: "missing" },
    ]) {
      expect(
        assessRequirement(
          { ...requirement, assessment: { ...assessment, ...patch } },
          [python],
        ).status,
      ).toBe("unavailable");
    }
  });
});
