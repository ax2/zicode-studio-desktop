//! Local, bounded history for the registered project directory at a fixed HEAD.
use super::git_status::run_git;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;

const LIMIT: usize = 50;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHistory {
    pub head: Option<String>,
    pub commits: Vec<Commit>,
    pub has_more: bool,
    pub next_cursor: Option<HistoryCursor>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryCursor {
    pub head: String,
    pub offset: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub oid: String,
    pub author: String,
    pub authored_at: String,
    pub message: String,
    pub truncated: bool,
}

pub async fn inspect(root: &Path, cursor: Option<HistoryCursor>) -> Result<GitHistory, String> {
    if cursor
        .as_ref()
        .is_some_and(|cursor| !valid_oid(&cursor.head) || cursor.offset % LIMIT as u32 != 0)
    {
        return Err("git_history_invalid_cursor".into());
    }
    tokio::time::timeout(Duration::from_secs(12), inspect_head(root, cursor))
        .await
        .map_err(|_| "git_timeout".to_owned())?
}

async fn inspect_head(root: &Path, cursor: Option<HistoryCursor>) -> Result<GitHistory, String> {
    if let Some(cursor) = cursor {
        return read_page(root, &cursor.head, cursor.offset).await;
    }
    let (success, output, _) = run_git(root, &["rev-parse", "--verify", "HEAD^{commit}"]).await?;
    if !success {
        // An unborn branch has no HEAD. Other failures must not look like empty history.
        let status = run_git(
            root,
            &[
                "-c",
                "core.fsmonitor=false",
                "status",
                "--porcelain=v2",
                "--branch",
                "-z",
                "--untracked-files=no",
                "--ignore-submodules=all",
                "--",
                ".",
            ],
        )
        .await?;
        if status.0
            && status
                .1
                .split(|byte| *byte == 0)
                .any(|line| line == b"# branch.oid (initial)")
        {
            return Ok(GitHistory {
                head: None,
                commits: vec![],
                has_more: false,
                next_cursor: None,
            });
        }
        return Err("git_read_failed".into());
    }
    let head = String::from_utf8(output).map_err(|_| "git_read_failed")?;
    let head = head.trim();
    if !valid_oid(head) {
        return Err("git_read_failed".into());
    }
    read_page(root, head, 0).await
}

async fn read_page(root: &Path, head: &str, offset: u32) -> Result<GitHistory, String> {
    let skip = format!("--skip={offset}");
    let (success, output, _) = run_git(
        root,
        &[
            "--literal-pathspecs",
            "-c",
            "core.fsmonitor=false",
            "log",
            "--max-count=51",
            &skip,
            "--no-patch",
            "--no-notes",
            "--no-decorate",
            "--no-show-signature",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--encoding=UTF-8",
            "-z",
            "--format=tformat:%H%x00%an%x00%aI%x00%B",
            head,
            "--",
            ".",
        ],
    )
    .await?;
    if !success {
        return Err("git_read_failed".into());
    }
    parse(head, &output, offset)
}

fn valid_oid(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn limited(value: &[u8], limit: usize) -> (String, bool) {
    let text = String::from_utf8_lossy(value);
    (
        text.chars().take(limit).collect(),
        text.chars().count() > limit,
    )
}

fn parse(head: &str, output: &[u8], offset: u32) -> Result<GitHistory, String> {
    let mut commits = vec![];
    if !output.is_empty() {
        let body = output.strip_suffix(&[0]).ok_or("git_read_failed")?;
        let fields: Vec<_> = body.split(|byte| *byte == 0).collect();
        if fields.len() % 4 != 0 || fields.len() > (LIMIT + 1) * 4 {
            return Err("git_read_failed".into());
        }
        for fields in fields.chunks_exact(4) {
            let oid = std::str::from_utf8(fields[0]).map_err(|_| "git_read_failed")?;
            let authored_at = std::str::from_utf8(fields[2]).map_err(|_| "git_read_failed")?;
            if !valid_oid(oid) || chrono::DateTime::parse_from_rfc3339(authored_at).is_err() {
                return Err("git_read_failed".into());
            }
            let (author, author_truncated) = limited(fields[1], 200);
            let (message, message_truncated) = limited(fields[3], 16_384);
            commits.push(Commit {
                oid: oid.into(),
                author,
                authored_at: authored_at.into(),
                message,
                truncated: author_truncated || message_truncated,
            });
        }
    }
    let has_more = commits.len() > LIMIT;
    commits.truncate(LIMIT);
    Ok(GitHistory {
        head: Some(head.into()),
        commits,
        has_more,
        next_cursor: if has_more {
            Some(HistoryCursor {
                head: head.into(),
                offset: offset
                    .checked_add(LIMIT as u32)
                    .ok_or("git_history_invalid_cursor")?,
            })
        } else {
            None
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::process::Stdio;

    #[tokio::test]
    async fn pages_keep_the_captured_head_and_project_scope() {
        let root = std::env::temp_dir().join(format!("zicode-history-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        assert!(run_git(&root, &["init", "-b", "main"]).await.unwrap().0);
        let mut import = String::new();
        for index in 0..56 {
            let content = format!("version {index}\n");
            let message = format!("change {index}");
            import.push_str(&format!("blob\nmark :{}\ndata {}\n{}\ncommit refs/heads/main\ncommitter QA <qa@example.invalid> {} +0000\ndata {}\n{}\nM 100644 :{} src/file.txt\n\n", index * 2 + 1, content.len(), content, 1_700_000_000 + index, message.len(), message, index * 2 + 1));
        }
        let mut command = crate::process_command::new_command("git");
        super::super::git_status::clear_inherited_git_env(&mut command);
        command
            .current_dir(crate::process_command::working_directory(&root))
            .args(["fast-import", "--quiet"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = command.spawn().unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(import.as_bytes())
            .unwrap();
        assert!(child.wait().unwrap().success());
        let folder = root.join("src");
        std::fs::create_dir_all(&folder).unwrap();
        let first = inspect(&folder, None).await.unwrap();
        assert_eq!(first.commits.len(), 50);
        assert_eq!(first.commits[0].message.trim(), "change 55");
        let cursor = first.next_cursor.clone().unwrap();
        assert_eq!(cursor.offset, 50);
        assert!(run_git(&root, &["read-tree", "HEAD"]).await.unwrap().0);
        assert!(
            run_git(
                &root,
                &[
                    "-c",
                    "user.name=QA",
                    "-c",
                    "user.email=qa@example.invalid",
                    "-c",
                    "commit.gpgsign=false",
                    "-c",
                    "core.hooksPath=disabled-hooks",
                    "commit",
                    "--allow-empty",
                    "-m",
                    "outside project"
                ]
            )
            .await
            .unwrap()
            .0
        );
        let second = inspect(&folder, Some(cursor)).await.unwrap();
        assert_eq!(second.head, first.head);
        assert_eq!(second.commits.len(), 6);
        assert_eq!(second.commits[0].message.trim(), "change 5");
        assert!(!second.has_more);
        assert!(second.next_cursor.is_none());
        let anchored = inspect(
            &folder,
            Some(HistoryCursor {
                head: first.head.clone().unwrap(),
                offset: 0,
            }),
        )
        .await
        .unwrap();
        assert_eq!(anchored.commits[0].oid, first.commits[0].oid);
        let refreshed = inspect(&folder, None).await.unwrap();
        assert_ne!(refreshed.head, first.head);
        assert_eq!(refreshed.commits[0].oid, first.commits[0].oid);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn rejects_invalid_cursor_before_spawning_git() {
        for cursor in [
            HistoryCursor {
                head: "--all".into(),
                offset: 50,
            },
            HistoryCursor {
                head: "a".repeat(40),
                offset: 1,
            },
        ] {
            assert_eq!(
                inspect(Path::new("does-not-exist"), Some(cursor))
                    .await
                    .unwrap_err(),
                "git_history_invalid_cursor"
            );
        }
        assert!(serde_json::from_value::<HistoryCursor>(
            serde_json::json!({ "head": "a".repeat(40), "offset": 50, "extra": true })
        )
        .is_err());
    }
}
