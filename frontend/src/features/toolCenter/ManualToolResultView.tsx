import { ToolResultText } from "./ToolResultText";
import { ToolResultImage } from "./ToolResultImage";
import { DataTransformResult } from "./DataTransformResult";
import { dataTransformPreview, dataTransformRowFailure } from "./data-transform-result";
import { inlineToolImage } from "./inline-tool-image";
import { useMemo } from "react";
import { t } from "../../shared/i18n";
import type { Ref } from "react";
import type { ManualToolResult } from "./manual-tool-result";

export function ManualToolResultView({ result, dataTransform = false, sectionRef, onBackToInputs }: {
  result: ManualToolResult; dataTransform?: boolean; sectionRef?: Ref<HTMLElement>; onBackToInputs?(): void;
}) {
  const image = useMemo(() => result.successful && !dataTransform ? inlineToolImage(result.text) : null,
    [dataTransform, result.successful, result.text]);
  const preview = useMemo(() => dataTransform && result.successful ? dataTransformPreview(result.text) : null,
    [dataTransform, result.successful, result.text]);
  const failedRow = useMemo(() => dataTransform && !result.successful ? dataTransformRowFailure(result.raw) : null,
    [dataTransform, result.successful, result.raw]);
  return <section className="tool-execution-result" ref={sectionRef} tabIndex={-1} aria-label={t("Latest execution")}>
    <h3>{t("Latest execution")}</h3>
    {onBackToInputs && <button type="button" className="ui-button ui-button--secondary" onClick={onBackToInputs}>{t("Back to inputs")}</button>}
    {result.successful ? <>
      <p role="status">{t("Tool completed")}</p>
      {preview ? <DataTransformResult key={result.text} result={preview} text={result.text} />
        : image ? <ToolResultImage key={result.text} image={image} text={result.text} />
        : <ToolResultText key={result.text} text={result.text} />}
    </> : <div role="alert">
      <p>{t("Tool could not complete. Check its inputs and try again.")}</p>
      {result.errorCode && <p>{t("Error code")}: {result.errorCode}</p>}
      {failedRow ? <>
        <p className="tool-transform-failed-row">{t("Data row {row} · column {column}")
          .replace("{row}", failedRow.row).replace("{column}", () => failedRow.column)}</p>
        <p>{t("The input is unchanged. Edit the row and run the tool again.")}</p>
      </> : result.errorMessage && <p>{result.errorMessage}</p>}
    </div>}
    <details><summary>{t("Original response")}</summary>
      <textarea className="ui-textarea tool-result" readOnly rows={8}
        aria-label={t("Original response")} value={result.raw} />
    </details>
  </section>;
}
