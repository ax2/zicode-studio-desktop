// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const matrix = JSON.parse(
  readFileSync(new URL("../docs/plugins/devtools-all-tools-matrix.json", import.meta.url), "utf8"),
);
const current = matrix.currentPiVerification;

it("keeps full acceptance separate from a current basic Pi replay", () => {
  expect(matrix.tools).toHaveLength(matrix.totalTools);
  expect(matrix.fullToolsAccepted).toBe(
    matrix.tools.filter((tool) => tool.acceptedFullTool).length,
  );
  expect(current.fullToolAcceptance).toBe(false);
  expect(current.modelCalls).toBe(0);
  expect(current.workerDeadlineMs).toBe(5000);
  for (const family of current.families) {
    expect(family.mechanismPassed).toBe(true);
    expect(family.fullToolAcceptance).toBe(false);
    expect(family.workersStarted).toBe(family.workersReaped);
    expect(family.workersStarted).toBe(family.workersPipesClosed);
    expect(family.workerPidsPresent).toBe(0);
  }
});

it("keeps every source tool and its current disposition in both exhaustive matrices", () => {
  const ids = matrix.tools.map((tool) => tool.sourceToolId);
  const expectedIds = new Set(ids);
  expect(ids).toHaveLength(matrix.totalTools);
  expect(expectedIds.size).toBe(matrix.totalTools);

  const statusCounts = matrix.tools.reduce((counts, tool) => {
    counts[tool.integrationStatus] = (counts[tool.integrationStatus] ?? 0) + 1;
    return counts;
  }, {});
  expect(statusCounts).toEqual(matrix.counts);

  for (const name of ["devtools-all-tools-matrix.md", "devtools-blocked-tools.md"]) {
    const text = readFileSync(new URL(`../docs/plugins/${name}`, import.meta.url), "utf8");
    const tableIds = [...text.matchAll(/^\|\s*([a-z0-9-]+)\s*\/\s/gm)].map((match) => match[1]);
    expect(tableIds).toHaveLength(matrix.totalTools);
    expect(new Set(tableIds)).toEqual(expectedIds);
  }

  for (const tool of matrix.tools) {
    expect(tool.reason).toBeTruthy();
    expect(tool.owner).toBeTruthy();
    expect(tool.unblockCondition).toBeTruthy();
    expect(typeof tool.acceptedFullTool).toBe("boolean");
  }
  expect(matrix.fullToolsAccepted).toBe(0);
});

it("links each current basic tool replay to the same runtime evidence", () => {
  const tools = matrix.tools.filter((tool) => tool.currentPiBasicVerification);
  expect(tools.length).toBeGreaterThan(0);
  for (const tool of tools) {
    const replay = tool.providerCandidate.currentPiReplay;
    expect(replay.archiveStage).toBe(current.archiveStage);
    expect(replay.exeSha256).toBe(current.currentExeSha256);
    expect(tool.currentPiBasicVerification.archiveStage).toBe(current.archiveStage);
    expect(replay.mechanismPassed).toBe(true);
    expect(replay.fullToolAcceptance).toBe(false);
    expect(tool.currentPiBasicVerification.fullToolAccepted).toBe(false);
    for (const name of ["devtools-all-tools-matrix.md", "devtools-blocked-tools.md"]) {
      const text = readFileSync(new URL(`../docs/plugins/${name}`, import.meta.url), "utf8");
      const line = text.split("\n").find((row) => row.startsWith(`| ${tool.sourceToolId} / `));
      expect(line).toContain(tool.reason);
    }
  }
});

it("preserves older runtime and Pi evidence", () => {
  for (const history of [matrix.historicalRuntimeVerifications, matrix.historicalPiVerifications]) {
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((record) => record.archiveStage !== current.archiveStage)).toBe(true);
  }
  const tools = matrix.tools.filter((tool) => tool.currentPiBasicVerification);
  expect(tools.every((tool) => tool.providerCandidate.piVerificationHistory.length > 0)).toBe(true);
});
