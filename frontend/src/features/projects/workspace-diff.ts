import type { GitDiff, GitDiffMode } from "./git-status";

export function parseWorkspaceDiff(value: unknown, mode: GitDiffMode): GitDiff {
  const diff = value as GitDiff | undefined;
  if (
    !["staged", "unstaged"].includes(mode) ||
    !diff ||
    diff.mode !== mode ||
    typeof diff.patch !== "string" ||
    diff.patch.length > 262144 ||
    typeof diff.truncated !== "boolean"
  ) {
    throw new Error("git_diff_invalid");
  }
  return diff;
}
