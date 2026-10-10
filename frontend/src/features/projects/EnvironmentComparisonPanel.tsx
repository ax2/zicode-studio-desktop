import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n.js";
import type { EnvironmentReport } from "./EnvironmentPanel";
import {
  compareEnvironmentDeclarations,
  compareEnvironmentTools,
  type ImportedEnvironmentSnapshot,
  readEnvironmentReportFile,
} from "./environment-report-compare";

function toolSummary(tool?: {
  status: string;
  version: string | null;
  source?: string | null;
}): string {
  if (!tool) return t("Not in this snapshot");
  return [tool.status, tool.version, tool.source].filter(Boolean).join(" · ");
}

function declarationSummary(
  entry: ReturnType<typeof compareEnvironmentDeclarations>[number],
): string {
  if (entry.category === "manifest")
    return `${t("Manifest category")}: ${entry.manifestKind} · ${entry.status}`;
  const requirement = entry.requirement;
  if (!requirement) return entry.manifestKind;
  const kind = requirement.kind ? ` (${requirement.kind})` : "";
  const constraint = requirement.constraint || t("No version constraint");
  return `${entry.manifestKind} · ${requirement.tool}${kind}: ${constraint}${requirement.truncated ? "…" : ""}`;
}

export function EnvironmentComparisonPanel({ report }: { report: EnvironmentReport }) {
  const generation = useRef(0);
  const [imported, setImported] = useState<ImportedEnvironmentSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  const differences = imported ? compareEnvironmentTools(report, imported) : [];
  const declarations = imported ? compareEnvironmentDeclarations(report, imported) : [];

  return (
    <section
      className="project-environment-compare"
      aria-label={t("Compare environment snapshots")}
    >
      <h3>{t("Compare environment snapshots")}</h3>
      <p className="project-environment-hint">
        {t(
          "Choose a previously downloaded environment report. The file stays in this view; comparison does not import settings or run tools.",
        )}
      </p>
      <label className="project-environment-compare-input">
        {t("Choose environment report JSON")}
        <input
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            const ticket = ++generation.current;
            setImported(null);
            setError(null);
            void readEnvironmentReportFile(file).then(
              (snapshot) => {
                if (ticket === generation.current) setImported(snapshot);
              },
              (reason) => {
                if (ticket === generation.current)
                  setError(
                    t(
                      reason instanceof Error ? reason.message : "Invalid environment report file.",
                    ),
                  );
              },
            );
          }}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      {imported ? (
        <>
          <p>
            {t("Current snapshot checked")}: {new Date(report.checkedAt).toLocaleString()} ·{" "}
            {report.platform} / {report.architecture}
          </p>
          <p>
            {t("Imported snapshot checked")}: {new Date(imported.checkedAt).toLocaleString()} ·{" "}
            {imported.platform} / {imported.architecture}
          </p>
          <p className="project-environment-hint">
            {t(
              "Snapshots are historical and omit project identity; confirm both reports describe the intended project and directories before comparing results.",
            )}
          </p>
          {imported.scope !== (report.directory ? "subproject" : "workspace-root") ? (
            <p role="status">{t("These snapshots have different directory scopes.")}</p>
          ) : null}
          {imported.piVersion !== report.piVersion ||
          imported.packageManager !== (report.packageManager?.manager ?? null) ? (
            <>
              <h4>{t("Runtime differences")}</h4>
              <table className="project-environment-compare-table">
                <thead>
                  <tr>
                    <th scope="col">{t("Tool")}</th>
                    <th scope="col">{t("Current environment")}</th>
                    <th scope="col">{t("Imported environment")}</th>
                  </tr>
                </thead>
                <tbody>
                  {imported.piVersion !== report.piVersion ? (
                    <tr>
                      <th scope="row">{t("Bundled Pi (pinned version)")}</th>
                      <td>{report.piVersion}</td>
                      <td>{imported.piVersion}</td>
                    </tr>
                  ) : null}
                  {imported.packageManager !== (report.packageManager?.manager ?? null) ? (
                    <tr>
                      <th scope="row">{t("JavaScript package manager")}</th>
                      <td>{report.packageManager?.manager ?? "—"}</td>
                      <td>{imported.packageManager ?? "—"}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </>
          ) : null}
          <h4>
            {t("Tool differences")} ({differences.length})
          </h4>
          {differences.length ? (
            <table className="project-environment-compare-table">
              <thead>
                <tr>
                  <th scope="col">{t("Tool")}</th>
                  <th scope="col">{t("Current environment")}</th>
                  <th scope="col">{t("Imported environment")}</th>
                </tr>
              </thead>
              <tbody>
                {differences.map((difference) => (
                  <tr key={difference.id}>
                    <th scope="row">{difference.id}</th>
                    <td>{toolSummary(difference.current)}</td>
                    <td>{toolSummary(difference.imported)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>{t("No tool status, version or source differences in these snapshots.")}</p>
          )}
          <h4>
            {t("Static declaration differences")} ({declarations.length})
          </h4>
          {declarations.length ? (
            <>
              <table className="project-environment-compare-table">
                <thead>
                  <tr>
                    <th scope="col">{t("Declaration")}</th>
                    <th scope="col">{t("Current environment")}</th>
                    <th scope="col">{t("Imported environment")}</th>
                  </tr>
                </thead>
                <tbody>
                  {declarations.slice(0, 24).map((entry) => (
                    <tr key={entry.key}>
                      <th scope="row">{declarationSummary(entry)}</th>
                      <td>{entry.currentCount}</td>
                      <td>{entry.importedCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {declarations.length > 24 ? (
                <p>
                  {declarations.length - 24} {t("additional declaration differences omitted")}
                </p>
              ) : null}
            </>
          ) : (
            <p>{t("No static declaration differences in these snapshots.")}</p>
          )}
        </>
      ) : null}
    </section>
  );
}
