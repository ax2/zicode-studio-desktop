import { t } from "../../shared/i18n";

export interface CommitDiff {
  oid: string;
  parent: string | null;
  parentCount: number;
  patch: string;
  truncated: boolean;
}
export type ReadCommitDiff = (workspace: string, oid: string) => Promise<CommitDiff>;

export function parseCommitDiff(value: unknown, oid: string): CommitDiff {
  const diff = value as CommitDiff | undefined;
  const validOid = (value: unknown) =>
    typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value);
  if (
    !validOid(oid) ||
    !diff ||
    diff.oid !== oid ||
    !Number.isInteger(diff.parentCount) ||
    diff.parentCount < 0 ||
    diff.parentCount > 1024 ||
    (diff.parentCount === 0 ? diff.parent !== null : !validOid(diff.parent)) ||
    typeof diff.patch !== "string" ||
    diff.patch.length > 262144 ||
    typeof diff.truncated !== "boolean"
  ) {
    throw new Error("git_commit_diff_invalid");
  }
  return diff;
}

export function commitDiffError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "git_output_too_large")
    return t("This diff exceeds the preview limit. Use your Git client to review it.");
  if (code === "git_timeout") return t("Git inspection timed out. Try refreshing this project.");
  if (code === "git_commit_unavailable")
    return t(
      "The commit or its parent could not be read. A shallow or partial clone may lack the required objects. Check your Git client before retrying.",
    );
  return t(
    "Could not read this commit diff. Update or reconnect the host, check repository access, and retry.",
  );
}
