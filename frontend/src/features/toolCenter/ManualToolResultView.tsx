import { t } from "../../shared/i18n";
import type { Ref } from "react";
import type { ManualToolResult } from "./manual-tool-result";

export function ManualToolResultView({ result, sectionRef, onBackToInputs }: { result: ManualToolResult; sectionRef?: Ref<HTMLElement>; onBackToInputs?(): void }) {
  return <section className="tool-execution-result" ref={sectionRef} tabIndex={-1} aria-label={t("Latest execution")}>
    <h3>{t("Latest execution")}</h3>
    {onBackToInputs && <button type="button" className="ui-button ui-button--secondary" onClick={onBackToInputs}>{t("Back to inputs")}</button>}
    {result.successful ? <>
      <p role="status">{t("Tool completed")}</p>
      <textarea data-tool-result className="ui-textarea tool-result" readOnly rows={8}
        aria-label={t("Tool result")} value={result.text} />
    </> : <div role="alert">
      <p>{t("Tool could not complete. Check its inputs and try again.")}</p>
      {result.errorCode && <p>{t("Error code")}: {result.errorCode}</p>}
      {result.errorMessage && <p>{result.errorMessage}</p>}
    </div>}
    <details><summary>{t("Original response")}</summary>
      <textarea className="ui-textarea tool-result" readOnly rows={8}
        aria-label={t("Original response")} value={result.raw} />
    </details>
  </section>;
}
