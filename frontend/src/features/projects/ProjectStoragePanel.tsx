import { useEffect, useState } from "react";
import { t } from "../../shared/i18n.js";
import { compareProjectStorage } from "./project-storage-comparison";

interface StorageEntry {
  path: string;
  bytes: number;
  files: number;
  hardlinkBytes?: number;
  hardlinkFiles?: number;
  skipped: number;
  status: "complete" | "partial" | "linked" | "unreadable" | "not_directory";
}

export interface ProjectStorageReport {
  directory: string;
  checkedAt: string;
  availableBytes?: number;
  entries: StorageEntry[];
}

function readReport(value: unknown, directory: string): ProjectStorageReport {
  if (!value || typeof value !== "object") throw new Error("project_storage_invalid");
  const report = value as Record<string, unknown>;
  if (
    report.directory !== directory ||
    typeof report.checkedAt !== "string" ||
    !Number.isFinite(Date.parse(report.checkedAt)) ||
    (report.availableBytes !== undefined &&
      (!Number.isSafeInteger(report.availableBytes) || Number(report.availableBytes) < 0)) ||
    !Array.isArray(report.entries) ||
    report.entries.length > 32
  )
    throw new Error("project_storage_invalid");
  const paths = new Set<string>();
  for (const candidate of report.entries) {
    if (!candidate || typeof candidate !== "object") throw new Error("project_storage_invalid");
    const entry = candidate as Record<string, unknown>;
    if (
      typeof entry.path !== "string" ||
      !entry.path ||
      entry.path.length > 128 ||
      !entry.path
        .split("/")
        .every((part) => part !== "." && part !== ".." && /^[A-Za-z0-9_.-]+$/.test(part)) ||
      paths.has(entry.path) ||
      !["complete", "partial", "linked", "unreadable", "not_directory"].includes(
        String(entry.status),
      ) ||
      ![entry.bytes, entry.files, entry.skipped].every(
        (count) => Number.isSafeInteger(count) && Number(count) >= 0,
      ) ||
      (entry.hardlinkBytes === undefined) !== (entry.hardlinkFiles === undefined) ||
      (entry.hardlinkBytes !== undefined &&
        (!Number.isSafeInteger(entry.hardlinkBytes) ||
          Number(entry.hardlinkBytes) < 0 ||
          Number(entry.hardlinkBytes) > Number(entry.bytes) ||
          !Number.isSafeInteger(entry.hardlinkFiles) ||
          Number(entry.hardlinkFiles) < 0 ||
          Number(entry.hardlinkFiles) > Number(entry.files)))
    )
      throw new Error("project_storage_invalid");
    paths.add(entry.path);
  }
  return report as unknown as ProjectStorageReport;
}

