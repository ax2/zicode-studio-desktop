import { parseProjectHistory } from "./project-run-records";
import type { ProjectRun, ProjectRunHistory } from "./project-runner";

interface RunHistoryExport {
  workspaceId: string;
  projectName: string;
  receivedAt: string;
  historyStatus: ProjectRunHistory["historyStatus"];
  runs: ProjectRun[];
}

export function projectRunHistorySnapshot(copy: RunHistoryExport) {
  if (!copy.workspaceId || !Number.isFinite(Date.parse(copy.receivedAt)))
    throw new Error("task_response_invalid");
  const { runs, historyStatus } = parseProjectHistory(
    { runs: copy.runs, historyStatus: copy.historyStatus },
    copy.workspaceId,
  );
  const selectedRuns = runs.slice(0, 40);
  return {
    format: "zicode-project-run-history",
    version: 1,
    projectName: copy.projectName,
    exportedAt: new Date().toISOString(),
    snapshotReceivedAt: copy.receivedAt,
    source: "displayed-history-snapshot",
    timestampUnit: "unix-ms",
    historyStatus,
    outputExported: false,
    omittedRunCount: runs.length - selectedRuns.length,
    runs: selectedRuns.map((run) => ({
      id: run.id,
      name: run.name,
      directory: run.directory ?? null,
      manager: run.manager,
      status: run.status,
      reportedOutcomeFinal: ["succeeded", "failed", "cancelled"].includes(run.status),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      exitCode: run.exitCode,
      fingerprint: run.fingerprint ?? null,
      historical: run.historical === true,
      outputAvailability: run.historical ? "saved-summary-only" : "retained-host-output",
      truncated: run.historical ? null : run.truncated,
    })),
  };
}

/** Manual, plaintext export of run metadata; commands and output stay on this device. */
export function downloadProjectRunHistory(copy: RunHistoryExport): void {
  if (typeof URL.createObjectURL !== "function")
    throw new Error("Command run downloads are unavailable in this view.");
  const content = JSON.stringify(projectRunHistorySnapshot(copy), null, 2);
  if (new TextEncoder().encode(content).length > 2 * 1024 * 1024)
    throw new Error("Command run summary exceeds 2 MiB.");
  const url = URL.createObjectURL(new Blob([`${content}\n`], { type: "application/json" }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `zicode-project-run-history-${Date.now()}.json`;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
