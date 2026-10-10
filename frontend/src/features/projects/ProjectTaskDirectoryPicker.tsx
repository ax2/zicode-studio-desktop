import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { t } from "../../shared/i18n.js";
import { validProjectDirectory } from "./directory-context";
import type { ProjectRunnerApi, TaskDirectories } from "./project-runner";

interface DirectoryPickerProps {
  workspaceId: string;
  api: Pick<ProjectRunnerApi, "directories" | "validateDirectory">;
  label?: string;
  revision: number;
  value: string;
  disabled: boolean;
  onChange(value: string): void;
}

export function ProjectTaskDirectoryPicker(props: DirectoryPickerProps) {
  return <ScopedProjectTaskDirectoryPicker key={props.workspaceId} {...props} />;
}

function ScopedProjectTaskDirectoryPicker({
  workspaceId,
  api,
  revision,
  value,
  disabled,
  onChange,
  label = t("Command directory"),
}: DirectoryPickerProps) {
  const id = useId();
  const manualId = useId();
  const confirmation = useRef(0);
  const [draft, setDraft] = useState(value);
  const [confirming, setConfirming] = useState(false);
  const [manualError, setManualError] = useState("");
  const [result, setResult] = useState<{
    api: Pick<ProjectRunnerApi, "directories">;
    workspaceId: string;
    revision: number;
    discovery?: TaskDirectories;
    failed?: boolean;
  } | null>(null);
  const current =
    result?.workspaceId === workspaceId && result.revision === revision && result.api === api
      ? result
      : null;
  const discovery = current?.discovery;
  const failed = Boolean(current?.failed);
  useEffect(() => setDraft(value), [value]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: workspace or API changes invalidate in-flight directory confirmations.
  useEffect(() => {
    confirmation.current += 1;
    setConfirming(false);
    setManualError("");
    return () => {
      confirmation.current += 1;
    };
  }, [workspaceId, api]);

  async function applyManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || confirming) return;
    if (!validProjectDirectory(draft)) {
      setManualError(t("Use a relative path without parent segments or backslashes."));
      return;
    }
    if (!api.validateDirectory) {
      setManualError(t("Manual directory selection is unavailable in this Host."));
      return;
    }
    const request = ++confirmation.current;
    setConfirming(true);
    setManualError("");
    try {
      const confirmed = await api.validateDirectory(workspaceId, draft);
      if (request !== confirmation.current) return;
      if (confirmed !== draft) throw new Error("task_directory_unconfirmed");
      onChange(confirmed);
    } catch (error) {
      if (request === confirmation.current)
        setManualError(
          t(
            error instanceof Error && error.message === "task_directory_unsupported"
              ? "Manual directory selection is unavailable in this Host."
              : "Directory could not be confirmed inside this workspace. Check the path and try again.",
          ),
        );
    } finally {
      if (request === confirmation.current) setConfirming(false);
    }
  }
  useEffect(() => {
    let active = true;
    void api.directories(workspaceId).then(
      (result) => {
        if (active) setResult({ api, workspaceId, revision, discovery: result });
      },
      () => {
        if (active) setResult({ api, workspaceId, revision, failed: true });
      },
    );
    return () => {
      active = false;
    };
  }, [api, workspaceId, revision]);
  const paths = Array.from(
    new Set(["", ...(discovery?.directories.map((item) => item.path) ?? []), value]),
  );
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="ui-select"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {paths.map((path) => (
          <option key={path} value={path}>
            {path || t("Workspace root")}
          </option>
        ))}
      </select>
      <details>
        <summary>{t("Choose another workspace directory")}</summary>
        <form onSubmit={(event) => void applyManual(event)}>
          <label htmlFor={manualId}>{t("Relative directory inside workspace")}</label>
          <input
            id={manualId}
            className="ui-input"
            value={draft}
            maxLength={2048}
            placeholder={t("Example: services/api")}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={Boolean(manualError)}
            disabled={disabled || confirming}
            onChange={(event) => {
              setDraft(event.target.value);
              setManualError("");
            }}
          />
          <button
            type="submit"
            className="ui-button ui-button--secondary ui-button--sm"
            disabled={disabled || confirming}
          >
            {t("Use directory")}
          </button>
        </form>
        <p>{t("Use forward slashes. The directory must exist inside this workspace.")}</p>
        {manualError && <p role="alert">{manualError}</p>}
      </details>
      {!discovery && !failed && <p role="status">{t("Finding project directories…")}</p>}
      {failed && (
        <p role="status">
          {t("Project directories could not be refreshed. Use the refresh action to retry.")}
        </p>
      )}
      {discovery?.incomplete && (
        <p role="status">
          {t(
            "Project discovery is incomplete because of limits, access errors, or unsupported workspace declarations. Enter a missing directory above or open it as a workspace.",
          )}
        </p>
      )}
    </div>
  );
}
