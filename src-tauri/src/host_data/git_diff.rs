//! Project-scoped review without arbitrary Git commands or external diff drivers.
use super::git_status::run_git;
use serde::Serialize;
use std::path::Path;

#[cfg(test)]
const MAX_DISPLAY_BYTES: usize = 256 * 1024;
#[cfg(test)]
const MAX_DISPLAY_LINES: usize = 2000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    pub mode: String,
    pub patch: String,
    pub truncated: bool,
}

pub async fn inspect(root: &Path, mode: &str) -> Result<GitDiff, String> {
    if !matches!(mode, "staged" | "unstaged") {
        return Err("git_invalid_diff_mode".into());
    }
    let mut args = vec![
        "--literal-pathspecs",
        "-c",
        "core.fsmonitor=false",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--no-relative",
        "--ignore-submodules=all",
        "--src-prefix=a/",
        "--dst-prefix=b/",
    ];
    if mode == "staged" {
        args.push("--cached");
    }
    args.extend(["--", "."]);
    let (success, output, _) = run_git(root, &args).await?;
    if !success {
        return Err("git_read_failed".into());
    }
    Ok(limit_patch(mode, &String::from_utf8_lossy(&output)))
}

fn limit_patch(mode: &str, patch: &str) -> GitDiff {
    let (patch, truncated) = super::patch_preview::limit(patch);
    GitDiff {
        mode: mode.to_owned(),
        patch,
        truncated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_text_at_complete_utf8_lines() {
        let patch = "中\n".repeat(MAX_DISPLAY_LINES + 1);
        let diff = limit_patch("staged", &patch);
        assert!(diff.truncated);
        assert_eq!(diff.patch.lines().count(), MAX_DISPLAY_LINES);
        let diff = limit_patch("unstaged", &"x".repeat(MAX_DISPLAY_BYTES + 1));
        assert!(diff.truncated);
        assert!(diff.patch.is_empty());
        assert!(!limit_patch("staged", "").truncated);
    }

    #[tokio::test]
    async fn compares_index_and_worktree_and_limits_scope_without_running_diff_drivers() {
        let root = std::env::temp_dir().join(format!("zicode-diff-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("sub")).unwrap();
        assert!(run_git(&root, &["init", "-b", "main"]).await.unwrap().0);
        std::fs::write(root.join("sub/file.txt"), "staged line\n").unwrap();
        std::fs::write(root.join("outside.txt"), "outside\n").unwrap();
        assert!(run_git(&root, &["add", "."]).await.unwrap().0);
        // An unborn branch must still support staged review.
        let staged = inspect(&root.join("sub"), "staged").await.unwrap();
        assert!(staged.patch.contains("+staged line"));
        assert!(!staged.patch.contains("outside.txt"));
        assert!(inspect(&root.join("sub"), "unstaged")
            .await
            .unwrap()
            .patch
            .is_empty());
        std::fs::write(root.join("sub/file.txt"), "working line\n").unwrap();
        std::fs::write(root.join("sub/new.txt"), "untracked line\n").unwrap();
        std::fs::write(root.join(".gitattributes"), "*.txt diff=untrusted\n").unwrap();
        assert!(
            run_git(
                &root,
                &[
                    "config",
                    "diff.untrusted.command",
                    "this-command-must-not-run"
                ]
            )
            .await
            .unwrap()
            .0
        );
        assert!(
            run_git(
                &root,
                &[
                    "config",
                    "diff.untrusted.textconv",
                    "this-command-must-not-run"
                ]
            )
            .await
            .unwrap()
            .0
        );
        let index = std::fs::read(root.join(".git/index")).unwrap();
        let unstaged = inspect(&root.join("sub"), "unstaged").await.unwrap();
        assert!(unstaged.patch.contains("-staged line"));
        assert!(unstaged.patch.contains("+working line"));
        assert!(!unstaged.patch.contains("untracked line"));
        assert_eq!(std::fs::read(root.join(".git/index")).unwrap(), index);
        assert_eq!(
            inspect(&root, "--output=unsafe").await.unwrap_err(),
            "git_invalid_diff_mode"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
