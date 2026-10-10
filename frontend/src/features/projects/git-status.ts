import { t } from "../../shared/i18n.js";

export interface GitFile {
  path: string;
  originalPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
  stageable?: boolean;
  unstageable?: boolean;
}

export function gitUnstageError(reason: unknown): string {
  const code = reason instanceof Error ? reason.message : String(reason);
  if (code === "git_unstage_stale")
    return t("Git index changed. Refresh and confirm the file again.");
  if (
    code === "git_unstage_timeout" ||
    code === "git_unstage_result_unknown" ||
    code === "task_request_timed_out"
  )
    return t("Unstaging result is uncertain. Refresh Git status before trying again.");
  if (code === "git_unstage_status_unavailable")
    return t("Could not confirm current Git index. Refresh and try again.");
  return t("Could not unstage this file. Check the repository and refresh Git status.");
}

export function gitStageError(reason: unknown): string {
  const code = reason instanceof Error ? reason.message : String(reason);
  if (code === "git_stage_stale")
    return t("Git status changed. Refresh and confirm the file again.");
  if (
    code === "git_stage_timeout" ||
    code === "git_stage_result_unknown" ||
    code === "task_request_timed_out"
  )
    return t("Staging result is uncertain. Refresh Git status before trying again.");
  if (code === "git_stage_status_unavailable")
    return t("Could not confirm current Git status. Refresh and try again.");
  return t("Could not stage this file. Check the repository and refresh Git status.");
}

export type GitDiffMode = "staged" | "unstaged";

export interface GitDiff {
  mode: GitDiffMode;
  patch: string;
  truncated: boolean;
}

export interface GitStatus {
  isRepository: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicts: number;
  totalFiles: number;
  truncated: boolean;
  files: GitFile[];
}

export function gitStatusError(reason: unknown): string {
  const code = reason instanceof Error ? reason.message : String(reason);
  if (code === "git_unavailable")
    return t("Git is unavailable. Check the Git installation and refresh.");
  if (code === "git_timeout") return t("Git inspection timed out. Try refreshing this project.");
  if (code === "git_output_too_large")
    return t("This project has too many changes to inspect here. Use your Git client.");
  if (code === "git_unsupported") return t("Git status requires an updated desktop host.");
  return t("Could not read Git status. Check repository access and refresh.");
}

export function gitChangeLabel(status: string): string {
  switch (status) {
    case "M":
      return t("Modified");
    case "A":
      return t("Added");
    case "D":
      return t("Deleted");
    case "R":
      return t("Renamed");
    case "C":
      return t("Copied");
    case "T":
      return t("Type changed");
    case "U":
      return t("Unmerged");
    case "?":
      return t("Untracked");
    default:
      return t("Unchanged");
  }
}
