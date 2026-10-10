import type { ProjectRun, ProjectRunHistory } from "./project-runner";

export function parseProjectRun(value: unknown, workspace: string): ProjectRun {
  const run = value as ProjectRun | undefined;
  const text = (value: unknown, limit: number) =>
    typeof value === "string" && value.length <= limit;
  const time = (value: unknown) =>
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    Number.isFinite(new Date(value).getTime());
  if (
    !run ||
    !text(run.id, 512) ||
    !run.id ||
    run.workspaceId !== workspace ||
    !text(run.name, 4096) ||
    !text(run.manager, 256) ||
    !text(run.command, 262144) ||
    !text(run.stdout, 65536) ||
    !text(run.stderr, 65536) ||
    typeof run.truncated !== "boolean" ||
    !time(run.startedAt) ||
    (run.finishedAt !== null && !time(run.finishedAt)) ||
    (run.exitCode !== null && !Number.isSafeInteger(run.exitCode)) ||
    !["running", "stopping", "succeeded", "failed", "cancelled", "unknown"].includes(run.status) ||
    (run.historical !== undefined && typeof run.historical !== "boolean") ||
    (run.historical && ["running", "stopping"].includes(run.status))
  )
    throw new Error("task_response_invalid");
  for (const value of [run.directory, run.invocation, run.executable, run.fingerprint]) {
    if (value !== undefined && !text(value, 262144)) throw new Error("task_response_invalid");
  }
  return run;
}

export function parseProjectHistory(value: unknown, workspace: string): ProjectRunHistory {
  const result = Array.isArray(value)
    ? { runs: value, historyStatus: "memory" }
    : (value as ProjectRunHistory | undefined);
  if (
    !result ||
    !Array.isArray(result.runs) ||
    result.runs.length > 500 ||
    !["persistent", "unavailable", "memory"].includes(result.historyStatus)
  )
    throw new Error("task_response_invalid");
  const seen = new Set<string>();
  const runs = result.runs.map((value) => {
    const run = parseProjectRun(value, workspace);
    if (seen.has(run.id)) throw new Error("task_response_invalid");
    seen.add(run.id);
    return run;
  });
  return { runs, historyStatus: result.historyStatus as ProjectRunHistory["historyStatus"] };
}
