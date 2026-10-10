import { useEffect, useState } from "react";
import { t } from "../../shared/i18n.js";
import { EnvironmentComparisonPanel } from "./EnvironmentComparisonPanel";
import { EnvironmentRequirementRow } from "./EnvironmentRequirement";
import { EnvironmentTools } from "./EnvironmentTools";
import { downloadEnvironmentReport } from "./environment-report-export";
import type { DetectedTool, EnvironmentRequirement } from "./environment-requirements";
import { PackageManagerDetails, type PackageManagerSelection } from "./PackageManagerDetails";
import { toolPathError } from "./tool-path-errors";

export interface EnvironmentReport {
  packageManager?: PackageManagerSelection | null;
  packageManagerError?: string | null;
  directory?: string;
  platform: string;
  architecture: string;
  piVersion: string;
  checkedAt: string;
  manifests: Array<{
    name: string;
    kind: string;
    status: string;
    requirements: EnvironmentRequirement[];
  }>;
  tools: DetectedTool[];
  projectWrappers?: string[];
}

export interface EnvironmentPanelProps {
  workspaceId?: string | null;
  revision: number;
  directory?: string;
  readEnvironment: (workspaceId: string, directory?: string) => Promise<EnvironmentReport>;
}

export function EnvironmentPanel({
  workspaceId,
  revision,
  readEnvironment,
  directory = "",
}: EnvironmentPanelProps) {
  const [retry, setRetry] = useState(0);
  const [exportError, setExportError] = useState<{ scope: string; message: string } | null>(null);
  const [result, setResult] = useState<{
    workspaceId: string;
    directory: string;
    revision: number;
    retry: number;
    report?: EnvironmentReport;
    failed?: boolean;
    error?: unknown;
  } | null>(null);
  const current =
    result?.workspaceId === workspaceId &&
    result?.directory === directory &&
    result?.revision === revision &&
    result?.retry === retry
      ? result
      : null;
  const loading = Boolean(workspaceId && !current);
  const scope = `${workspaceId ?? ""}\0${directory}\0${revision}\0${retry}`;

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    void (directory ? readEnvironment(workspaceId, directory) : readEnvironment(workspaceId)).then(
      (report) => {
        if (!active) return;
        if (
          (directory && report.directory !== directory) ||
          (report.directory !== undefined && report.directory !== directory)
        ) {
          setResult({
            workspaceId,
            directory,
            revision,
            retry,
            failed: true,
            error: new Error("environment_directory_unsupported"),
          });
        } else setResult({ workspaceId, directory, revision, retry, report });
      },
      (error) => {
        if (active) setResult({ workspaceId, directory, revision, retry, failed: true, error });
      },
    );
    return () => {
      active = false;
    };
  }, [workspaceId, directory, revision, retry, readEnvironment]);

  return (
    <section
      className="ui-panel project-environment"
      aria-label={t("Development environment")}
      aria-busy={loading}
    >
      <header className="project-environment-header">
        <h2>{t("Development environment")}</h2>
        <div className="ui-toolbar">
          <button
            type="button"
            className="ui-button ui-button--secondary"
            disabled={!current?.report}
            onClick={() => {
              if (!current?.report) return;
              try {
                downloadEnvironmentReport(current.report);
                setExportError(null);
              } catch (reason) {
                setExportError({
                  scope,
                  message: t(
                    reason instanceof Error
                      ? reason.message
                      : "Could not download environment report.",
                  ),
                });
              }
            }}
          >
            {t("Download environment report")}
          </button>
          <button
            type="button"
            className="ui-button ui-button--secondary"
            disabled={loading || !workspaceId}
            onClick={() => setRetry((value) => value + 1)}
          >
            {t("Check environment again")}
          </button>
        </div>
      </header>
      <p className="project-environment-hint">
        {t(
          "The downloaded environment report omits project IDs, directory names and executable paths. It is plaintext and may include private version declarations; review it before sharing.",
        )}
      </p>
      {exportError?.scope === scope ? <p role="alert">{exportError.message}</p> : null}
      <p className="project-environment-hint">
        {t(
          "Python selection follows commands in the selected directory: explicit environment, the nearest .venv or .conda up to the workspace root, tool directories, then host defaults. Automatically discovered environments are shown without executing an interpreter or substituting a host version. Toolchain overrides, dependencies and package integrity are not validated; no project tasks are started or tools installed.",
        )}
      </p>
      <p className="project-environment-hint">
        {t(
          "For Poetry projects, run the poetry env info --path task to inspect the environment Poetry selects. This command runs only when you start it from Project tasks.",
        )}
      </p>
      <p className="project-environment-hint">
        {t(
          "uv projects with uv.lock, [tool.uv], or explicit membership in the workspace root expose fixed Project commands. uv manages its own environment; lock and sync run only when you start them.",
        )}
      </p>
      <p role="status">
        {!workspaceId
          ? t("Open a project folder to inspect its development environment.")
          : loading
            ? t("Checking development tools…")
            : current?.failed
              ? directoryError(current.error) ||
                toolPathError(current.error) ||
                t(
                  "Could not inspect the environment. Update or reconnect the desktop host and retry.",
                )
              : t("Environment check finished")}
      </p>
      {current?.report ? (
        <>
          <EnvironmentDetails report={current.report} />
          <EnvironmentComparisonPanel key={scope} report={current.report} />
        </>
      ) : null}
    </section>
  );
}

