import assert from "node:assert/strict";
import test from "node:test";
import { requireReviewedWorkflow } from "./check-release-source-workflow.mjs";

test("accepts the identical dispatch workflow and the reviewed v0.6.7 publisher", () => {
  const dispatch = "1".repeat(40);
  requireReviewedWorkflow(dispatch, dispatch);
  requireReviewedWorkflow("2a333065442f7561bb4469a397f4ff23fc3e2244", dispatch);
});

test("rejects unknown and missing tag workflows before building", () => {
  assert.throws(() => requireReviewedWorkflow("2".repeat(40), "1".repeat(40)), /reviewed/);
  assert.throws(() => requireReviewedWorkflow("", ""), /reviewed/);
});
