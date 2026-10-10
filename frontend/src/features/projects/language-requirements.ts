import type {
  DetectedTool,
  EnvironmentRequirement,
  RequirementAssessment,
} from "./environment-requirements";

type Version = number[];
const NUMBER = "(?:0|[1-9][0-9]*)";
const RELEASE = new RegExp(`^(${NUMBER})\\.(${NUMBER})(?:\\.(${NUMBER}))?$`);
const GO_VERSION = new RegExp(
  `^(?:go)?(${NUMBER})\\.(${NUMBER})(?:(?:\\.(${NUMBER}))|(?:(beta|rc)(${NUMBER})))?$`,
);

function safe(values: number[]): Version | null {
  return values.every(Number.isSafeInteger) ? values : null;
}

function rustVersion(value: string): Version | null {
  const match = RELEASE.exec(value);
  return match ? safe([Number(match[1]), Number(match[2]), Number(match[3] || 0)]) : null;
}

// Since Go 1.21, a bare language version (1.23) sorts before beta, rc and 1.23.0.
// Older bare versions (go1.20) denote the initial final release.
function goVersion(value: string): Version | null {
  const match = GO_VERSION.exec(value);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const language = !match[3] && !match[4] && (major > 1 || (major === 1 && minor >= 21));
  return safe([
    major,
    minor,
    Number(match[3] || 0),
    language ? -3 : match[4] === "beta" ? -2 : match[4] === "rc" ? -1 : 0,
    Number(match[5] || 0),
  ]);
}

function compare(left: Version, right: Version): number {
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

/** Host-default tool comparison only; does not resolve rustup overrides or download toolchains. */
export function assessLanguageRequirement(
  requirement: EnvironmentRequirement,
  tools: DetectedTool[],
): RequirementAssessment {
  const { tool, kind } = requirement;
  const constraint = requirement.constraint.trim();
  if (kind === "inherited") return { status: "unsupported", tool };
  if (
    tool === "rustc" &&
    kind === "toolchain" &&
    /^(stable|beta|nightly)(?:-|$)/.test(constraint)
  ) {
    return { status: "unsupported", tool };
  }
  if (tool === "go" && kind === "recommended" && constraint === "default")
    return { status: "unsupported", tool };
  if (!kind || !["minimum", "workspace-minimum", "toolchain", "recommended"].includes(kind))
    return { status: "unsupported", tool };
  const parse = tool === "rustc" ? rustVersion : goVersion;
  // A pinned Rust channel must be a full numeric release; partial aliases can float across patches.
  if (tool === "rustc" && kind === "toolchain" && !/^\d+\.\d+\.\d+$/.test(constraint))
    return { status: "unsupported", tool };
  if (tool === "go" && kind === "minimum" && constraint.startsWith("go"))
    return { status: "invalid", tool };
  if (tool === "go" && kind === "recommended" && !constraint.startsWith("go"))
    return { status: "invalid", tool };
  const required = parse(constraint);
  if (!required) return { status: "invalid", tool };
  const detected = tools.find((candidate) => candidate.id === tool);
  if (!detected) return { status: "unavailable", tool };
  if (detected.status === "missing") return { status: "missing", tool };
  if (detected.status !== "ready") return { status: "unavailable", tool };
  const output = detected.version?.trim() || "";
  const match =
    output.length < 200
      ? tool === "rustc"
        ? /^rustc (\d+\.\d+\.\d+) \([a-f0-9]+ \d{4}-\d{2}-\d{2}\)$/.exec(output)
        : /^go version (go\d+\.\d+(?:\.\d+|(?:beta|rc)\d+)?) [a-z0-9]+\/[a-z0-9]+$/.exec(output)
      : null;
  const version = match?.[1];
  const observed = version && parse(version);
  if (!observed) return { status: "unknown-version", tool };
  const order = compare(observed, required);
  return {
    status: (kind === "toolchain" ? order === 0 : order >= 0) ? "satisfied" : "mismatch",
    tool,
    version,
  };
}
