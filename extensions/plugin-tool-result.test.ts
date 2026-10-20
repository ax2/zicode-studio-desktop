import { describe, expect, it } from "vitest";
import { pluginToolResult } from "./plugin-tool-result";

const tool = { pluginId: "com.example.structured", capability: "parse.object" };
const resultId = "11111111-1111-4111-8111-111111111111";

describe("pluginToolResult structured references", () => {
  it("keeps a versioned JSON result reference in details without altering tool content", () => {
    const result = { ok: true, data: { count: 2 } };
    const response = { result, resultRef: { schemaVersion: 2, resultId, mimeType: "application/json" } };
    const returned = pluginToolResult(response as never, tool as never);
    expect(returned.content).toEqual([{ type: "text", text: JSON.stringify(result) }]);
    expect(returned.details).toMatchObject({ studioResult: { resultRef: response.resultRef,
      pluginId: tool.pluginId, capabilityId: tool.capability } });
  });

  it("rejects mismatched version and MIME pairs", () => {
    const response = { result: { ok: true, data: { count: 2 } },
      resultRef: { schemaVersion: 1, resultId, mimeType: "application/json" } };
    expect(pluginToolResult(response as never, tool as never).details).toEqual(response.result);
  });

  it("reports provider business failures to Pi without attaching a result reference", () => {
    const result = { contractVersion: "1.0.0-rc.1", ok: false, data: null,
      error: { code: "INVALID_INPUT", message: "Invalid input" } };
    const response = { result, resultRef: { schemaVersion: 2, resultId, mimeType: "application/json" } };
    const returned = pluginToolResult(response as never, tool as never);
    expect(returned.content).toEqual([{ type: "text", text: JSON.stringify(result) }]);
    expect(returned.details).toEqual(result);
    expect(returned.isError).toBe(true);
  });
});
