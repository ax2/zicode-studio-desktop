import { useLayoutEffect, useRef, useState } from "react";
import { downloadFile } from "../../shared/download-file";
import { t } from "../../shared/i18n";
import { FileImportButton } from "./FileImportButton";
import type { ManualTool } from "./manual-tools";
import { readWorkbenchDraftFile, workbenchDraftFile } from "./workbench-draft-file";
import { snapshotWorkbenchDraft } from "./workbench-session-draft";

type RestoreDraft = (
  draft: Record<string, string>, expected: Record<string, string>, isCurrent: () => boolean,
) => Promise<boolean>;

export function WorkbenchDraftFileActions({ tool, values, disabled, onRestore }: {
  tool: ManualTool; values: Record<string, string>; disabled: boolean; onRestore: RestoreDraft;
}) {
  const [reading, setReading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ name: string; size: number; expected: typeof values; draft: typeof values } | null>(null);
  const currentValues = useRef(values);
  const request = useRef(0);
  useLayoutEffect(() => {
    currentValues.current = values;
  }, [values]);
  useLayoutEffect(() => () => { ++request.current; }, []);
  const pending = preview?.expected === values ? preview : null;

  async function read(file: File) {
    if (disabled || reading || restoring) return;
    const id = ++request.current;
    setReading(true);
    setError("");
    setPreview(null);
    try {
      const draft = await readWorkbenchDraftFile(file, tool);
      if (id === request.current && currentValues.current === values)
        setPreview({ name: file.name, size: file.size, expected: values, draft });
    } catch (reason) {
      if (id === request.current && currentValues.current === values)
        setError(reason instanceof Error ? reason.message : "Could not read the workbench draft file.");
    } finally {
      if (id === request.current) setReading(false);
    }
  }

  async function restore() {
    if (!pending || disabled || restoring) return;
    const id = ++request.current;
    const isCurrent = () => request.current === id && currentValues.current === pending.expected;
    setRestoring(true);
    setError("");
    try {
      const restored = await onRestore(pending.draft, pending.expected, isCurrent);
      if (id !== request.current) return;
      setPreview(null);
      if (!restored && isCurrent()) setError("The workbench changed. Choose the draft file again.");
    } catch {
      if (isCurrent()) setError("The workbench changed. Choose the draft file again.");
      if (id === request.current) setPreview(null);
    } finally {
      if (id === request.current) setRestoring(false);
    }
  }

  return <>
    <div className="ui-toolbar">
      <button type="button" className="ui-button ui-button--secondary" disabled={disabled || reading || restoring || !snapshotWorkbenchDraft(values)}
        title={t("The draft file contains the table and options as plain text.")}
        onClick={() => {
          const text = workbenchDraftFile(tool, values);
          if (!text) return;
          try {
            downloadFile("zicode-workbench-" + tool.capabilityId.split(".").at(-1) + "-" + Date.now() + ".json", text, "application/json");
            setError("");
          } catch {
            setError("Could not download the workbench draft.");
          }
        }}>{t("Download draft")}</button>
      <FileImportButton label={t("Restore draft from file…")} inputLabel={t("Workbench draft file")} accept=".json"
        loadingLabel="Reading workbench draft…" disabled={disabled || reading || restoring} loading={reading}
        onPick={file => { void read(file); }} />
    </div>
    {pending && <fieldset className="ui-toolbar workbench-draft-review" aria-label={t("Review workbench draft")}>
      <span className="workbench-draft-file-name"><bdi>{pending.name}</bdi> · {pending.size.toLocaleString()} {t("bytes")}</span>
      <button type="button" className="ui-button ui-button--secondary" disabled={restoring} onClick={() => setPreview(null)}>{t("Cancel")}</button>
      <button type="button" className="ui-button ui-button--primary" disabled={disabled || restoring} onClick={() => { void restore(); }}>
        {t("Replace current draft")}
      </button>
    </fieldset>}
    {error && <p role="alert">{t(error)}</p>}
  </>;
}
