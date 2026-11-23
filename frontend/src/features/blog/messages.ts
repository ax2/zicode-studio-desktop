const messages: Record<string, string> = {
  blog_file_changed: "The article changed on disk. Reopen it before saving.",
  blog_file_too_large: "This file exceeds the editor size limit.",
  blog_git_dirty: "Save or commit local changes before pulling.",
  blog_git_index_busy: "Finish the staged changes in Git first.",
  blog_git_diverged: "The branches diverged. Resolve the conflict in Git.",
  blog_git_push_pending: "Committed locally. Retry the push when GitHub is available.",
  blog_git_retry_pending: "Push the pending blog commit first.",
  blog_git_unpublished: "There are other unpublished commits. Review them in Git.",
  blog_git_remote: "Choose a repository with a GitHub origin.",
  blog_git_branch: "Check out a local branch before syncing.",
  blog_git_refresh: "Refresh the blog directory and select changes again.",
  blog_git_no_selection: "Select at least one changed article.",
  blog_git_failed: "Git sync failed. Check the repository and GitHub credentials.",
  blog_git_commit_failed: "Git could not create the commit. Check the author settings.",
  blog_git_timeout: "The Git operation timed out.",
  blog_git_unavailable: "Git is unavailable for this site.",
  blog_invalid_site: "Choose an Astro site with a src/content/blog directory.",
  blog_site_changed: "The selected site changed. Open the folder again.",
  blog_invalid_path: "Choose a Markdown file in the blog collection.",
  blog_read_failed: "The article could not be read.",
  blog_write_failed: "The file could not be saved. Check its permissions.",
  blog_busy: "Another blog operation is running.",
  blog_select_site: "Choose a blog folder first.",
  blog_selection_unavailable: "The blog folder setting is unavailable.",
};
export function messageForError(error: unknown) {
  const code = error instanceof Error ? error.message : String(error);
  return messages[code] ?? code;
}
