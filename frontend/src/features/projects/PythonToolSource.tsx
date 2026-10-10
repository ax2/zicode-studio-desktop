import { t } from "../../shared/i18n";
import type { DetectedTool } from "./environment-requirements";

export function pythonSourceLabel(source: string | undefined): string {
  return source === "explicit-conda"
    ? t("Explicit Conda environment")
    : source === "explicit-environment"
      ? t("Explicit Python environment")
      : source === "project-venv"
        ? t("Project .venv in selected directory or parent")
        : source === "project-conda"
          ? t("Project Conda environment in selected directory or parent")
          : source === "tool-directory"
            ? t("Project tool directory")
            : source === "host"
              ? t("Host Python")
              : t("Python selection source not reported");
}

export function PythonToolSource({ tool }: { tool: DetectedTool }) {
  if (tool.id !== "python") return null;
  return (
    <>
      <span className="project-environment-hint">{pythonSourceLabel(tool.source)}</span>
      {(tool.source === "explicit-conda" || tool.source === "project-conda") && (
        <p>
          {t(
            "Conda activation hooks and variables saved with conda env config vars are not loaded. If your environment needs them, activate it explicitly in a terminal.",
          )}
        </p>
      )}
      {tool.status === "unverified" ? (
        <p>
          {t(
            tool.source === "project-conda"
              ? "This Conda environment was found without executing its interpreter. Select its directory explicitly under Python environment (venv or Conda) to check the version."
              : "This .venv will be used for Python commands in the selected directory. Select this directory explicitly under Python environment (venv or Conda) to check its version. Discovery alone does not execute it.",
          )}
        </p>
      ) : tool.status === "invalid-environment" ? (
        <p>
          {t(
            tool.source === "project-conda"
              ? "The project Conda environment is incomplete or points outside the project. Repair it, then refresh. The host Python will not be used as a fallback."
              : "The project .venv is incomplete or points outside the project. Repair it, then refresh. The host Python will not be used as a fallback.",
          )}
        </p>
      ) : !tool.source && tool.status !== "missing" ? (
        <p>
          {t(
            "Update the desktop host to compare the Python interpreter selected for project commands.",
          )}
        </p>
      ) : null}
    </>
  );
}
