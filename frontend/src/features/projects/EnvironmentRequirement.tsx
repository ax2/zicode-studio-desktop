import { t } from "../../shared/i18n.js";
import {
  assessRequirement,
  type DetectedTool,
  type EnvironmentRequirement,
  type RequirementStatus,
} from "./environment-requirements";
import { pythonSourceLabel } from "./PythonToolSource";

const LABELS: Record<RequirementStatus, string> = {
  satisfied: "Version requirement satisfied",
  mismatch: "Version requirement not satisfied",
  missing: "Required tool not found",
  unavailable: "Required tool could not be checked",
  unsupported: "Version comparison is not supported for this tool",
  invalid: "Version requirement could not be interpreted",
  truncated: "Version requirement was truncated; comparison skipped",
  "unknown-version": "Detected version could not be interpreted",
};

export function EnvironmentRequirementRow({
  requirement,
  tools,
}: {
  requirement: EnvironmentRequirement;
  tools: DetectedTool[];
}) {
  const result = assessRequirement(requirement, tools);
  const recommended = requirement.kind === "recommended";
  const projectSdk = tools.find((tool) => tool.id === "dotnet-project");
  const python = tools.find((tool) => tool.id === "python");
  const label =
    result.status === "unsupported" && requirement.kind === "version-manager"
      ? "Version manager selection is not inferred. Check the active tool in your terminal."
      : result.status === "unsupported" && requirement.kind === "dotnet-sdk"
        ? projectSdk?.status === "ready"
          ? "Project SDK selection was checked. Compare the selected version with the project's roll-forward policy."
          : "Project SDK selection could not be checked. Inspect the dotnet result for this project directory."
        : result.status === "unsupported" && requirement.kind === "composer-php"
          ? "This Composer PHP constraint needs manual verification in your terminal."
          : result.status === "unsupported" && requirement.tool === "python"
            ? "Python version comparison is unavailable. Use a current host and a static project.requires-python declaration."
            : result.status === "unsupported" && requirement.kind === "node-version-file"
              ? "Dynamic Node version aliases need a version manager; compare the resolved version in your system terminal."
              : result.status === "unsupported" &&
                  (requirement.tool === "rustc" || requirement.tool === "go")
                ? "Resolve this toolchain or inherited declaration in your system terminal."
                : recommended && result.status === "mismatch"
                  ? "Host version is below the recommended toolchain"
                  : recommended && result.status === "satisfied"
                    ? "Host version meets the recommended toolchain"
                    : LABELS[result.status];
  return (
    <div className="project-environment-requirement">
      <span>
        {requirement.kind === "workspace-minimum"
          ? `${t("Inherited minimum version")}: `
          : requirement.kind === "version-manager"
            ? `${t("Version manager declaration")}: `
            : requirement.kind === "bundler-lock"
              ? `${t("Pinned Bundler version")}: `
              : requirement.kind === "minimum"
                ? `${t("Minimum version")}: `
                : requirement.kind === "toolchain"
                  ? `${t("Pinned toolchain")}: `
                  : recommended
                    ? `${t("Recommended toolchain")}: `
                    : ""}
        {requirement.tool}:{" "}
        {requirement.kind === "pep440" && !requirement.constraint
          ? t("Any Python version")
          : requirement.constraint}
        {requirement.truncated ? "…" : ""}
      </span>
      <strong>{t(label)}</strong>
      {requirement.kind === "version-manager" && result.status !== "unsupported" && (
        <span>
          {t("Compared with the detected tool; version manager resolution is not verified.")}
        </span>
      )}
      {requirement.kind === "bundler-lock" &&
        (result.status === "satisfied" || result.status === "mismatch") && (
          <span>{t("Compared with the detected Bundler CLI; dependencies are not checked.")}</span>
        )}
      {requirement.kind === "composer-php" &&
        (result.status === "satisfied" || result.status === "mismatch") && (
          <span>
            {t(
              "Compared with the detected PHP CLI. Composer platform overrides, extensions and dependencies are not checked.",
            )}
          </span>
        )}
      {requirement.kind === "pep440" &&
        (result.status === "satisfied" || result.status === "mismatch") && (
          <>
            <span>
              {t(
                "Compared with the detected Python interpreter for this directory; check its source below.",
              )}
            </span>
            <span>
              {t("Python selection source")}: {pythonSourceLabel(python?.source)}
            </span>
          </>
        )}
      {requirement.kind === "dotnet-sdk" &&
        projectSdk?.status === "ready" &&
        projectSdk.version && (
          <span>
            {t("Selected project SDK")}: {projectSdk.version}
          </span>
        )}
      {result.version && (
        <span>
          {t("Detected version")}: {result.tool} {result.version}
        </span>
      )}
      {(result.status === "mismatch" || result.status === "missing") && (
        <p>{t("Select or install a matching tool version, restart ZiCode, then check again.")}</p>
      )}
    </div>
  );
}