function size(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function entryStatus(entry: StorageEntry): string {
  if (entry.status === "complete") return t("Complete scan");
  if (entry.status === "partial") return t("Partial scan");
  if (entry.status === "linked") return t("Linked directory skipped");
  return t("Directory could not be scanned");
}

function entryGuidance(path: string): string {
  if (path === "target" || path === "src-tauri/target")
    return t(
      "Usually Rust build output. Finish running builds and confirm the project can rebuild before removing it.",
    );
  if (path === "node_modules")
    return t(
      "Installed JavaScript dependencies. Check the lockfile and package manager before recreating them.",
    );
  if (path === ".venv" || path === ".conda" || path === ".tox")
    return t(
      "Project Python environment. Check how its packages are reproduced before removing it.",
    );
  if (
    path === ".cache" ||
    path === ".gradle" ||
    path === ".pytest_cache" ||
    path === ".mypy_cache" ||
    path === ".ruff_cache"
  )
    return t(
      "May contain downloads, logs, or useful project state. Inspect its contents before removing it.",
    );
  return t(
    "May contain generated output or deployment assets. Check how this project uses the directory before removing it.",
  );
}

function scanError(reason: unknown): string {
  const code = reason instanceof Error ? reason.message : String(reason);
  if (code === "project_storage_busy")
    return t("Another project storage scan is still running. Wait, then try again.");
  if (code === "project_storage_timeout")
    return t(
      "The project storage scan timed out. A filesystem call may still be running; try again later.",
    );
  if (code === "task_directory_invalid" || code === "task_directory_unavailable")
    return t(
      "This project directory is unavailable or no longer inside the workspace. Refresh directories and select it again.",
    );
  return t("Could not complete the project storage scan.");
}

interface ProjectStoragePanelProps {
  workspaceId?: string;
  directory?: string;
  readStorage?: (workspaceId: string, directory: string) => Promise<unknown>;
  openEntry?: (workspaceId: string, relativePath: string) => Promise<void>;
}

export function ProjectStoragePanel(props: ProjectStoragePanelProps) {
  // A new project must not render the previous project's scan or open error
  // while its own asynchronous scan is still pending.
  const scope = JSON.stringify([props.workspaceId ?? "", props.directory ?? ""]);
  return <ScopedProjectStoragePanel key={scope} {...props} />;
}

function ScopedProjectStoragePanel({
  workspaceId,
  directory = "",
  readStorage,
  openEntry,
}: ProjectStoragePanelProps) {
  const [retry, setRetry] = useState(0);
  const [scans, setScans] = useState<{
    current: ProjectStorageReport;
    previous: ProjectStorageReport | null;
  } | null>(null);
  const result = scans?.current ?? null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState("");

  async function openDirectory(path: string) {
    if (!workspaceId || !openEntry) return;
    setOpening(path);
    setOpenError("");
    try {
      await openEntry(workspaceId, directory ? `${directory}/${path}` : path);
    } catch {
      setOpenError(t("Could not open this directory. It may have changed; scan again."));
    } finally {
      setOpening(null);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly starts a fresh scan.
  useEffect(() => {
    if (!workspaceId || !readStorage) return;
    let active = true;
    setLoading(true);
    setError("");
    void Promise.resolve()
      .then(() => readStorage(workspaceId, directory))
      .then((value) => readReport(value, directory))
      .then(
        (report) => {
          if (active)
            setScans((previous) => ({ current: report, previous: previous?.current ?? null }));
        },
        (reason) => {
          if (active) setError(scanError(reason));
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, directory, readStorage, retry]);

  return (
    <section
      className="ui-panel project-environment"
      aria-label={t("Project storage")}
      aria-busy={loading}
    >
      <header className="project-environment-header">
        <h2>{t("Project storage")}</h2>
        {readStorage && workspaceId ? (
          <button
            type="button"
            className="ui-button ui-button--secondary"
            disabled={loading}
            onClick={() => setRetry((value) => value + 1)}
          >
            {t("Scan project storage")}
          </button>
        ) : null}
      </header>
      <p>
        {t(
          "This is a read-only, bounded scan of common generated directories. Sizes are logical file sizes, not an estimate of reclaimable disk space. Review each directory before removing it.",
        )}
      </p>
      <p className="project-environment-hint">
        {t("Storage scan directory")}: <strong>{directory || t("Workspace root")}</strong>
      </p>
      {!readStorage ? (
        <p>{t("Project storage inspection is available in the desktop app only.")}</p>
      ) : !workspaceId ? (
        <p>{t("Open a project folder to inspect its storage.")}</p>
      ) : (
        <>
          {loading ? <p role="status">{t("Scanning project storage…")}</p> : null}
          {error ? <p role="alert">{error}</p> : null}
          {openError ? <p role="alert">{openError}</p> : null}
          {result ? (
            <>
              <p>
                {t("Last storage scan")}: {new Date(result.checkedAt).toLocaleString()}
              </p>
              <p>
                {result.availableBytes === undefined
                  ? t("Available volume space was not reported for this scan.")
                  : `${t("Available on the selected directory's volume")}: ${size(result.availableBytes)}`}
              </p>
              {scans?.previous && !loading && !error ? (
                <StorageComparison previous={scans.previous} current={result} />
              ) : null}
              {result.entries.length ? (
                <>
                  <p>{t("Largest observed directories first")}</p>
                  <ul className="project-environment-list">
                    {result.entries
                      .slice()
                      .sort(
                        (left, right) =>
                          right.bytes - left.bytes || left.path.localeCompare(right.path),
                      )
                      .map((entry) => (
                        <li key={entry.path}>
                          <strong>{entry.path}</strong>
                          {entry.status === "complete" || entry.status === "partial" ? (
                            <span>
                              {entry.status === "partial" ? "≥ " : ""}
                              {size(entry.bytes)} · {entry.status === "partial" ? "≥ " : ""}
                              {entry.files} {t("files")}
                            </span>
                          ) : null}
                          <span>
                            {entryStatus(entry)}
                            {entry.skipped ? ` · ${entry.skipped} ${t("entries skipped")}` : ""}
                          </span>
                          {entry.status === "complete" || entry.status === "partial" ? (
                            <span className="project-environment-hint">
                              {entryGuidance(entry.path)}
                            </span>
                          ) : null}
                          {entry.hardlinkBytes ? (
                            <span>
                              {t(
                                "{size} across {count} hard-linked files; deleting this directory may free less space.",
                              )
                                .replace("{size}", size(entry.hardlinkBytes))
                                .replace("{count}", String(entry.hardlinkFiles))}
                            </span>
                          ) : null}
                          {openEntry &&
                          entry.status !== "linked" &&
                          entry.status !== "not_directory" ? (
                            <button
                              type="button"
                              className="ui-button ui-button--secondary ui-button--sm"
                              disabled={opening !== null}
                              onClick={() => void openDirectory(entry.path)}
                            >
                              {t("Open directory")}
                            </button>
                          ) : null}
                        </li>
                      ))}
                  </ul>
                </>
              ) : (
                <p role="status">{t("No common generated directories found.")}</p>
              )}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

function StorageComparison({
  previous,
  current,
}: {
  previous: ProjectStorageReport;
  current: ProjectStorageReport;
}) {
  const changes = compareProjectStorage(previous, current);
  function delta(bytes: number) {
    return bytes === 0
      ? t("No observed size change")
      : `${bytes > 0 ? "+" : "−"}${size(Math.abs(bytes))}`;
  }
  return (
    <section aria-label={t("Changes since the previous successful scan")}>
      <h3>{t("Changes since the previous successful scan")}</h3>
      <p className="project-environment-hint">
        {t("Previous storage scan")}:{" "}
        <time dateTime={previous.checkedAt}>{new Date(previous.checkedAt).toLocaleString()}</time>
      </p>
      <p className="project-environment-hint">
        {t(
          "Changes compare logical sizes from two complete scans. They do not measure freed disk space; linked, incomplete, and unobserved directories have no calculated change.",
        )}
      </p>
      {changes.length ? (
        <ul className="project-environment-list">
          {changes.map((change) => (
            <li key={change.path}>
              <strong>{change.path}</strong>
              {change.bytes !== null && change.files !== null ? (
                <span>
                  {delta(change.bytes)} · {change.files > 0 ? "+" : ""}
                  {change.files} {t("files")}
                </span>
              ) : (
                <span>
                  {change.reason === "not-observed"
                    ? t("Not observed in both scans")
                    : t("At least one scan was incomplete or unavailable")}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("No common generated directories found.")}</p>
      )}
    </section>
  );
}
