//! Bounded, read-only Git inspection independent of the Pi runtime.
use crate::process_command::{new_command, working_directory};
use serde::Serialize;
use std::path::Path;
use std::process::Command;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};

const MAX_OUTPUT: u64 = 2 * 1024 * 1024;
const MAX_FILES: usize = 200;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repository: bool,
    pub unborn: bool,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u64,
    pub behind: u64,
    pub staged: usize,
    pub unstaged: usize,
    pub untracked: usize,
    pub conflicts: usize,
    pub total_files: usize,
    pub truncated: bool,
    pub files: Vec<GitFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    pub path: String,
    pub original_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub stageable: bool,
    pub unstageable: bool,
}

pub(super) fn stageable_path(path: &str) -> bool {
    if path.is_empty()
        || path.len() > 2048
        || path.chars().any(char::is_control)
        || path.ends_with('/')
        || Path::new(path).is_absolute()
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return false;
    }
    #[cfg(windows)]
    if path.contains(['\\', ':']) {
        return false;
    }
    true
}

async fn read_bounded(reader: impl AsyncRead + Unpin) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_OUTPUT + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| "git_read_failed".to_string())?;
    if bytes.len() as u64 > MAX_OUTPUT {
        return Err("git_output_too_large".into());
    }
    Ok(bytes)
}

pub(super) async fn run_git(
    root: &Path,
    args: &[&str],
) -> Result<(bool, Vec<u8>, Vec<u8>), String> {
    let mut command = new_command("git");
    clear_inherited_git_env(&mut command);
    command
        .current_dir(working_directory(root))
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_NO_LAZY_FETCH", "1")
        .env("LC_ALL", "C")
        .env("LANGUAGE", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = tokio::process::Command::from(command)
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "git_unavailable".to_string())?;
    let stdout = child.stdout.take().ok_or("git_read_failed")?;
    let stderr = child.stderr.take().ok_or("git_read_failed")?;
    let result = tokio::time::timeout(Duration::from_secs(5), async {
        let (stdout, stderr, status) =
            tokio::try_join!(read_bounded(stdout), read_bounded(stderr), async {
                child
                    .wait()
                    .await
                    .map_err(|_| "git_read_failed".to_string())
            },)?;
        Ok((status.success(), stdout, stderr))
    })
    .await
    .unwrap_or_else(|_| Err("git_timeout".into()));
    if result.is_err() {
        let _ = child.kill().await;
    }
    result
}

pub(super) fn clear_inherited_git_env(command: &mut Command) {
    // An inherited GIT_DIR/INDEX_FILE must never redirect inspection to another project.
    for (name, _) in std::env::vars_os() {
        if name
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("GIT_")
        {
            command.env_remove(name);
        }
    }
}

pub async fn inspect(root: &Path) -> Result<GitStatus, String> {
    let (success, output, error) = run_git(root, &["rev-parse", "--is-inside-work-tree"]).await?;
    if !success {
        if String::from_utf8_lossy(&error).starts_with("fatal: not a git repository") {
            return Ok(GitStatus::default());
        }
        return Err("git_read_failed".into());
    }
    if output != b"true\n" && output != b"true\r\n" {
        return Ok(GitStatus::default());
    }
    let (success, output, _) = run_git(
        root,
        &[
            "-c",
            "core.fsmonitor=false",
            "-c",
            "status.relativePaths=true",
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=normal",
            "--ignore-submodules=all",
            "--",
            ".",
        ],
    )
    .await?;
    if !success {
        return Err("git_read_failed".into());
    }
    parse(&output)
}

