import valid from "semver/functions/valid";
import type {
  DetectedTool,
  EnvironmentRequirement,
  RequirementAssessment,
} from "./environment-requirements";
import { assessLanguageRequirement } from "./language-requirements";

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const SEMVER_TOOLS = new Map([
  ["node", "node"],
  ["nodejs", "node"],
  ["bun", "bun"],
  ["deno", "deno"],
  ["npm", "npm"],
  ["pnpm", "pnpm"],
  ["yarn", "yarn"],
  ["bundle", "bundle"],
]);

/** Compare only one exact release; aliases, paths, refs and fallback lists need a manager. */
export function assessVersionManagerRequirement(
  requirement: EnvironmentRequirement,
  tools: DetectedTool[],
): RequirementAssessment {
  const source = requirement.tool;
  const expected = requirement.constraint.trim();
  if (!EXACT_VERSION.test(expected)) return { status: "unsupported", tool: source };

  const languageTool =
    source === "rust" ? "rustc" : source === "golang" || source === "go" ? "go" : null;
  if (languageTool) {
    const result = assessLanguageRequirement(
      { ...requirement, tool: languageTool, kind: "toolchain" },
      tools,
    );
    return { ...result, tool: source };
  }

  const toolId =
    SEMVER_TOOLS.get(source) ??
    (source === "python" || source === "ruby" || source === "php" ? source : null);
  if (!toolId) return { status: "unsupported", tool: source };
  const normalizedExpected =
    source === "python" || source === "ruby" || source === "php" ? expected : valid(expected);
  if (!normalizedExpected) return { status: "unsupported", tool: source };
  const detected = tools.find((candidate) => candidate.id === toolId);
  if (!detected) return { status: "unavailable", tool: source };
  if (detected.status === "missing") return { status: "missing", tool: source };
  if (detected.status !== "ready") return { status: "unavailable", tool: source };

  const output = detected.version?.trim() || "";
  if (output.length >= 200) return { status: "unknown-version", tool: source };
  const observed = observedVersion(source, output);
  if (!observed) return { status: "unknown-version", tool: source };
  return {
    status: observed === normalizedExpected ? "satisfied" : "mismatch",
    tool: source,
    version: observed,
  };
}

function observedVersion(source: string, output: string): string | null {
  if (source === "python") return /^Python (\d+\.\d+\.\d+)$/.exec(output)?.[1] ?? null;
  if (source === "ruby") return /^ruby (\d+\.\d+\.\d+)(?:\s|$)/.exec(output)?.[1] ?? null;
  if (source === "php") return /^PHP (\d+\.\d+\.\d+)(?:\s|$)/.exec(output)?.[1] ?? null;
  if (source === "bundle") return /^Bundler version (\d+\.\d+\.\d+)$/.exec(output)?.[1] ?? null;
  if (source === "deno")
    return /^deno (\d+\.\d+\.\d+)(?:\s+\([^()\r\n]*\))?$/.exec(output)?.[1] ?? null;
  return /^v?\d+\.\d+\.\d+$/.test(output) ? valid(output) : null;
}
