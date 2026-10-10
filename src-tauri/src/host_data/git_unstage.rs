//! Remove one freshly confirmed entry from the Git index, preserving the working tree.
use super::git_stage::run_index_write;
use super::git_status::{self, GitStatus};
use std::path::Path;

pub async fn unstage(
    root: &Path,
    path: &str,
    expected_index: &str,
    expected_worktree: &str,
) -> Result<GitStatus, String> {
    if !git_status::stageable_path(path)
        || expected_index.len() != 1
        || expected_worktree.len() != 1
    {
        return Err("git_unstage_invalid".into());
    }
    let before = git_status::inspect(root)
        .await
        .map_err(|_| "git_unstage_status_unavailable")?;
    let file = before
        .files
        .iter()
        .find(|file| file.path == path)
        .ok_or("git_unstage_stale")?;
    if !file.unstageable
        || file.index_status != expected_index
        || file.worktree_status != expected_worktree
    {
        return Err("git_unstage_stale".into());
    }
    let mut args = if before.unborn {
        vec!["rm", "-f", "--cached", "--", path]
    } else {
        vec!["restore", "--staged", "--", path]
    };
    if !before.unborn && file.index_status == "R" {
        if let Some(original) = file.original_path.as_deref() {
            args.push(original);
        }
    }
    run_index_write(root, &args, "git_unstage_failed", "git_unstage_timeout").await?;
    git_status::inspect(root)
        .await
        .map_err(|_| "git_unstage_result_unknown".into())
}