fn parse(output: &[u8]) -> Result<GitStatus, String> {
    let mut result = GitStatus {
        is_repository: true,
        ..Default::default()
    };
    let mut records = output
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty());
    while let Some(bytes) = records.next() {
        let valid_utf8 = std::str::from_utf8(bytes).is_ok();
        let record = String::from_utf8_lossy(bytes);
        if record == "# branch.oid (initial)" {
            result.unborn = true;
        } else if let Some(branch) = record.strip_prefix("# branch.head ") {
            result.branch = Some(branch.to_owned());
        } else if let Some(upstream) = record.strip_prefix("# branch.upstream ") {
            result.upstream = Some(upstream.to_owned());
        } else if let Some(counts) = record.strip_prefix("# branch.ab ") {
            let (ahead, behind) = counts.split_once(' ').ok_or("git_read_failed")?;
            result.ahead = ahead
                .trim_start_matches('+')
                .parse()
                .map_err(|_| "git_read_failed")?;
            result.behind = behind
                .trim_start_matches('-')
                .parse()
                .map_err(|_| "git_read_failed")?;
        } else if record.starts_with('#') {
            continue;
        } else {
            let (path, xy, original_path, original_utf8) =
                if let Some(path) = record.strip_prefix("? ") {
                    result.untracked += 1;
                    (path, "??", None, true)
                } else {
                    let count = match record.as_bytes()[0] {
                        b'1' => 9,
                        b'2' => 10,
                        b'u' => 11,
                        _ => return Err("git_read_failed".into()),
                    };
                    let fields: Vec<_> = record.splitn(count, ' ').collect();
                    if fields.len() != count || fields[1].len() != 2 || !fields[1].is_ascii() {
                        return Err("git_read_failed".into());
                    }
                    if record.starts_with('u') {
                        result.conflicts += 1;
                    } else {
                        if fields[1].as_bytes()[0] != b'.' {
                            result.staged += 1;
                        }
                        if fields[1].as_bytes()[1] != b'.' {
                            result.unstaged += 1;
                        }
                    }
                    let (original, original_utf8) = if record.starts_with('2') {
                        let bytes = records.next().ok_or("git_read_failed")?;
                        (
                            Some(String::from_utf8_lossy(bytes).into_owned()),
                            std::str::from_utf8(bytes).is_ok(),
                        )
                    } else {
                        (None, true)
                    };
                    (fields[count - 1], fields[1], original, original_utf8)
                };
            result.total_files += 1;
            if result.files.len() < MAX_FILES {
                let safe_path = valid_utf8
                    && original_utf8
                    && stageable_path(path)
                    && original_path.as_deref().is_none_or(stageable_path);
                let stageable = safe_path && xy.as_bytes()[1] != b'.';
                let unstageable = safe_path
                    && matches!(xy.as_bytes()[0], b'M' | b'A' | b'D' | b'R' | b'C' | b'T');
                result.files.push(GitFile {
                    path: path.to_owned(),
                    original_path,
                    index_status: xy[..1].to_owned(),
                    worktree_status: xy[1..].to_owned(),
                    stageable,
                    unstageable,
                });
            }
        }
    }
    result.truncated = result.total_files > result.files.len();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_rename_conflict_and_unusual_paths() {
        let status = parse(concat!(
            "# branch.oid (initial)\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -3\0",
            "1 .M N... 100644 100644 100644 abc def src/space name.txt\0",
            "2 RM N... 100644 100644 100644 abc def R100 new\nname.txt\0old name.txt\0",
            "u UU N... 100644 100644 100644 100644 a b c conflict.txt\0",
            "? 中文.txt\0",
        ).as_bytes()).unwrap();
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.upstream.as_deref(), Some("origin/main"));
        assert_eq!((status.ahead, status.behind), (2, 3));
        assert_eq!(
            (
                status.staged,
                status.unstaged,
                status.conflicts,
                status.untracked
            ),
            (1, 2, 1, 1)
        );
        assert_eq!(status.total_files, 4);
        assert_eq!(status.files[1].path, "new\nname.txt");
        assert_eq!(
            status.files[1].original_path.as_deref(),
            Some("old name.txt")
        );
        assert_eq!(status.files[3].path, "中文.txt");
    }

    #[test]
    fn bounds_display_without_losing_counts_and_rejects_incomplete_records() {
        let output = (0..205)
            .map(|i| format!("? file-{i}\0"))
            .collect::<String>();
        let status = parse(output.as_bytes()).unwrap();
        assert_eq!(status.files.len(), 200);
        assert_eq!(status.total_files, 205);
        assert_eq!(status.untracked, 205);
        assert!(status.truncated);
        assert!(parse(b"2 R. N... 1 1 1 a b R100 new\0").is_err());
        assert!(parse(b"1 bad\0").is_err());
    }

    #[tokio::test]
    async fn rejects_oversized_output() {
        let bytes = vec![b'x'; MAX_OUTPUT as usize + 1];
        assert_eq!(
            read_bounded(bytes.as_slice()).await.unwrap_err(),
            "git_output_too_large"
        );
    }

    struct Fixture(std::path::PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn serves_registered_workspace_status_through_the_real_websocket() {
        use crate::host_server::HostServer;
        use crate::metadata_store::MetadataStore;
        use crate::native_pi_manager::NativePiManager;
        use crate::remote_auth::RemoteAuth;
        use futures_util::{SinkExt, StreamExt};
        use serde_json::{json, Value};
        use std::sync::{Arc, Mutex};
        use tokio_tungstenite::tungstenite::Message;

        let fixture =
            Fixture(std::env::temp_dir().join(format!("zicode-git-host-{}", uuid::Uuid::new_v4())));
        let public = fixture.0.join("public");
        let repo = fixture.0.join("repo");
        std::fs::create_dir_all(&public).unwrap();
        std::fs::create_dir_all(&repo).unwrap();
        assert!(run_git(&repo, &["init", "-b", "main"]).await.unwrap().0);
        std::fs::write(repo.join("status.txt"), "fixture").unwrap();
        let metadata = MetadataStore::open(&fixture.0.join("metadata.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let host = HostServer::start_with_workspaces(
            public,
            NativePiManager::new(8),
            auth,
            std::collections::HashMap::from([("registered".into(), repo)]),
        )
        .await
        .unwrap();
        let url = host.origin().replace("http://", "ws://") + "/v2/ws";
        let (mut socket, _) = tokio_tungstenite::connect_async(url).await.unwrap();
        socket
            .send(Message::Text(
                json!({"type":"hello", "protocolVersion":2,
            "clientType":"desktop", "desktopToken":host.desktop_token(), "clientId":"git-inspection-test"})
                .to_string(),
            ))
            .await
            .unwrap();
        socket.next().await.unwrap().unwrap();
        for (id, workspace, operation, mode, expected_error) in [
            (
                "valid",
                Some("registered"),
                "workspace_git_status",
                None,
                None,
            ),
            (
                "unknown",
                Some("missing"),
                "workspace_git_status",
                None,
                Some("workspace_not_found"),
            ),
            (
                "absent",
                None,
                "workspace_git_status",
                None,
                Some("invalid_workspace"),
            ),
            (
                "diff",
                Some("registered"),
                "workspace_git_diff",
                Some("unstaged"),
                None,
            ),
            (
                "diff-unknown",
                Some("missing"),
                "workspace_git_diff",
                Some("staged"),
                Some("workspace_not_found"),
            ),
            (
                "diff-mode",
                Some("registered"),
                "workspace_git_diff",
                Some("--output=unsafe"),
                Some("git_diff_failed"),
            ),
            (
                "diff-no-mode",
                Some("registered"),
                "workspace_git_diff",
                None,
                Some("git_invalid_diff_mode"),
            ),
        ] {
            socket
                .send(Message::Text(
                    json!({"type":"data_request", "requestId":id,
                "operation":operation, "workspaceId":workspace, "mode":mode,
                "path": fixture.0, "command":"ignored"})
                    .to_string(),
                ))
                .await
                .unwrap();
            let response = tokio::time::timeout(Duration::from_secs(10), async {
                loop {
                    let frame = socket.next().await.unwrap().unwrap();
                    if let Message::Text(text) = frame {
                        let value: Value = serde_json::from_str(&text).unwrap();
                        if value["requestId"] == id {
                            break value;
                        }
                    }
                }
            })
            .await
            .unwrap();
            if let Some(code) = expected_error {
                assert_eq!(response["error"]["code"], code);
            } else if operation == "workspace_git_diff" {
                assert_eq!(response["operation"], "workspace_git_diff");
                assert_eq!(response["diff"]["mode"], "unstaged");
                assert_eq!(response["diff"]["patch"], "");
            } else {
                assert_eq!(response["operation"], "workspace_git_status");
                assert_eq!(response["status"]["branch"], "main");
                assert_eq!(response["status"]["untracked"], 1);
                assert_eq!(response["status"]["files"][0]["path"], "status.txt");
            }
        }
        socket.close(None).await.unwrap();
        host.stop_and_wait().await.unwrap();
    }

    #[tokio::test]
    async fn inspects_real_git_without_modifying_index_and_scopes_nested_projects() {
        let fixture =
            Fixture(std::env::temp_dir().join(format!("zicode-git-{}", uuid::Uuid::new_v4())));
        std::fs::create_dir_all(&fixture.0).unwrap();
        let root = fixture.0.as_path();
        assert!(!inspect(root).await.unwrap().is_repository);
        assert!(run_git(root, &["init", "-b", "main"]).await.unwrap().0);
        let initial = inspect(root).await.unwrap();
        assert!(initial.is_repository);
        assert_eq!(initial.branch.as_deref(), Some("main"));
        assert_eq!(initial.total_files, 0);
        std::fs::create_dir(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/tracked.txt"), "initial\n").unwrap();
        std::fs::write(root.join("outside.txt"), "outside\n").unwrap();
        assert!(run_git(root, &["add", "."]).await.unwrap().0);
        assert!(
            run_git(
                root,
                &[
                    "-c",
                    "user.name=Fixture",
                    "-c",
                    "user.email=fixture@example.invalid",
                    "-c",
                    "commit.gpgsign=false",
                    "-c",
                    "core.hooksPath=/dev/null",
                    "commit",
                    "-m",
                    "fixture"
                ]
            )
            .await
            .unwrap()
            .0
        );
        assert!(
            run_git(root, &["mv", "sub/tracked.txt", "sub/renamed file.txt"])
                .await
                .unwrap()
                .0
        );
        std::fs::write(root.join("sub/renamed file.txt"), "modified\n").unwrap();
        std::fs::write(root.join("outside.txt"), "changed outside\n").unwrap();
        std::fs::write(root.join("sub/中文.txt"), "new\n").unwrap();
        let index = std::fs::read(root.join(".git/index")).unwrap();
        let status = inspect(&root.join("sub")).await.unwrap();
        assert_eq!(
            (status.staged, status.unstaged, status.untracked),
            (1, 1, 1)
        );
        assert_eq!(status.total_files, 2);
        assert!(status
            .files
            .iter()
            .all(|file| !file.path.contains("outside")));
        assert_eq!(std::fs::read(root.join(".git/index")).unwrap(), index);
        assert!(run_git(root, &["checkout", "--detach"]).await.unwrap().0);
        assert_eq!(
            inspect(root).await.unwrap().branch.as_deref(),
            Some("(detached)")
        );
    }
}
