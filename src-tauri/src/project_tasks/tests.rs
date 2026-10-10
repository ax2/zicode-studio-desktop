use super::{catalog, Run, TaskRunner, OUTPUT_LIMIT};
use serde_json::json;
use std::path::PathBuf;
use std::time::Duration;

pub(super) struct Fixture(pub(super) PathBuf);

impl Fixture {
    pub(super) fn new() -> Self {
        let root = std::env::temp_dir().join(format!("zicode-task-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        Self(root.canonicalize().unwrap())
    }

    pub(super) fn scripts(&self, scripts: serde_json::Value) {
        std::fs::write(
            self.0.join("package.json"),
            json!({"packageManager":"bun@1.3.14", "scripts":scripts}).to_string(),
        )
        .unwrap();
    }

    pub(super) fn runnable() -> Self {
        let fixture = Self::new();
        let bun = catalog::executable(&fixture.0, "bun")
            .expect("task lifecycle tests require Bun (the repository package manager)");
        let bun = bun.to_string_lossy().replace('\\', "/");
        fixture.scripts(json!({
            "ok": format!("\"{bun}\" task.cjs ok"),
            "fail": format!("\"{bun}\" task.cjs fail"),
            "flood": format!("\"{bun}\" task.cjs flood"),
            "watch": format!("\"{bun}\" task.cjs watch"),
            "orphan": format!("\"{bun}\" task.cjs orphan"),
        }));
        std::fs::write(
            fixture.0.join("task.cjs"),
            r#"
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const mode = process.argv[2];
if (mode === 'child') {
  fs.writeFileSync('child.pid', String(process.pid));
  setInterval(() => fs.writeFileSync('heartbeat', String(Date.now())), 30);
  setTimeout(() => process.exit(0), 15000);
} else if (mode === 'watch' || mode === 'orphan') {
  spawn(process.execPath, ['task.cjs', 'child'], {stdio:'ignore', windowsHide:true});
  console.log('watch-ready');
  if (mode === 'orphan') setInterval(() => { if (fs.existsSync('heartbeat')) process.exit(0); }, 30);
  setTimeout(() => process.exit(0), 15000);
} else if (mode === 'flood') {
  fs.writeSync(1, 'x'.repeat(150000) + 'OUTPUT-END');
  fs.writeSync(2, 'y'.repeat(150000) + 'ERROR-END');
} else {
  console.log('fixture-output');
  console.error('fixture-error');
  process.exitCode = mode === 'fail' ? 7 : 0;
}
"#,
        )
        .unwrap();
        fixture
    }

    fn start(&self, runner: &TaskRunner, workspace: &str, name: &str) -> Run {
        runner
            .start(
                &self.0,
                workspace,
                name,
                &catalog::read(&self.0).unwrap().fingerprint,
            )
            .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // Only this UUID-named fixture under the system temp directory is removed.
        let parent = std::env::temp_dir().canonicalize().unwrap();
        assert!(self.0.starts_with(parent));
        for _ in 0..30 {
            if std::fs::remove_dir_all(&self.0).is_ok() {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        if !std::thread::panicking() {
            panic!(
                "task fixture remained locked after cleanup: {}",
                self.0.display()
            );
        }
    }
}

pub(super) async fn finished(runner: &TaskRunner, workspace: &str) -> Run {
    tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            let run = runner.list(workspace).remove(0);
            if run.finished_at.is_some() {
                return run;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("task must finish within the fixture deadline")
}

pub(super) async fn child_pid(fixture: &Fixture) -> u32 {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(pid) = std::fs::read_to_string(fixture.0.join("child.pid")) {
                if let Ok(pid) = pid.parse() {
                    if fixture.0.join("heartbeat").exists() {
                        return pid;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("fixture child must start")
}

pub(super) async fn assert_child_exited(fixture: &Fixture, pid: u32) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, GetLastError, ERROR_INVALID_PARAMETER, WAIT_OBJECT_0},
            System::Threading::{OpenProcess, WaitForSingleObject},
        };
        // SYNCHRONIZE: wait on the exact child PID, without terminating any arbitrary process.
        unsafe {
            let handle = OpenProcess(0x00100000, 0, pid);
            if !handle.is_null() {
                let result = WaitForSingleObject(handle, 2000);
                CloseHandle(handle);
                assert_eq!(result, WAIT_OBJECT_0, "descendant is still alive");
            } else {
                assert_eq!(
                    GetLastError(),
                    ERROR_INVALID_PARAMETER,
                    "process probe failed for a reason other than process exit"
                );
            }
        }
    }
    #[cfg(not(windows))]
    let _ = pid;
    let before = std::fs::read(fixture.0.join("heartbeat")).ok();
    tokio::time::sleep(Duration::from_millis(180)).await;
    assert_eq!(
        before,
        std::fs::read(fixture.0.join("heartbeat")).ok(),
        "descendant continued writing after stop"
    );
}

#[test]
fn discovers_scripts_and_rejects_invalid_or_oversized_manifests() {
    let fixture = Fixture::new();
    assert!(catalog::read(&fixture.0).unwrap().tasks.is_empty());
    fixture.scripts(json!({"build:dev":"echo hello", "bad&name":"echo unsafe"}));
    let catalog = catalog::read(&fixture.0).unwrap();
    assert_eq!(catalog.manager, "bun");
    assert!(catalog
        .tasks
        .iter()
        .any(|task| task.name == "build:dev" && task.runnable));
    assert!(catalog
        .tasks
        .iter()
        .any(|task| task.name == "bad&name" && !task.runnable));
    for name in ["-x", "a b", "a\n", "a%PATH%", "a&b", ""] {
        assert!(!catalog::valid_name(name));
    }
    std::fs::write(fixture.0.join("package.json"), "[]").unwrap();
    assert_eq!(
        catalog::read(&fixture.0).unwrap_err(),
        "task_manifest_invalid"
    );
    std::fs::write(fixture.0.join("package.json"), vec![b' '; 256 * 1024 + 1]).unwrap();
    assert_eq!(
        catalog::read(&fixture.0).unwrap_err(),
        "task_manifest_too_large"
    );
}

#[test]
fn fingerprints_manager_selection_and_rejects_stale_previews_without_execution() {
    let fixture = Fixture::new();
    std::fs::write(
        fixture.0.join("package.json"),
        r#"{"scripts":{"ok":"must never run"}}"#,
    )
    .unwrap();
    let old = catalog::read(&fixture.0).unwrap();
    assert_eq!(old.manager, "npm");
    std::fs::write(fixture.0.join("pnpm-lock.yaml"), "").unwrap();
    let new = catalog::read(&fixture.0).unwrap();
    assert_eq!(new.manager, "pnpm");
    assert_ne!(old.fingerprint, new.fingerprint);
    assert_eq!(
        TaskRunner::default()
            .start(&fixture.0, "a", "ok", &old.fingerprint)
            .err()
            .unwrap(),
        "task_catalog_changed"
    );
}

#[tokio::test]
async fn runs_real_scripts_captures_both_streams_and_retains_exit_codes() {
    let fixture = Fixture::runnable();
    let runner = TaskRunner::default();
    for (name, status, code) in [("ok", "succeeded", 0), ("fail", "failed", 7)] {
        fixture.start(&runner, "a", name);
        let run = finished(&runner, "a").await;
        assert_eq!(run.status, status);
        assert_eq!(run.exit_code, Some(code));
        assert!(run.stdout.contains("fixture-output"));
        assert!(run.stderr.contains("fixture-error"));
    }
    assert!(runner.list("another-project").is_empty());
    assert_eq!(runner.list("a").len(), 2);
    assert!(runner.list("a")[1].stdout.is_empty());
}

#[tokio::test]
async fn bounds_real_output_without_deadlocking_either_pipe() {
    let fixture = Fixture::runnable();
    let runner = TaskRunner::default();
    fixture.start(&runner, "a", "flood");
    let run = finished(&runner, "a").await;
    assert_eq!(run.status, "succeeded");
    assert!(run.truncated);
    assert_eq!(run.stdout.len(), OUTPUT_LIMIT);
    assert_eq!(run.stderr.len(), OUTPUT_LIMIT);
    assert!(run.stdout.ends_with("OUTPUT-END"));
    assert!(run.stderr.ends_with("ERROR-END"));
}

#[tokio::test]
async fn normal_completion_also_cleans_up_remaining_descendants() {
    let fixture = Fixture::runnable();
    let runner = TaskRunner::default();
    fixture.start(&runner, "a", "orphan");
    let run = finished(&runner, "a").await;
    assert_eq!(run.status, "succeeded");
    let pid = child_pid(&fixture).await;
    assert_child_exited(&fixture, pid).await;
}

#[tokio::test]
async fn enforces_project_ownership_and_stops_descendant_processes() {
    let fixture = Fixture::runnable();
    let runner = TaskRunner::default();
    let run = fixture.start(&runner, "a", "watch");
    let pid = child_pid(&fixture).await;
    assert_eq!(
        runner.stop("b", &run.id).err().unwrap(),
        "task_run_not_found"
    );
    let fingerprint = catalog::read(&fixture.0).unwrap().fingerprint;
    assert_eq!(
        runner
            .start(&fixture.0, "a", "watch", &fingerprint)
            .err()
            .unwrap(),
        "task_project_busy"
    );
    assert_eq!(runner.stop("a", &run.id).unwrap().status, "stopping");
    assert_eq!(finished(&runner, "a").await.status, "cancelled");
    assert_child_exited(&fixture, pid).await;
    assert_eq!(runner.stop("a", &run.id).unwrap().status, "cancelled");
}

#[tokio::test]
async fn shutdown_closes_the_runner_and_kills_descendants_synchronously() {
    let fixture = Fixture::runnable();
    let runner = TaskRunner::default();
    fixture.start(&runner, "a", "watch");
    let pid = child_pid(&fixture).await;
    runner.stop_all();
    assert_eq!(finished(&runner, "a").await.status, "cancelled");
    assert_child_exited(&fixture, pid).await;
    let fingerprint = catalog::read(&fixture.0).unwrap().fingerprint;
    assert_eq!(
        runner
            .start(&fixture.0, "a", "ok", &fingerprint)
            .err()
            .unwrap(),
        "task_runner_closed"
    );
}

#[tokio::test]
async fn enforces_the_global_concurrency_limit() {
    let fixture = Fixture::runnable();
    let runner = TaskRunner::default();
    for workspace in ["a", "b", "c", "d"] {
        fixture.start(&runner, workspace, "watch");
    }
    let fingerprint = catalog::read(&fixture.0).unwrap().fingerprint;
    assert_eq!(
        runner
            .start(&fixture.0, "e", "watch", &fingerprint)
            .err()
            .unwrap(),
        "task_limit_reached"
    );
    runner.stop_all();
    for workspace in ["a", "b", "c", "d"] {
        assert_eq!(finished(&runner, workspace).await.status, "cancelled");
    }
}

#[test]
fn remote_clients_cannot_start_stop_or_clear_project_tasks() {
    let mut router = crate::host_router::HostRouter::new();
    router
        .connect(
            "remote",
            &json!({"type":"hello", "protocolVersion":2, "clientType":"remote"}),
        )
        .unwrap();
    for operation in [
        "start_project_task",
        "stop_project_task",
        "clear_project_task_history",
    ] {
        let error = router
            .route(
                "remote",
                &json!({"type":"host_request", "requestId":"r", "operation":operation}),
            )
            .unwrap_err();
        assert_eq!(error.code, "remote_operation_forbidden");
    }
    assert!(router
        .route(
            "remote",
            &json!({"type":"data_request", "requestId":"r", "operation":"project_task_runs"})
        )
        .is_ok());
}
