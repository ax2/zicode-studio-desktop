import type { DetectedTool, EnvironmentRequirement } from "./environment-requirements";

type Manifest = {
  name: string;
  kind: string;
  status: string;
  requirements: EnvironmentRequirement[];
};

const KIND_TOOLS: Record<string, readonly string[]> = {
  javascript: ["node"],
  deno: ["deno"],
  rust: ["rustc", "cargo"],
  go: ["go"],
  python: ["python"],
  ruby: ["ruby"],
  php: ["php"],
  cmake: ["cmake", "ctest"],
  make: ["make"],
  java: ["java"],
  dotnet: ["dotnet", "dotnet-project"],
};

const MANIFEST_TOOLS: Record<string, readonly string[]> = {
  "pyproject.toml": ["poetry", "uv"],
  Gemfile: ["bundle"],
  "Gemfile.lock": ["bundle"],
  "composer.json": ["composer"],
  "pom.xml": ["mvn"],
  "build.gradle": ["gradle"],
  "build.gradle.kts": ["gradle"],
  "settings.gradle": ["gradle"],
  "settings.gradle.kts": ["gradle"],
};

const REQUIREMENT_TOOL: Record<string, string> = {
  nodejs: "node",
  rust: "rustc",
  golang: "go",
};

export function groupEnvironmentTools(
  manifests: Manifest[],
  tools: DetectedTool[],
  packageManager?: string | null,
): { project: DetectedTool[]; other: DetectedTool[] } {
  const relevant = new Set<string>();
  for (const manifest of manifests) {
    if (manifest.status !== "detected") continue;
    for (const id of KIND_TOOLS[manifest.kind] ?? []) relevant.add(id);
    for (const id of MANIFEST_TOOLS[manifest.name] ?? []) relevant.add(id);
    for (const requirement of manifest.requirements) {
      relevant.add(REQUIREMENT_TOOL[requirement.tool] ?? requirement.tool);
    }
  }
  if (packageManager) relevant.add(packageManager);
  if (!relevant.size) return { project: tools, other: [] };
  relevant.add("git");
  return {
    project: tools.filter((tool) => relevant.has(tool.id)),
    other: tools.filter((tool) => !relevant.has(tool.id)),
  };
}
