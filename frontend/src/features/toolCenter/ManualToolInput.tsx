import { t } from "../../shared/i18n";
import type { ToolField, ToolScalar } from "./manual-tool-fields";

export function ManualToolInput({ field, id, value, disabled, invalid, onChange }: {
  field: ToolField; id: string; value?: string; disabled: boolean; invalid: boolean; onChange(value: string): void;
}) {
  function choiceLabel(choice: ToolScalar) {
    return typeof choice === "boolean" ? t(choice ? "True" : "False") : choice === "" ? t("Empty text") : String(choice);
  }
  const numeric = field.kind === "integer" || field.kind === "number";
  const structured = field.kind === "array" || field.kind === "object";
  const shortText = field.kind === "string" && field.maxLength !== undefined && field.maxLength <= 128;
  const describedBy = [`${id}-requirement`, ...(field.description ? [`${id}-description`] : []), ...((numeric || structured) && !field.choices ? [`${id}-hint`] : [])].join(" ");
  return <div className="tool-input-field">
    <label htmlFor={id}>{field.label === "text" ? t("Input text") : field.label}{field.required ? " *" : ""}</label>
    <span id={`${id}-requirement`} className="tool-center-source">{t(field.required ? "Required input" : "Optional input · omitted until edited")}</span>
    {field.description && <p id={`${id}-description`} className="tool-input-description">{field.description}</p>}
    {field.choices ? <select id={id} className="ui-select" value={value ?? ""} disabled={disabled} aria-invalid={invalid}
      aria-describedby={describedBy}
      onChange={event => onChange(event.target.value)}>
      <option value="">{t(field.required ? "Choose a value" : "Not provided")}</option>
      {field.choices.map((choice, index) => <option key={JSON.stringify(choice)} value={String(index)}>{choiceLabel(choice)}</option>)}
    </select> : field.kind === "string" ? <textarea id={id} className={shortText ? "ui-textarea tool-input-short-text" : "ui-textarea"} rows={shortText ? 1 : 6} value={value ?? ""} disabled={disabled} aria-invalid={invalid}
      aria-describedby={describedBy}
      onChange={event => onChange(event.target.value)} /> : structured ? <>
      <textarea id={id} className="ui-textarea" rows={4} maxLength={32768} value={value ?? ""} disabled={disabled} aria-invalid={invalid}
        aria-describedby={describedBy} spellCheck={false} placeholder={field.kind === "array" ? "[]" : "{}"}
        onChange={event => onChange(event.target.value)} />
      <span id={`${id}-hint`} className="tool-center-source">{t(field.kind === "array" ? "Enter a JSON array (up to 32 KiB)." : "Enter a JSON object (up to 32 KiB).")}</span>
    </> : <>
      <input id={id} type="text" inputMode={field.kind === "integer" ? "numeric" : "decimal"} className="ui-input" maxLength={128}
        value={value ?? ""} disabled={disabled} aria-invalid={invalid} aria-describedby={describedBy} onChange={event => onChange(event.target.value)} />
      <span id={`${id}-hint`} className="tool-center-source">{t(field.kind === "integer" ? "Whole number (within the safe integer range)" : "Number (decimal or exponent notation)")}
        {field.minimum !== undefined ? ` · ≥ ${field.minimum}` : ""}{field.maximum !== undefined ? ` · ≤ ${field.maximum}` : ""}</span>
    </>}
    {field.suggested && value !== field.suggested.input && <button type="button" className="ui-button ui-button--secondary ui-button--sm"
      disabled={disabled} onClick={() => onChange(field.suggested?.input ?? "")}>{t("Use declared default")}: {field.suggested.preview}</button>}
  </div>;
}
