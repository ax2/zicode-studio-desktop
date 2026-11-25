import { ToolResultText } from "./ToolResultText";
import { ToolResultImage } from "./ToolResultImage";
import { DataTransformResult } from "./DataTransformResult";
import { dataMergePreview, dataTransformPreview, type MergePreview, type TransformPreview } from "./data-transform-result";
import { dataTransformRowFailure } from "./data-transform-error-protocol";
import { inlineToolImage } from "./inline-tool-image";
import { useMemo } from "react";
import { t } from "../../shared/i18n";
import type { ReactNode, Ref } from "react";
import type { ManualToolResult } from "./manual-tool-result";

export function ManualToolResultView({ result, dataTransform = false, dataMerge = false, tablePreview, actions, failureNotice, sectionRef, onBackToInputs }: {
  result: ManualToolResult; dataTransform?: boolean; dataMerge?: boolean; tablePreview?: TransformPreview | MergePreview | null;
  actions?: ReactNode; failureNotice?: string; sectionRef?: Ref<HTMLElement>; onBackToInputs?(): void;
}) {
  const image = useMemo(() => result.successful && !dataTransform && !dataMerge ? inlineToolImage(result.text) : null,
    [dataTransform, dataMerge, result.successful, result.text]);
  const preview = useMemo(() => {
    if (!result.successful) return null;
    if (tablePreview !== undefined) return tablePreview;
    if (dataMerge) return dataMergePreview(result.text);
    return dataTransform ? dataTransformPreview(result.text) : null;
  }, [tablePreview, dataMerge, dataTransform, result.successful, result.text]);
  const failedRow = useMemo(() => dataTransform && !result.successful ? dataTransformRowFailure(result.raw) : null,
    [dataTransform, result.successful, result.raw]);
  return <section className="tool-execution-result" ref={sectionRef} tabIndex={-1} aria-label={t("Latest execution")}>
    <h3>{t("Latest execution")}</h3>
    {onBackToInputs && <button type="button" className="ui-button ui-button--secondary" onClick={onBackToInputs}>{t("Back to inputs")}</button>}
    {result.successful ? <>
      <p role="status">{t("Tool completed")}</p>
      {actions}
      {preview ? <DataTransformResult key={result.text} result={preview} text={result.text} />
        : image ? <ToolResultImage key={result.text} image={image} text={result.text} />
        : <ToolResultText key={result.text} text={result.text} />}
    </> : <div role="alert">
      <p>{failureNotice ?? t("Tool could not complete. Check its inputs and try again.")}</p>
      {result.errorCode && <p>{t("Error code")}: {result.errorCode}</p>}
      {failedRow ? <>
        <p className="tool-transform-failed-row">{t("Data row {row} · column {column}")
          .replace("{row}", failedRow.row).replace("{column}", () => failedRow.column)}</p>
        <p>{t("The input is unchanged. Edit the row and run the tool again.")}</p>
      </> : !failureNotice && result.errorMessage && <p>{result.errorMessage}</p>}
    </div>}
    <details><summary>{t("Original response")}</summary>
      <textarea className="ui-textarea tool-result" readOnly rows={8}
        aria-label={t("Original response")} value={result.raw} />
    </details>
  </section>;
}
