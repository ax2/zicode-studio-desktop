use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::time::{Duration, Instant};

pub(super) struct Fixture(pub(super) PathBuf);
impl Fixture {
    pub(super) fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("zicode-terminal-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        Self(root.canonicalize().unwrap())
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self
            .0
            .starts_with(std::env::temp_dir().canonicalize().unwrap()));
        for _ in 0..60 {
            if std::fs::remove_dir_all(&self.0).is_ok() {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        assert!(std::thread::panicking(), "terminal fixture remained locked");
    }
}
fn line(windows: &str, unix: &str) -> Vec<u8> {
    if cfg!(windows) {
        format!("{windows}\r").into_bytes()
    } else {
        format!("{unix}\n").into_bytes()
    }
}
async fn output(manager: &TerminalManager, root: &Path, id: &str, wanted: &str) {
    output_after(manager, root, id, wanted, 0).await;
}
async fn output_after(
    manager: &TerminalManager,
    root: &Path,
    id: &str,
    wanted: &str,
    mut offset: u64,
) {
    let deadline = Instant::now() + Duration::from_secs(12);
    let mut text = String::new();
    loop {
        let (_, chunk) = manager.read(root, "project", id, offset).unwrap();
        offset = chunk.next_offset;
        let bytes = STANDARD.decode(chunk.data).unwrap();
        let new = String::from_utf8_lossy(&bytes);
        if new.contains("\x1b[6n") {
            let _ = manager.input(root, "project", id, b"\x1b[1;1R".to_vec());
        }
        text.push_str(&new);
        if text.contains(wanted) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "terminal did not produce fixture marker {wanted}; status={}; fixture output={:?}",
            manager.list(root, "project").unwrap()[0].status,
            text.chars()
                .rev()
                .take(2500)
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>()
        );
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
}
async fn shutdown(manager: &TerminalManager) {
    manager.stop_all();
    tokio::time::timeout(Duration::from_secs(8), manager.completion_tracker().wait())
        .await
        .expect("terminal workers must drain");
}

#[tokio::test]
async fn real_pty_accepts_input_resizes_preserves_output_and_exits() {
    let fixture = Fixture::new();
    let manager = TerminalManager::default();
    let info = manager.open(&fixture.0, "project", 80, 24).unwrap();
    manager.input(&fixture.0, "project", &info.id, line("Write-Output ('PTY-' + 'READY'); Set-Content -LiteralPath 'cwd-marker' -Value 'ok'", "printf 'PTY-'; printf 'READY\\n'; printf ok > cwd-marker")).unwrap();
    output(&manager, &fixture.0, &info.id, "PTY-READY").await;
    let deadline = Instant::now() + Duration::from_secs(3);
    while !fixture.0.join("cwd-marker").exists() {
        assert!(Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    manager
        .resize(&fixture.0, "project", &info.id, 101, 31)
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let info = manager.list(&fixture.0, "project").unwrap().remove(0);
        if info.cols == 101 && info.rows == 31 {
            break;
        }
        assert!(Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    // A fresh cursor replays output; reading does not consume it globally.
    output(&manager, &fixture.0, &info.id, "PTY-READY").await;
    manager
        .input(
            &fixture.0,
            "project",
            &info.id,
            line(
                "& { Write-Output ('BEFORE-' + 'SLEEP'); Start-Sleep -Seconds 30 }",
                "/bin/sh -c 'printf BEFORE-; printf \"SLEEP\\n\"; sleep 30'",
            ),
        )
        .unwrap();
    output(&manager, &fixture.0, &info.id, "BEFORE-SLEEP").await;
    // Printing the marker precedes entering Start-Sleep. Exercise interruption
    // of the waiting command, not the shell's transition between pipeline stages.
    tokio::time::sleep(Duration::from_secs(1)).await;
    let interrupt_offset = manager
        .read(&fixture.0, "project", &info.id, 0)
        .unwrap()
        .0
        .output_end;
    manager
        .input(&fixture.0, "project", &info.id, vec![3])
        .unwrap();
    if cfg!(windows) {
        output_after(&manager, &fixture.0, &info.id, "PS ", interrupt_offset).await;
    }
    manager
        .input(
            &fixture.0,
            "project",
            &info.id,
            line(
                "Write-Output ('AFTER-' + 'BREAK')",
                "printf 'AFTER-'; printf 'BREAK\\n'",
            ),
        )
        .unwrap();
    output(&manager, &fixture.0, &info.id, "AFTER-BREAK").await;
    manager
        .input(&fixture.0, "project", &info.id, line("exit 7", "exit 7"))
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        let info = manager.list(&fixture.0, "project").unwrap().remove(0);
        if info.output_closed && info.status == "exited" {
            assert_eq!(info.exit_code, Some(7));
            break;
        }
        assert!(Instant::now() < deadline, "shell did not exit");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    shutdown(&manager).await;
    assert!(manager.open(&fixture.0, "project", 80, 24).is_err());
}

#[tokio::test]
async fn validates_scopes_limits_sizes_and_closes_sessions() {
    let fixture = Fixture::new();
    let other = Fixture::new();
    let manager = TerminalManager::default();
    assert!(manager.open(&fixture.0, "project", 0, 24).is_err());
    let info = manager.open(&fixture.0, "project", 80, 24).unwrap();
    let _second = manager.open(&fixture.0, "project", 80, 24).unwrap();
    assert_eq!(
        manager.open(&fixture.0, "project", 80, 24).unwrap_err(),
        "terminal_limit_reached"
    );
    assert!(manager.read(&other.0, "project", &info.id, 0).is_err());
    assert!(manager
        .input(&fixture.0, "wrong", &info.id, vec![13])
        .is_err());
    assert!(manager
        .input(&fixture.0, "project", &info.id, vec![0; 4097])
        .is_err());
    assert!(manager
        .resize(&fixture.0, "project", &info.id, 501, 24)
        .is_err());
    assert!(manager.close(&other.0, "project", &info.id).is_err());
    manager.close(&fixture.0, "project", &info.id).unwrap();
    assert!(manager
        .input(&fixture.0, "project", &info.id, vec![13])
        .is_err());
    shutdown(&manager).await;
    assert!(manager
        .list(&fixture.0, "project")
        .unwrap()
        .iter()
        .all(|info| info.output_closed && info.status == "closed"));
}

#[test]
fn remote_clients_cannot_access_any_terminal_operation() {
    use crate::host_router::HostRouter;
    use serde_json::json;
    let mut router = HostRouter::new();
    router.connect("phone", &json!({"type":"hello", "protocolVersion":2, "clientType":"remote", "clientId":"phone"})).unwrap();
    for operation in [
        "terminal_open",
        "terminal_list",
        "terminal_read",
        "terminal_input",
        "terminal_resize",
        "terminal_close",
    ] {
        let result = router.route("phone", &json!({"type":"host_request", "requestId":"test", "operation":operation, "workspaceId":"project"}));
        assert_eq!(result.unwrap_err().code, "remote_operation_forbidden");
    }
}

#[tokio::test]
async fn stopping_terminal_kills_its_foreground_descendant() {
    let fixture = Fixture::new();
    let bun = crate::project_tasks::catalog::executable(&fixture.0, "bun").unwrap();
    std::fs::write(fixture.0.join("child.cjs"), "require('node:fs').writeFileSync('child.pid',String(process.pid)); console.log('DESCENDANT-'+ 'READY'); setInterval(()=>{},1000);").unwrap();
    let manager = TerminalManager::default();
    let info = manager.open(&fixture.0, "project", 80, 24).unwrap();
    let escaped = bun.to_string_lossy().replace('\'', "''");
    let windows = format!("& '{escaped}' child.cjs");
    let unix = format!(
        "'{}' child.cjs",
        bun.to_string_lossy().replace('\'', "'\\''")
    );
    manager
        .input(&fixture.0, "project", &info.id, line(&windows, &unix))
        .unwrap();
    output(&manager, &fixture.0, &info.id, "DESCENDANT-READY").await;
    let pid: u32 = std::fs::read_to_string(fixture.0.join("child.pid"))
        .unwrap()
        .parse()
        .unwrap();
    shutdown(&manager).await;
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, WAIT_TIMEOUT},
            System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
        };
        let process = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
        if !process.is_null() {
            let result = WaitForSingleObject(process, 0);
            CloseHandle(process);
            assert_ne!(result, WAIT_TIMEOUT);
        }
    }
    #[cfg(unix)]
    {
        let deadline = Instant::now() + Duration::from_secs(3);
        while unsafe { libc::kill(pid as i32, 0) } == 0 {
            assert!(Instant::now() < deadline);
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
}
