import { t } from "../../shared/i18n.js";
import { EnvironmentRequirementRow } from "./EnvironmentRequirement";
import type { DetectedTool } from "./environment-requirements";
import { taskError } from "./project-runner";

export interface PackageManagerSelection {
  manager: string;
  source: string;
  directory: string;
  inherited: boolean;
  requirement: string | null;
}

export function PackageManagerDetails({
  selection,
  error,
  tools,
}: {
  selection?: PackageManagerSelection | null;
  error?: string | null;
  tools?: DetectedTool[];
}) {
  if (error) return <p role="alert">{taskError(new Error(error))}</p>;
  if (!selection) return null;
  return (
    <section aria-label={t("JavaScript package manager")}>
      <h3>{t("JavaScript package manager")}</h3>
      <p>
        <strong>{selection.manager}</strong> ·{" "}
        {selection.inherited
          ? t("Inherited from a declared ancestor workspace")
          : t("Selected for this project directory")}
      </p>
      <dl className="project-environment-summary">
        <div>
          <dt>{t("Package manager configuration directory")}</dt>
          <dd>{selection.directory || t("Workspace root")}</dd>
        </div>
        <div>
          <dt>{t("Package manager selection source")}</dt>
          <dd>{selection.source === "default" ? t("Default npm fallback") : selection.source}</dd>
        </div>
      </dl>
      {selection.requirement &&
        (tools ? (
          <EnvironmentRequirementRow
            requirement={{
              tool: "packageManager",
              constraint: selection.requirement,
              truncated: false,
            }}
            tools={tools}
          />
        ) : (
          <p>{selection.requirement}</p>
        ))}
    </section>
  );
}
