import { t } from "../../shared/i18n.js";
import type { PackageManagerSelection } from "./PackageManagerDetails";
import { toolPathError } from "./tool-path-errors";

export interface TaskDirectories {
  directories: Array<{ path: string; manifests: string[] }>;
  incomplete: boolean;
}

export interface TaskCatalog {
  packageManager?: PackageManagerSelection | null;
  directory?: string;
  manager: string;
  fingerprint: string;
  tasks: Array<{
    id?: string;
    name: string;
    command: string;
    runnable: boolean;
    source?: string;
    manager?: string;
    interpreter?: string | null;
    unavailableReason?: string | null;
  }>;
}

export interface ProjectRun {
  id: string;
  workspaceId: string;
  directory?: string;
  name: string;
  manager: string;
  command: string;
  invocation?: string;
  executable?: string;
  status: "running" | "stopping" | "succeeded" | "failed" | "cancelled" | "unknown";
  fingerprint?: string;
  historical?: boolean;
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export interface ProjectRunnerApi {
  canRun: boolean;
  directories(workspace: string): Promise<TaskDirectories>;
  validateDirectory?(workspace: string, directory: string): Promise<string>;
  catalog(workspace: string, directory?: string): Promise<TaskCatalog>;
  runs(workspace: string): Promise<ProjectRun[] | ProjectRunHistory>;
  clearHistory?(workspace: string): Promise<unknown>;
  start(workspace: string, name: string, fingerprint: string, directory?: string): Promise<unknown>;
  stop(workspace: string, runId: string): Promise<unknown>;
}

export interface ProjectRunHistory {
  runs: ProjectRun[];
  historyStatus: "persistent" | "unavailable" | "memory";
}

export function normalizeHistory(value: ProjectRun[] | ProjectRunHistory): ProjectRunHistory {
  return Array.isArray(value) ? { runs: value, historyStatus: "memory" } : value;
}

export function isActiveRun(run: ProjectRun): boolean {
  return !run.historical && (run.status === "running" || run.status === "stopping");
}

export function taskError(error: unknown): string {
  if (error instanceof Error && error.message === "task_directory_unconfirmed")
    return t(
      "The host did not confirm this command directory. Update the host or select the workspace root.",
    );
  const environmentError = toolPathError(error);
  if (environmentError) return environmentError;
  const code = error instanceof Error ? error.message : "";
  if (code === "task_manager_conflicting")
    return t(
      "Multiple package managers are configured here. Keep one lockfile family or set packageManager explicitly, then refresh.",
    );
  if (code === "task_workspace_invalid")
    return t(
      "The workspace declaration could not be resolved. Check its paths and syntax, or set this package's packageManager explicitly.",
    );
  if (code === "task_manager_unsupported")
    return t(
      "The packageManager declaration is unsupported. Use npm, pnpm, yarn or bun with a declaration of at most 200 bytes.",
    );
  if (code === "task_catalog_too_large")
    return t(
      "This directory has too many project files or tasks to list safely. Select a smaller subproject directory.",
    );
  if (code === "task_history_unavailable")
    return t("Saved command history is unavailable. History was not cleared.");
  if (code === "task_directory_invalid" || code === "task_directory_unavailable")
    return t(
      "This command directory is unavailable or outside the workspace. Refresh and select a project directory.",
    );
  if (code === "task_python_missing")
    return t(
      "Python was not found. Install Python or create a project .venv, then refresh the command list.",
    );
  if (code === "task_python_environment_invalid")
    return t(
      "The project .venv is incomplete or points outside the project. Repair it, then refresh. The host Python will not be used as a fallback.",
    );
  if (code === "task_python_conda_invalid")
    return t(
      "The project Conda environment is incomplete or points outside the project. Repair it, then refresh. The host Python will not be used as a fallback.",
    );
  if (code === "task_cmake_build_dir_invalid")
    return t(
      "The CMake build directory is a file or linked directory. Repair build/zicode-studio inside this project before running CMake commands.",
    );
  if (code === "task_cmake_presets_invalid")
    return t(
      "CMakePresets.json is invalid or exceeds the supported manifest size. Repair it and refresh the command list.",
    );
  if (code === "task_wrapper_invalid")
    return t(
      "The project build wrapper is linked, unreadable or not executable. Repair it before running Maven or Gradle tasks.",
    );
  if (code === "task_gradle_manifest_conflict")
    return t(
      "Both Groovy and Kotlin Gradle build or settings files are present. Keep one file of each kind, then refresh the command list.",
    );
  if (code === "task_catalog_changed")
    return t(
      "Project scripts or tool directories changed. Refresh the task list before running again.",
    );
  if (code === "task_project_busy" || code === "task_limit_reached")
    return t("A project task is already running, or the host task limit was reached.");
  if (code === "task_manager_missing")
    return t("Install the required development tool and restart ZiCode before running this task.");
  if (code === "task_batch_argument_unsupported")
    return t(
      "This project argument cannot be passed safely through a Windows .cmd or .bat wrapper. Use an executable tool or rename the target to letters, numbers, _, :, -, . or /.",
    );
  if (code === "task_request_timed_out")
    return t(
      "The task request timed out. Refresh run history to check whether it started or stopped.",
    );
  return t(
    "Could not complete the task request. Check the project manifest and desktop connection, then refresh.",
  );
}

export function taskStatus(status: ProjectRun["status"]): string {
  const labels = {
    running: "Task running",
    stopping: "Task stopping",
    succeeded: "Task succeeded",
    failed: "Task failed",
    cancelled: "Task cancelled",
    unknown: "Task outcome unknown",
  };
  return t(labels[status]);
}
