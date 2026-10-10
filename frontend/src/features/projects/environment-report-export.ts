import type { EnvironmentReport } from "./EnvironmentPanel";

/** Explicit, path-minimized snapshot for comparing toolchains across machines. */
export function environmentReportSnapshot(report: EnvironmentReport) {
  return {
    format: "zicode-environment-report",
    version: 1,
    exportedAt: new Date().toISOString(),
    checkedAt: report.checkedAt,
    scope: report.directory ? "subproject" : "workspace-root",
    platform: report.platform,
    architecture: report.architecture,
    piVersion: report.piVersion,
    packageManager: report.packageManager
      ? {
          manager: report.packageManager.manager,
          inherited: report.packageManager.inherited,
          requirement: report.packageManager.requirement,
        }
      : null,
    packageManagerError: report.packageManagerError ?? null,
    manifests: report.manifests.map((manifest) => ({
      kind: manifest.kind,
      status: manifest.status,
      requirements: manifest.requirements.map((requirement) => ({
        tool: requirement.tool,
        kind: requirement.kind ?? null,
        constraint: requirement.constraint,
        truncated: requirement.truncated === true,
        assessment: requirement.assessment ?? null,
      })),
    })),
    tools: report.tools.map((tool) => ({
      id: tool.id,
      status: tool.status,
      version: tool.version,
      source: tool.source ?? null,
    })),
    projectWrappers: report.projectWrappers ?? [],
  };
}

export function downloadEnvironmentReport(report: EnvironmentReport): void {
  if (typeof URL.createObjectURL !== "function")
    throw new Error("Environment report downloads are unavailable in this view.");
  const content = JSON.stringify(environmentReportSnapshot(report), null, 2);
  if (new TextEncoder().encode(content).length > 1024 * 1024)
    throw new Error("Environment report exceeds 1 MiB.");
  const url = URL.createObjectURL(new Blob([`${content}\n`], { type: "application/json" }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `zicode-environment-report-${Date.now()}.json`;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
