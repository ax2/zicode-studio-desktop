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
  expect(() => mountResourceInputs(container, { type: "object", properties: { nested: { type: "object" } } })).toThrow("resource_inputs_unsupported");
});
