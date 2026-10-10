import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ManualToolInput } from "./ManualToolInput";
import { prepareToolInput, toolFields } from "./manual-tool-fields";

/** Reuse the manual tool form; selection never loads or executes a Worker. */
export function mountResourceInputs(container: HTMLElement, schema: unknown) {
  const fields = toolFields(schema);
  if (!fields) throw new Error("resource_inputs_unsupported");
  const root = createRoot(container);
  const values: Record<string, string> = Object.create(null);
  const prefix = `resource-input-${crypto.randomUUID()}`;
  let disabled = false;
  let invalid: string | undefined;
  function render() {
    flushSync(() => root.render(fields?.map(field => <ManualToolInput key={field.key}
      field={field} id={`${prefix}-${field.key}`} value={values[field.key]} disabled={disabled}
      invalid={invalid === field.key} onChange={value => { values[field.key] = value; invalid = undefined; render(); }} />)));
  }
  render();
  return {
    prepare() { const result = prepareToolInput(fields, values); invalid = "field" in result ? result.field : undefined; render(); return result; },
    setDisabled(value: boolean) { disabled = value; render(); },
    destroy() { root.unmount(); },
  };
}
