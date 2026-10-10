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
