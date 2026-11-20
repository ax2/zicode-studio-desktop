import { useMemo, useRef, useState, useEffect } from "react";
import { t } from "../../shared/i18n";
import { resultTextFields } from "./tool-result-text";

export function ToolResultText({ text }: { text: string }) {
  const fields = useMemo(() => resultTextFields(text), [text]);
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState("");
  const [copying, setCopying] = useState(false);
  const output = useRef<HTMLTextAreaElement>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const value = selected === "" ? text : fields[Number(selected)]?.text ?? text;
  function selectText() { output.current?.focus(); output.current?.select(); }
  async function copy() {
    const current = ++generation.current;
    setCopying(true); setNotice("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      if (current === generation.current) setNotice("Displayed text copied.");
    } catch {
      if (current === generation.current) {
        selectText(); setNotice("Copy failed. Text selected; use your system copy shortcut.");
      }
    } finally { if (current === generation.current) setCopying(false); }
  }
  return <>
    {fields.length > 0 && <label className="tool-input-field">{t("Result text view")}
      <select className="ui-select" value={selected} disabled={copying} onChange={event => {
        setSelected(event.target.value); setNotice("");
      }}>
        <option value="">{t("Complete result")}</option>
        {fields.map((field, index) => <option key={field.key} value={String(index)}>
          {t("Text field: {name}").replace("{name}", field.key)}
        </option>)}
      </select>
    </label>}
    {selected !== "" && <p className="tool-center-source">{t("This view changes display and copying only. Save and send actions use the complete result.")}</p>}
    <textarea ref={output} data-tool-result className="ui-textarea tool-result" readOnly rows={8}
      aria-label={t("Tool result")} value={value} spellCheck={false} />
    <div className="ui-toolbar">
      <button type="button" className="ui-button ui-button--secondary" disabled={copying}
        onClick={() => { void copy(); }}>{t("Copy displayed text")}</button>
      <button type="button" className="ui-button ui-button--secondary" onClick={selectText}>{t("Select result text")}</button>
    </div>
    {notice && <p role="status">{t(notice)}</p>}
  </>;
}
