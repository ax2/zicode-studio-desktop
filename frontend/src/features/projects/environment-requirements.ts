import satisfies from "semver/functions/satisfies";
import valid from "semver/functions/valid";
import validRange from "semver/ranges/valid";
import { assessComposerPhpRequirement } from "./composer-php-requirement";
import { assessLanguageRequirement } from "./language-requirements";
import { readPythonAssessment } from "./python-requirements";
import { assessVersionManagerRequirement } from "./version-manager-requirements";

export interface EnvironmentRequirement {
  tool: string;
  constraint: string;
  truncated?: boolean;
  kind?:
    | "minimum"
    | "workspace-minimum"
    | "toolchain"
    | "recommended"
    | "inherited"
    | "pep440"
    | "dynamic"
    | "poetry"
    | "node-version-file"
    | "version-manager"
    | "dotnet-sdk"
    | "composer-php"
    | "bundler-lock";
  assessment?: {
    status: string;
    version: string | null;
    observedVersion: string | null;
  };
}

export interface DetectedTool {
  source?: string;
  id: string;
  status: string;
  version: string | null;
  executable: string | null;
}

export type RequirementStatus =
  | "satisfied"
  | "mismatch"
  | "missing"
  | "unavailable"
  | "unsupported"
  | "invalid"
  | "truncated"
  | "unknown-version";

export interface RequirementAssessment {
  status: RequirementStatus;
  tool: string;
  version?: string;
}

const SUPPORTED_TOOLS = new Set(["node", "bun", "npm", "pnpm", "yarn"]);

/** Compare supported declarations or read Host PEP 440 assessments; never executes tools. */
export function assessRequirement(
  requirement: EnvironmentRequirement,
  tools: DetectedTool[],
): RequirementAssessment {
  let tool = requirement.tool;
  let range = requirement.constraint.trim();
  if (
    requirement.truncated ||
    requirement.constraint.length > 200 ||
    (requirement.truncated === undefined && requirement.constraint.length === 200)
  ) {
    return { status: "truncated", tool };
  }
  if (requirement.kind === "version-manager" || requirement.kind === "bundler-lock")
    return assessVersionManagerRequirement(requirement, tools);
  if (requirement.kind === "composer-php") return assessComposerPhpRequirement(requirement, tools);
  if (tool === "packageManager") {
    const declared = /^([a-z]+)@(.+)$/.exec(range);
    if (!declared) return { status: "invalid", tool };
    tool = declared[1];
    range = declared[2];
    // packageManager pins a full version, optionally with build/integrity metadata.
    if (!valid(range)) return { status: "invalid", tool };
  }
  if (tool === "rustc" || tool === "go") return assessLanguageRequirement(requirement, tools);
  if (tool === "python") return readPythonAssessment(requirement, tools);
  if (
    requirement.kind === "node-version-file" &&
    /^(?:node|stable|unstable|system|lts(?:\/(?:\*|[a-z0-9_-]+))?)$/i.test(range)
  ) {
    return { status: "unsupported", tool };
  }
  if (!SUPPORTED_TOOLS.has(tool)) return { status: "unsupported", tool };
  if (!range || !validRange(range)) return { status: "invalid", tool };
  const detected = tools.find((candidate) => candidate.id === tool);
  if (!detected) return { status: "unavailable", tool };
  if (detected.status === "missing") return { status: "missing", tool };
  if (detected.status !== "ready") return { status: "unavailable", tool };
  // Do not coerce a warning, partial version, or unrelated number into a successful check.
  const observed = detected.version?.trim();
  const version =
    observed &&
    observed.length < 200 &&
    /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(observed)
      ? valid(observed)
      : null;
  if (!version) return { status: "unknown-version", tool };
  return { status: satisfies(version, range) ? "satisfied" : "mismatch", tool, version };
}
