import type {
  DetectedTool,
  EnvironmentRequirement,
  RequirementAssessment,
  RequirementStatus,
} from "./environment-requirements";

const STATUSES = new Set<RequirementStatus>([
  "satisfied",
  "mismatch",
  "missing",
  "unavailable",
  "unsupported",
  "invalid",
  "truncated",
  "unknown-version",
]);

/** Python grammar lives in the Host. Older hosts must never fall back to npm semver. */
export function readPythonAssessment(
  requirement: EnvironmentRequirement,
  tools: DetectedTool[],
): RequirementAssessment {
  const tool = "python";
  if (requirement.kind !== "pep440") return { tool, status: "unsupported" };
  const result = requirement.assessment;
  if (!result) return { tool, status: "unsupported" };
  const status = result.status as RequirementStatus;
  const detected = tools.find((entry) => entry.id === tool);
  if (!STATUSES.has(status) || !detected || result.observedVersion !== detected.version) {
    return { tool, status: "unavailable" };
  }
  if (status === "satisfied" || status === "mismatch") {
    if (
      detected.status !== "ready" ||
      typeof result.version !== "string" ||
      !result.version ||
      result.version.length >= 200
    ) {
      return { tool, status: "unavailable" };
    }
    return { tool, status, version: result.version };
  }
  if (status === "missing" && detected.status !== "missing") return { tool, status: "unavailable" };
  return { tool, status };
}