function EnvironmentDetails({ report }: { report: EnvironmentReport }) {
  return (
    <>
      <dl className="project-environment-summary">
        <div>
          <dt>{t("Environment directory")}</dt>
          <dd>{report.directory || t("Workspace root")}</dd>
        </div>
        <div>
          <dt>{t("Host platform")}</dt>
          <dd>
            {report.platform} / {report.architecture}
          </dd>
        </div>
        <div>
          <dt>{t("Bundled Pi (pinned version)")}</dt>
          <dd>{report.piVersion}</dd>
        </div>
        <div>
          <dt>{t("Last environment check")}</dt>
          <dd>{new Date(report.checkedAt).toLocaleString()}</dd>
        </div>
      </dl>
      <PackageManagerDetails
        selection={report.packageManager}
        error={report.packageManagerError}
        tools={report.tools}
      />
      <h3>{t("Project manifests")}</h3>
      {report.manifests.length ? (
        <ul className="project-environment-list">
          {report.manifests.map((manifest) => (
            <li key={manifest.name}>
              <strong>{manifest.name}</strong>
              {manifest.status === "detected" ? (
                <>
                  <span>{t("Manifest detected")}</span>
                  {manifest.requirements.map((requirement) => (
                    <EnvironmentRequirementRow
                      key={`${requirement.tool}:${requirement.kind || "range"}`}
                      requirement={requirement}
                      tools={report.tools}
                    />
                  ))}
                </>
              ) : (
                <span>
                  {manifest.status === "conflicting"
                    ? t(
                        manifest.kind === "javascript"
                          ? "Node version files disagree. Align their declarations before comparing versions."
                          : "Both Rust toolchain files exist. Keep one declaration before comparing versions.",
                      )
                    : t("Manifest could not be read safely. Check its format, size and location.")}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("No supported manifests found in the selected directory.")}</p>
      )}
      <EnvironmentTools
        manifests={report.manifests}
        tools={report.tools}
        packageManager={report.packageManager?.manager}
        projectWrappers={report.projectWrappers ?? []}
      />
    </>
  );
}

function directoryError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : "";
  if (message === "environment_directory_unsupported")
    return t(
      "The host did not confirm this environment directory. Update the host or select the workspace root.",
    );
  if (["task_directory_invalid", "task_directory_unavailable"].includes(message))
    return t(
      "This project directory is unavailable or no longer inside the workspace. Refresh directories and select it again.",
    );
  return null;
}
