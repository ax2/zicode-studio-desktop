import { expect, it } from "vitest";
import { projectRunHistorySnapshot } from "./project-run-history-export";
import type { ProjectRun } from "./project-runner";

const run: ProjectRun = {
  id: "run",
  workspaceId: "workspace",
  name: "build",
  manager: "bun",
  command: "private command",
  stdout: "private output",
  stderr: "private error",
  status: "running",
  startedAt: 1000,
  finishedAt: null,
  exitCode: null,
  truncated: true,
};
const copy = {
  workspaceId: "workspace",
  projectName: "Project",
  receivedAt: "2026-10-02T00:00:00Z",
  historyStatus: "persistent" as const,
  runs: [run],
};

it("exports snapshot units and output evidence without command or output contents", () => {
  const snapshot = projectRunHistorySnapshot(copy);
  expect(snapshot.timestampUnit).toBe("unix-ms");
  expect(snapshot.source).toBe("displayed-history-snapshot");
  expect(snapshot.outputExported).toBe(false);
  expect(snapshot.runs[0]).toMatchObject({
    reportedOutcomeFinal: false,
    outputAvailability: "retained-host-output",
    truncated: true,
  });
  expect(JSON.stringify(snapshot)).not.toContain("private");
  expect(snapshot).not.toHaveProperty("workspaceId");
});

it("keeps saved-summary output completeness unknown", () => {
  const snapshot = projectRunHistorySnapshot({
    ...copy,
    runs: [{ ...run, historical: true, status: "succeeded", truncated: false }],
  });
  expect(snapshot.runs[0]).toMatchObject({
    reportedOutcomeFinal: true,
    outputAvailability: "saved-summary-only",
    truncated: null,
  });
});

it("rejects mixed-workspace, duplicate and invalid-time snapshots", () => {
  expect(() => projectRunHistorySnapshot({ ...copy, workspaceId: "other" })).toThrow();
  expect(() => projectRunHistorySnapshot({ ...copy, runs: [run, run] })).toThrow();
  expect(() => projectRunHistorySnapshot({ ...copy, receivedAt: "invalid" })).toThrow();
});

it("reports omitted records when the retained export reaches forty entries", () => {
  const snapshot = projectRunHistorySnapshot({
    ...copy,
    runs: Array.from({ length: 41 }, (_, index) => ({ ...run, id: `run-${index}` })),
  });
  expect(snapshot.runs).toHaveLength(40);
  expect(snapshot.omittedRunCount).toBe(1);
});
