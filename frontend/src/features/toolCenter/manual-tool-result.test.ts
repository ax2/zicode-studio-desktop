import { expect, it } from "vitest";
import { manualToolResult } from "./manual-tool-result";

it("unwraps versioned text without parsing or changing the text", () => {
  const text = 'wide: 9007199254740993\nname: 中\n<script>text</script>\n';
  const value = { contractVersion: "1.0.0-rc.1", ok: true, data: { text }, error: null };
  expect(manualToolResult(value)).toEqual({ successful: true, text, raw: JSON.stringify(value, null, 2) });
  expect(manualToolResult({ ...value, data: { text: "" } }).text).toBe("");
});

it("keeps arbitrary and future output intact", () => {
  for (const value of [null, false, "raw\ntext", { text: "generic" }, { contractVersion: "2", ok: true, data: { text: "future" } }]) {
    const outcome = manualToolResult(value);
    expect(outcome.successful).toBe(true);
    expect(outcome.text).toBe(outcome.raw);
  }
});

it("rejects provider failures and malformed known contracts", () => {
  expect(manualToolResult({ ok: false, error: { code: "INVALID_ENCODING", message: "Invalid text" } }))
    .toMatchObject({ successful: false, text: "", errorCode: "INVALID_ENCODING", errorMessage: "Invalid text" });
  expect(manualToolResult({ contractVersion: "1.0.0-rc.1", ok: true, data: null, error: null }))
    .toMatchObject({ successful: false, errorCode: "INVALID_RESULT" });
  expect(manualToolResult({ ok: false, error: null }).successful).toBe(false);
});

it("displays captured structured output only for the explicitly supported result flow", () => {
  const data = { keyCount: 1, serializedBytes: 27, keys: ["\u6837\u672c"], maxDepth: 2, value: { "\u6837\u672c": 9007199254740991 }, valueTypes: { "\u6837\u672c": "integer" } };
  const result = { contractVersion: "1.0.0-rc.1", ok: true, data, error: null };
  const reference = { schemaVersion: 2, mimeType: "application/json", resultId: "8ec4d0a5-b746-451e-9f0b-792f0e958381",
    contentVersion: "f".repeat(64), byteLength: 164 };
  expect(manualToolResult(result, { reference })).toEqual({
    successful: true, text: JSON.stringify(data, null, 2), raw: JSON.stringify(result, null, 2),
  });
  expect(manualToolResult(result)).toMatchObject({ successful: false, errorCode: "INVALID_RESULT" });

  for (const invalid of [undefined, { ...reference, schemaVersion: 1 }, { ...reference, mimeType: "text/plain" },
    { ...reference, resultId: "missing" }, { ...reference, contentVersion: "" },
    { ...reference, byteLength: 0 }, { ...reference, byteLength: 48 * 1024 + 1 }]) {
    expect(manualToolResult(result, { reference: invalid })).toMatchObject({ successful: false, errorCode: "INVALID_RESULT" });
  }

  for (const invalid of [{ ...result, contractVersion: "2" }, { ...result, data: [] },
    { ...result, error: { code: "BAD_RESULT" } }, { ...result, ok: "true" }]) {
    expect(manualToolResult(invalid, { reference })).toMatchObject({ successful: false, errorCode: "INVALID_RESULT" });
  }
  expect(manualToolResult({ ...result, ok: false, error: { code: "INPUT_LIMIT" } }, { reference }))
    .toMatchObject({ successful: false, errorCode: "INPUT_LIMIT" });
});
