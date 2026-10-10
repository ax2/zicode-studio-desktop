import { t } from "../../shared/i18n";

export interface GitCommit {
  oid: string;
  author: string;
  authoredAt: string;
  message: string;
  truncated: boolean;
}
export interface GitHistory {
  head: string | null;
  commits: GitCommit[];
  hasMore: boolean;
  nextCursor?: GitHistoryCursor | null;
}
export interface GitHistoryCursor {
  head: string;
  offset: number;
}
export type ReadGitHistory = (workspace: string, cursor?: GitHistoryCursor) => Promise<GitHistory>;

export function parseGitHistory(value: unknown, cursor?: GitHistoryCursor): GitHistory {
  const result = value as GitHistory | undefined;
  const oid = (value: unknown) =>
    typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value);
  if (
    !result ||
    (result.head !== null && !oid(result.head)) ||
    typeof result.hasMore !== "boolean" ||
    !Array.isArray(result.commits) ||
    result.commits.length > 50 ||
    (result.head === null && (result.commits.length > 0 || result.hasMore))
  ) {
    throw new Error("git_history_invalid");
  }
  const seen = new Set<string>();
  if (
    result.nextCursor !== undefined &&
    result.nextCursor !== null &&
    (!result.hasMore ||
      result.nextCursor.head !== result.head ||
      !oid(result.nextCursor.head) ||
      !Number.isSafeInteger(result.nextCursor.offset) ||
      result.nextCursor.offset <= 0 ||
      result.nextCursor.offset > 4294967295 ||
      result.nextCursor.offset % 50 !== 0 ||
      result.commits.length !== 50)
  )
    throw new Error("git_history_invalid");
  for (const commit of result.commits) {
    if (
      !commit ||
      !oid(commit.oid) ||
      seen.has(commit.oid) ||
      typeof commit.author !== "string" ||
      commit.author.length > 400 ||
      typeof commit.message !== "string" ||
      commit.message.length > 32768 ||
      typeof commit.authoredAt !== "string" ||
      !Number.isFinite(Date.parse(commit.authoredAt)) ||
      typeof commit.truncated !== "boolean"
    )
      throw new Error("git_history_invalid");
    seen.add(commit.oid);
  }
  if (cursor && result.head !== cursor.head) throw new Error("git_history_invalid");
  if (result.nextCursor && result.nextCursor.offset !== (cursor?.offset ?? 0) + 50)
    throw new Error("git_history_invalid");
  return result;
}

export function gitHistoryError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "git_history_invalid_cursor")
    return t("This history page is unavailable. Refresh commit history to start again.");
  if (code === "git_unavailable")
    return t("Git is unavailable. Check the Git installation and refresh.");
  if (code === "git_timeout") return t("Git inspection timed out. Try refreshing this project.");
  if (code === "git_output_too_large")
    return t("Commit history exceeds the preview limit. Review it in your Git client.");
  return t(
    "Could not read commit history. Check repository access, update or reconnect the host, and retry.",
  );
}
