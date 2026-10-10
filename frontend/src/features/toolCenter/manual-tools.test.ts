import { expect, it } from "vitest";
import { manualToolError, textFields } from "./manual-tools";

it("accepts bounded text and enum fields and rejects unsupported resource or nested contracts", () => {
  expect(textFields({ type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 8192 }, mode: { type: "string", enum: ["a", "b"] } } })).toEqual([
    { key: "text", label: "text", required: true, maxLength: 8192, minLength: 0, choices: undefined },
    { key: "mode", label: "mode", required: false, maxLength: 32768, minLength: 0, choices: ["a", "b"] },
  ]);
  for (const schema of [null, { type: "array" }, { type: "object", properties: { file: { type: "object" } } },
    { type: "object", properties: { text: { type: "string", pattern: ".*" } } },
    { type: "object", required: ["missing"], properties: {} },
    { type: "object", properties: { text: { type: "string", enum: [1] } } }]) expect(textFields(schema)).toBeNull();
});

it("shows fixed errors without private Host messages", () => {
  expect(manualToolError(Object.assign(new Error("private path or input"), { code: "catalog_changed" }))).toContain("Tool changed");
  expect(manualToolError({ code: "worker_timeout", message: "secret" })).toContain("timed out");
  expect(manualToolError(new Error("secret"))).not.toContain("secret");
});
