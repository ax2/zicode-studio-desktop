//! Explicit staging of one freshly confirmed status entry in a registered workspace.
use super::git_status::{self, GitStatus};
use crate::process_command::{new_command, working_directory};
use crate::project_tasks::process_tree;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};

const MAX_OUTPUT: u64 = 64 * 1024;

async fn read_bounded(
    reader: impl AsyncRead + Unpin,
    failure: &'static str,
) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_OUTPUT + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| failure.to_string())?;
    if bytes.len() as u64 > MAX_OUTPUT {
        return Err(failure.into());
    }
    Ok(bytes)
}

pub(super) async fn run_index_write(
    root: &Path,
    args: &[&str],
    failure: &'static str,
    timeout: &'static str,
) -> Result<(), String> {
    let mut command = new_command("git");
    git_status::clear_inherited_git_env(&mut command);
    command
        .current_dir(working_directory(root))
        .args(["--literal-pathspecs", "-c", "core.fsmonitor=false"])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_NO_LAZY_FETCH", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    process_tree::prepare(&mut command);
    let mut child = tokio::process::Command::from(command)
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| failure)?;
    let tree = process_tree::ProcessTree::attach(&child).map_err(|_| failure)?;
    let stdout = child.stdout.take().ok_or(failure)?;
    let stderr = child.stderr.take().ok_or(failure)?;
    let result = tokio::time::timeout(Duration::from_secs(20), async {
        let (_, _, status) = tokio::try_join!(
            read_bounded(stdout, failure),
            read_bounded(stderr, failure),
            async { child.wait().await.map_err(|_| failure.to_string()) },
        )?;
        if status.success() {
            Ok(())
        } else {
            Err(failure.into())
        }
    })
    .await
    .unwrap_or_else(|_| Err(timeout.into()));
    tree.terminate();
    if result.is_err() {
        let _ = child.kill().await;
    }
    result
}

pub async fn stage(
    root: &Path,
    path: &str,
    expected_index: &str,
    expected_worktree: &str,
) -> Result<GitStatus, String> {
    if !git_status::stageable_path(path)
        || expected_index.len() != 1
        || expected_worktree.len() != 1
    {
        return Err("git_stage_invalid".into());
    }
    let before = git_status::inspect(root)
        .await
        .map_err(|_| "git_stage_status_unavailable")?;
    let file = before
        .files
        .iter()
        .find(|file| file.path == path)
        .ok_or("git_stage_stale")?;
    if !file.stageable
        || file.index_status != expected_index
        || file.worktree_status != expected_worktree
    {
        return Err("git_stage_stale".into());
    }
    let mut args = vec!["add", "-A", "--", path];
    if let Some(original) = file.original_path.as_deref() {
        args.push(original);
    }
    run_index_write(root, &args, "git_stage_failed", "git_stage_timeout").await?;
    git_status::inspect(root)
        .await
        .map_err(|_| "git_stage_result_unknown".into())
}
