import { expect, it } from "vitest";
import diagnostics from "../../../../tests/fixtures/devtools-diagnostics-candidate03/plugin.json";
import { prepareToolInput, toolFields } from "./manual-tool-fields";
import { textFields } from "./manual-tools";

it("opens every frozen Diagnostics capability without inserting optional defaults", () => {
  expect(diagnostics.contributes.capabilities).toHaveLength(11);
  for (const capability of diagnostics.contributes.capabilities) {
    const fields = toolFields(capability.inputSchema);
    expect(fields, capability.id).not.toBeNull();
    expect(textFields(capability.inputSchema), capability.id).not.toBeNull();
    expect(fields?.map(field => [field.key, field.required, field.maxLength])).toEqual([
      ["text", true, 8192], ["secondary", false, 8192],
    ]);
    expect(prepareToolInput(fields ?? [], { text: "report" })).toEqual({ input: { text: "report" } });
    expect(prepareToolInput(fields ?? [], { text: "report", secondary: "" })).toEqual({ input: { text: "report", secondary: "" } });
    expect(prepareToolInput(fields ?? [], { text: "x".repeat(8193) })).toHaveProperty("error");
  }
});

it("ignores scalar default annotations while preserving explicit false, zero and empty values", () => {
  const fields = toolFields({ $id: "https://invalid.example/never-fetch", type: "object", properties: {
    flag: { type: "boolean", default: true }, count: { type: "number", default: 5 },
    text: { type: "string", default: "preset" },
  } });
  expect(fields).not.toBeNull();
  expect(prepareToolInput(fields ?? [], {})).toEqual({ input: {} });
  expect(prepareToolInput(fields ?? [], { flag: "1", count: "0", text: "" })).toEqual({ input: { flag: false, count: 0, text: "" } });
});

it("does not suggest invalid or unbounded declared defaults", () => {
  const fields = toolFields({ type: "object", properties: {
    tooLong: { type: "string", maxLength: 2, default: "long" },
    invalidChoice: { type: "string", enum: ["a"], default: "b" },
    unsafeNumber: { type: "integer", default: 9007199254740992 },
    hugeText: { type: "string", default: "x".repeat(81) },
    multiline: { type: "string", default: "one\ntwo" },
    valid: { type: "number", minimum: 0, default: 0 },
  } });
  expect(fields?.map(field => [field.key, field.suggested])).toEqual([
    ["tooLong", undefined], ["invalidChoice", undefined], ["unsafeNumber", undefined],
    ["hugeText", undefined], ["multiline", undefined], ["valid", { input: "0", preview: "0" }],
  ]);
  expect(prepareToolInput(fields ?? [], {})).toEqual({ input: {} });
});

it("does not treat annotation support as support for references or unknown constraints", () => {
  for (const parse of [textFields, toolFields]) {
    expect(parse({ $id: 42, type: "object", properties: {} })).toBeNull();
    expect(parse({ $id: "urn:test", $ref: "https://invalid.example/schema", type: "object", properties: {} })).toBeNull();
    expect(parse({ $id: "urn:test", type: "object", properties: { text: { type: "string", default: "x", pattern: "^x$" } } })).toBeNull();
  }
});
