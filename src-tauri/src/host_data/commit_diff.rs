//! Compare an immutable commit with its actual first parent, including shallow histories.
use super::{git_status::run_git, patch_preview};
use serde::Serialize;
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDiff {
    pub oid: String,
    pub parent: Option<String>,
    pub parent_count: usize,
    pub patch: String,
    pub truncated: bool,
}

pub async fn inspect(root: &Path, oid: &str) -> Result<CommitDiff, String> {
    if !valid_oid(oid) {
        return Err("git_invalid_commit".into());
    }
    tokio::time::timeout(Duration::from_secs(12), compare(root, oid))
        .await
        .map_err(|_| "git_timeout".to_owned())?
}

fn valid_oid(oid: &str) -> bool {
    matches!(oid.len(), 40 | 64) && oid.bytes().all(|byte| byte.is_ascii_hexdigit())
}

async fn compare(root: &Path, oid: &str) -> Result<CommitDiff, String> {
    // Raw object headers retain parents at shallow boundaries; revision walks may hide them.
    let (success, raw, _) = run_git(root, &["cat-file", "commit", oid]).await?;
    if !success {
        return Err("git_commit_unavailable".into());
    }
    let parents = read_parents(&raw)?;
    let mut args = vec!["--literal-pathspecs", "-c", "core.fsmonitor=false"];
    if parents.is_empty() {
        args.extend(["diff-tree", "--root", "--no-commit-id", "-r", "-p"]);
    } else {
        args.push("diff");
    }
    args.extend([
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--no-relative",
        "--ignore-submodules=all",
        "--no-renames",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--submodule=short",
        "--no-stat",
        "--no-exit-code",
    ]);
    if let Some(parent) = parents.first() {
        args.push(parent);
    }
    args.extend([oid, "--", "."]);
    let (success, output, _) = run_git(root, &args).await?;
    if !success {
        return Err("git_commit_unavailable".into());
    }
    let (patch, truncated) = patch_preview::limit(&String::from_utf8_lossy(&output));
    Ok(CommitDiff {
        oid: oid.to_owned(),
        parent: parents.first().cloned(),
        parent_count: parents.len(),
        patch,
        truncated,
    })
}

fn read_parents(raw: &[u8]) -> Result<Vec<String>, String> {
    let end = raw
        .windows(2)
        .position(|pair| pair == b"\n\n")
        .ok_or("git_read_failed")?;
    let mut lines = raw[..end].split(|byte| *byte == b'\n');
    let tree = lines
        .next()
        .and_then(|line| line.strip_prefix(b"tree "))
        .ok_or("git_read_failed")?;
    if !std::str::from_utf8(tree).is_ok_and(valid_oid) {
        return Err("git_read_failed".into());
    }
    let mut parents = vec![];
    for line in lines {
        if let Some(parent) = line.strip_prefix(b"parent ") {
            let parent = std::str::from_utf8(parent).map_err(|_| "git_read_failed")?;
            if !valid_oid(parent) || parents.len() >= 1024 {
                return Err("git_read_failed".into());
            }
            parents.push(parent.to_owned());
        }
    }
    Ok(parents)
}
