import satisfies from "semver/functions/satisfies";
import valid from "semver/functions/valid";
import validRange from "semver/ranges/valid";
import type {
  DetectedTool,
  EnvironmentRequirement,
  RequirementAssessment,
} from "./environment-requirements";

// These forms have the same release semantics in Composer and node-semver.
const COMPARABLE = /^(?:\d+\.\d+\.\d+|\^[1-9]\d*\.\d+(?:\.\d+)?|>=\d+\.\d+(?:\.\d+)?)$/;

export function assessComposerPhpRequirement(
  requirement: EnvironmentRequirement,
  tools: DetectedTool[],
): RequirementAssessment {
  const tool = "php";
  const range = requirement.constraint.trim();
  if (!COMPARABLE.test(range) || !validRange(range)) return { status: "unsupported", tool };
  const detected = tools.find((candidate) => candidate.id === tool);
  if (!detected) return { status: "unavailable", tool };
  if (detected.status === "missing") return { status: "missing", tool };
  if (detected.status !== "ready") return { status: "unavailable", tool };
  const output = detected.version?.trim() || "";
  const observed = output.length < 200 ? /^PHP (\d+\.\d+\.\d+)(?:\s|$)/.exec(output)?.[1] : null;
  const version = observed && valid(observed);
  if (!version) return { status: "unknown-version", tool };
  return { status: satisfies(version, range) ? "satisfied" : "mismatch", tool, version };
}
