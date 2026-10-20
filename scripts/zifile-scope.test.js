// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const matrix = JSON.parse(
  readFileSync(new URL("../docs/plugins/zifile-integration-matrix.json", import.meta.url), "utf8"),
);

it("retains every declared ZiFile operation and makes blockers explicit", () => {
  const operations = matrix.formats.flatMap((format) =>
    Object.entries(format.operations).map(([operationId, operation]) => ({
      id: `${format.format}:${operationId}`,
      operation,
    })),
  );
  const ids = new Set(operations.map(({ id }) => id));

  expect(operations).toHaveLength(108);
  expect(ids.size).toBe(108);
  expect(matrix.studio.acceptedOperations).toBe(0);
  expect(matrix.studio.nativeWorkerSupported).toBe(false);
  const blockers = new Map(matrix.blockers.map((blocker) => [blocker.id, blocker]));
  expect(blockers.size).toBe(matrix.blockers.length);
  for (const blocker of blockers.values()) {
    expect(blocker.reason).toBeTruthy();
    expect(blocker.owner).toBeTruthy();
  }
  for (const { operation } of operations) {
    expect(operation.accepted).toBe(false);
    expect(["blocked", "provider-unsupported"]).toContain(operation.studioStatus);
    expect(typeof operation.providerDeclared).toBe("boolean");
    expect(operation.blockers.length).toBeGreaterThan(0);
    for (const blockerId of operation.blockers) expect(blockers.has(blockerId)).toBe(true);
    if (operation.studioStatus === "provider-unsupported") {
      expect(operation.providerDeclared).toBe(false);
      expect(operation.blockers).toContain("PROVIDER_FORMAT_OPERATION");
    } else {
      expect(operation.providerDeclared).toBe(true);
    }
  }
});
