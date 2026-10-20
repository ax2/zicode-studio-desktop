import { afterEach, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import { mountResourceInputs } from "./resource-inputs";

let mounted: ReturnType<typeof mountResourceInputs> | undefined;
afterEach(() => { mounted?.destroy(); mounted = undefined; document.body.replaceChildren(); });
it("reuses typed fields, preserves false/zero, omits untouched optional fields and disables inputs", () => {
  const container = document.createElement("div"); document.body.append(container);
  mounted = mountResourceInputs(container, { type: "object", properties: {
    count: { type: "integer", minimum: 0 }, flag: { type: "boolean" }, optional: { type: "string" },
  }, required: ["count", "flag"] });
  expect(mounted.prepare()).toHaveProperty("error");
  const input = container.querySelector("input"), select = container.querySelector("select");
  if (!input || !select) throw new Error("Expected typed fields");
  fireEvent.change(input, { target: { value: "0" } });
  fireEvent.change(select, { target: { value: "1" } });
  expect(mounted.prepare()).toEqual({ input: { count: 0, flag: false } });
  mounted.setDisabled(true);
  expect([...container.querySelectorAll("input,select,textarea")].every(element => (element as HTMLInputElement).disabled)).toBe(true);
});
it("rejects unsupported schemas without silently dropping constraints", () => {
  const container = document.createElement("div");
  expect(() => mountResourceInputs(container, { type: "object", properties: { nested: { type: "object", properties: { value: { type: "string", pattern: "^x" } } } } })).toThrow("resource_inputs_unsupported");
});
it("uses compact multiline controls for bounded resource-tool strings", () => {
  const container = document.createElement("div"); document.body.append(container);
  mounted = mountResourceInputs(container, { type: "object", required: ["maxWidth", "quality"], properties: {
    maxWidth: { type: "string", maxLength: 4 }, quality: { type: "string", maxLength: 2 }, report: { type: "string" },
  } });
  const fields = [...container.querySelectorAll("textarea")];
  expect(fields.map(field => field.rows)).toEqual([1, 1, 6]);
  fireEvent.change(fields[0], { target: { value: "2" } });
  fireEvent.change(fields[1], { target: { value: "85" } });
  expect(mounted.prepare()).toEqual({ input: { maxWidth: "2", quality: "85" } });
});
