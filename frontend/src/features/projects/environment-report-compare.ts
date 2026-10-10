import type { EnvironmentReport } from "./EnvironmentPanel";

export interface ImportedEnvironmentSnapshot {
  checkedAt: string;
  scope: "workspace-root" | "subproject";
  platform: string;
  architecture: string;
  piVersion: string;
  packageManager: string | null;
  tools: Array<{ id: string; status: string; version: string | null; source: string | null }>;
  manifests: ComparableManifest[];
}

interface ComparableRequirement {
  tool: string;
  kind?: string | null;
  constraint: string;
  truncated?: boolean;
}

interface ComparableManifest {
  kind: string;
  status: string;
  requirements: ComparableRequirement[];
}

interface DeclarationEntry {
  category: "manifest" | "requirement";
  manifestKind: string;
  status?: string;
  requirement?: ComparableRequirement;
  count: number;
}

const invalidFile = "Invalid environment report file.";
const MAX_FILE_BYTES = 1024 * 1024 + 1;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function bounded(value: unknown, max = 200): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function boundedText(value: unknown, max = 200): value is string {
  return typeof value === "string" && value.length <= max;
}

/** Accept only the path-minimized version 1 envelope created by this app. */
export async function readEnvironmentReportFile(file: File): Promise<ImportedEnvironmentSnapshot> {
  if (file.size > MAX_FILE_BYTES) throw new Error("Environment report exceeds 1 MiB.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error(invalidFile);
  }
  const value = record(parsed);
  if (
    value?.format !== "zicode-environment-report" ||
    value.version !== 1 ||
    !bounded(value.checkedAt, 64) ||
    !Number.isFinite(Date.parse(value.checkedAt)) ||
    (value.scope !== "workspace-root" && value.scope !== "subproject") ||
    !bounded(value.platform, 64) ||
    !bounded(value.architecture, 64) ||
    !bounded(value.piVersion, 200) ||
    !Array.isArray(value.manifests) ||
    value.manifests.length > 128 ||
    !Array.isArray(value.projectWrappers) ||
    !Array.isArray(value.tools) ||
    value.tools.length > 64
  )
    throw new Error(invalidFile);

  const packageManager = value.packageManager === null ? null : record(value.packageManager);
  if (value.packageManager !== null && (!packageManager || !bounded(packageManager.manager, 64)))
    throw new Error(invalidFile);
  const tools = value.tools.map((candidate) => {
    const tool = record(candidate);
    if (
      !tool ||
      !bounded(tool.id, 64) ||
      !bounded(tool.status, 32) ||
      (tool.version !== null && !bounded(tool.version, 400)) ||
      (tool.source !== null && !bounded(tool.source, 64))
    )
      throw new Error(invalidFile);
    return {
      id: tool.id,
      status: tool.status,
      version: tool.version as string | null,
      source: tool.source as string | null,
    };
  });
  if (new Set(tools.map((tool) => tool.id)).size !== tools.length) throw new Error(invalidFile);
  let requirementCount = 0;
  const manifests = value.manifests.map((candidate) => {
    const manifest = record(candidate);
    if (
      !manifest ||
      !bounded(manifest.kind, 64) ||
      !bounded(manifest.status, 32) ||
      !Array.isArray(manifest.requirements) ||
      manifest.requirements.length > 256
    )
      throw new Error(invalidFile);
    requirementCount += manifest.requirements.length;
    if (requirementCount > 4096) throw new Error(invalidFile);
    const requirements = manifest.requirements.map((item) => {
      const requirement = record(item);
      if (
        !requirement ||
        !bounded(requirement.tool, 64) ||
        (requirement.kind !== null && !bounded(requirement.kind, 64)) ||
        !boundedText(requirement.constraint, 400) ||
        typeof requirement.truncated !== "boolean"
      )
        throw new Error(invalidFile);
      return {
        tool: requirement.tool,
        kind: requirement.kind as string | null,
        constraint: requirement.constraint,
        truncated: requirement.truncated,
      };
    });
    return { kind: manifest.kind, status: manifest.status, requirements };
  });
  return {
    checkedAt: value.checkedAt,
    scope: value.scope as ImportedEnvironmentSnapshot["scope"],
    platform: value.platform,
    architecture: value.architecture,
    piVersion: value.piVersion,
    packageManager: packageManager ? (packageManager.manager as string) : null,
    tools,
    manifests,
  };
}

export function compareEnvironmentTools(
  current: EnvironmentReport,
  imported: ImportedEnvironmentSnapshot,
) {
  const currentTools = new Map(current.tools.map((tool) => [tool.id, tool]));
  const importedTools = new Map(imported.tools.map((tool) => [tool.id, tool]));
  const ids = [...new Set([...currentTools.keys(), ...importedTools.keys()])].sort();
  return ids
    .map((id) => ({ id, current: currentTools.get(id), imported: importedTools.get(id) }))
    .filter(
      ({ current: here, imported: there }) =>
        !here ||
        !there ||
        here.status !== there.status ||
        here.version !== there.version ||
        (here.source ?? null) !== there.source,
    );
}

function declarationCounts(manifests: ComparableManifest[]): Map<string, DeclarationEntry> {
  const counts = new Map<string, DeclarationEntry>();
  const add = (key: string, entry: Omit<DeclarationEntry, "count">) => {
    const previous = counts.get(key);
    counts.set(key, { ...entry, count: (previous?.count ?? 0) + 1 });
  };
  for (const manifest of manifests) {
    add(JSON.stringify(["manifest", manifest.kind, manifest.status]), {
      category: "manifest",
      manifestKind: manifest.kind,
      status: manifest.status,
    });
    for (const requirement of manifest.requirements) {
      add(
        JSON.stringify([
          "requirement",
          manifest.kind,
          requirement.tool,
          requirement.kind ?? null,
          requirement.constraint,
          requirement.truncated === true,
        ]),
        { category: "requirement", manifestKind: manifest.kind, requirement },
      );
    }
  }
  return counts;
}

/** Compare only manifest categories and static declarations; filenames were intentionally omitted. */
export function compareEnvironmentDeclarations(
  current: EnvironmentReport,
  imported: ImportedEnvironmentSnapshot,
) {
  const here = declarationCounts(current.manifests);
  const there = declarationCounts(imported.manifests);
  return [...new Set([...here.keys(), ...there.keys()])]
    .sort()
    .flatMap((key) => {
      const entry = here.get(key) ?? there.get(key);
      if (!entry) return [];
      return [
        {
          ...entry,
          key,
          currentCount: here.get(key)?.count ?? 0,
          importedCount: there.get(key)?.count ?? 0,
        },
      ];
    })
    .filter((entry) => entry.currentCount !== entry.importedCount);
}
