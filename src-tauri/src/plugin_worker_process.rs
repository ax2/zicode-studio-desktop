//! Bounded stdio transport: drain output while the isolated worker runs.
use std::io::{Read, Write};
use std::process::{Command, ExitStatus};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
#[path = "plugin_worker_tree.rs"]
mod process_tree;

#[derive(Debug)]
pub(crate) struct Error {
    pub code: &'static str,
    pub message: &'static str,
}

#[cfg(test)]
pub(super) fn run(
    command: Command,
    request: Vec<u8>,
    timeout: Duration,
    limit: usize,
) -> Result<(ExitStatus, Vec<u8>), Error> {
    run_cancellable(command, request, timeout, limit, None)
}

#[cfg(test)]
pub(crate) fn run_cancellable(
    command: Command,
    request: Vec<u8>,
    timeout: Duration,
    limit: usize,
    cancelled: Option<&AtomicBool>,
) -> Result<(ExitStatus, Vec<u8>), Error> {
    run_observed(command, request, timeout, limit, cancelled, None)
}

pub(crate) fn run_observed(
    mut command: Command,
    request: Vec<u8>,
    timeout: Duration,
    limit: usize,
    cancelled: Option<&AtomicBool>,
    observer: Option<&dyn Fn(&'static str, u32)>,
) -> Result<(ExitStatus, Vec<u8>), Error> {
    let check_cancelled = || {
        if cancelled.is_some_and(|flag| flag.load(Ordering::Acquire)) {
            Err(Error {
                code: "worker_cancelled",
                message: "Plugin Worker execution was cancelled",
            })
        } else {
            Ok(())
        }
    };
    check_cancelled()?;
    let (mut child, tree) = process_tree::spawn(&mut command).map_err(|_| Error {
        code: "plugin_not_active",
        message: "Cannot start plugin Worker Runtime",
    })?;
    let pid = child.id();
    if let Some(observer) = observer {
        observer("started", pid);
    }
    let started = Instant::now();
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(Error {
            code: "worker_protocol_error",
            message: "Worker stdout missing",
        });
    };
    let Some(mut stdin) = child.stdin.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(Error {
            code: "worker_protocol_error",
            message: "Worker stdin missing",
        });
    };
    let (tx, rx) = mpsc::channel();
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout
            .take(limit.saturating_add(1) as u64)
            .read_to_end(&mut bytes);
        let _ = tx.send(if result.is_err() {
            Err(Error {
                code: "worker_protocol_error",
                message: "Cannot read Worker response",
            })
        } else if bytes.len() > limit {
            Err(Error {
                code: "result_too_large",
                message: "Worker response exceeds its output limit",
            })
        } else {
            Ok(bytes)
        });
    });
    let (write_tx, write_rx) = mpsc::channel();
    let writer = thread::spawn(move || {
        let result = stdin.write_all(&request);
        drop(stdin); // Deliver EOF before waiting for execution.
        let _ = write_tx.send(result.is_ok());
    });
    let result = (|| {
        let mut output = None;
        let mut written = false;
        let mut status = None;
        loop {
            if let Err(error) = check_cancelled() {
                if matches!(child.try_wait(), Ok(None)) {
                    if let Some(observer) = observer {
                        observer("cancel_live", pid);
                    }
                }
                return Err(error);
            }
            match rx.try_recv() {
                Ok(result) => output = Some(result?),
                Err(mpsc::TryRecvError::Disconnected) if output.is_none() => {
                    return Err(Error {
                        code: "worker_protocol_error",
                        message: "Worker response reader disconnected",
                    })
                }
                _ => {}
            }
            match write_rx.try_recv() {
                Ok(true) => written = true,
                Ok(false) => {
                    return Err(Error {
                        code: "worker_protocol_error",
                        message: "Cannot send Worker request",
                    })
                }
                _ => {}
            }
            if status.is_none() {
                status = child.try_wait().map_err(|_| Error {
                    code: "worker_failed",
                    message: "Cannot monitor plugin Worker",
                })?;
                if status.is_some() {
                    // Even a successful parent exit can leave inherited pipe
                    // handles in descendants. Reclaim them before awaiting EOF.
                    tree.terminate().map_err(|_| Error {
                        code: "worker_cleanup_failed",
                        message: "Cannot confirm plugin Worker process tree termination",
                    })?;
                }
            }
            if written {
                if let Some(status) = status {
                    if let Some(output) = output.take() {
                        return Ok((status, output));
                    }
                }
            }
            if started.elapsed() >= timeout {
                return Err(Error {
                    code: "worker_timeout",
                    message: "Plugin Worker exceeded its execution limit",
                });
            }
            thread::sleep(Duration::from_millis(5));
        }
    })();
    if tree.terminate().is_err() {
        let _ = child.kill();
        let _ = child.wait();
        return Err(Error { code: "worker_cleanup_failed", message: "Cannot confirm plugin Worker process tree termination" });
    }
    if result.is_err() {
        let _ = child.kill();
        if child.wait().is_err() {
            return Err(Error {
                code: "worker_cleanup_failed",
                message: "Cannot confirm plugin Worker termination",
            });
        }
    }
    // Successful try_wait also reaps the child before returning its status.
    if let Some(observer) = observer {
        observer("reaped", pid);
    }
    // Terminate owned descendants before joining pipe readers. A descendant may
    // inherit stdout even after the primary Worker has exited.
    let _ = reader.join();
    let _ = writer.join();
    if let Some(observer) = observer {
        observer("pipes_closed", pid);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Stdio;

    #[test]
    // This fixture deliberately exits before its child, to exercise ownership
    // recovery. The parent test owns the job and verifies the child terminates.
    #[allow(clippy::zombie_processes)]
    fn child_fixture() {
        let Ok(mode) = std::env::var("ZICODE_WORKER_TRANSPORT_FIXTURE") else {
            return;
        };
        #[cfg(windows)]
        if mode == "descendant" {
            let path = std::path::PathBuf::from(std::env::var_os("ZICODE_TREE_READY").unwrap());
            std::fs::write(&path, std::process::id().to_string()).unwrap();
            thread::sleep(Duration::from_secs(10));
            std::fs::write(path.with_extension("finished"), "escaped").unwrap();
            return;
        }
        #[cfg(windows)]
        if matches!(mode.as_str(), "tree-live" | "tree-timeout" | "tree-exit" | "tree-overflow" | "tree-success") {
            let path = std::path::PathBuf::from(std::env::var_os("ZICODE_TREE_READY").unwrap());
            let mut descendant = fixture("descendant");
            descendant.env("ZICODE_TREE_READY", &path).stdin(Stdio::inherit()).stdout(Stdio::inherit());
            if mode == "tree-success" { descendant.stdin(Stdio::null()).stdout(Stdio::null()); }
            let _owned = descendant.spawn().unwrap();
            let deadline = Instant::now() + Duration::from_secs(4);
            while !path.exists() && Instant::now() < deadline { thread::sleep(Duration::from_millis(5)); }
            assert!(path.exists());
            if mode == "tree-overflow" { std::io::stdout().write_all(&vec![b'x'; 128 * 1024]).unwrap(); }
            if mode != "tree-exit" && mode != "tree-success" { thread::sleep(Duration::from_secs(10)); }
            return;
        }
        if mode == "cancel" {
            let path =
                std::path::PathBuf::from(std::env::var_os("ZICODE_WORKER_CANCEL_READY").unwrap());
            std::fs::write(&path, std::process::id().to_string()).unwrap();
            thread::sleep(Duration::from_secs(10));
            std::fs::write(path.with_extension("finished"), "completed").unwrap();
        }
        if mode == "sleep" {
            thread::sleep(Duration::from_secs(10));
        }
        if mode == "large" {
            // Write before reading stdin: sequential parent IO would deadlock.
            std::io::stdout()
                .write_all(&vec![b'x'; 192 * 1024])
                .unwrap();
            std::io::stdout().flush().unwrap();
            let mut input = Vec::new();
            std::io::stdin().read_to_end(&mut input).unwrap();
            assert_eq!(input.len(), 192 * 1024);
        }
    }

    fn fixture(mode: &str) -> Command {
        let mut command = crate::process_command::new_command(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "plugin_capabilities::worker_process::tests::child_fixture",
                "--nocapture",
            ])
            .env("ZICODE_WORKER_TRANSPORT_FIXTURE", mode)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        command
    }

    #[test]
    fn drains_large_output_while_sending_input_and_enforces_limits_and_deadline() {
        let (status, bytes) = run(
            fixture("large"),
            vec![b'y'; 192 * 1024],
            Duration::from_secs(5),
            256 * 1024,
        )
        .map_err(|e| e.message)
        .unwrap();
        assert!(status.success());
        assert!(bytes
            .windows(192 * 1024)
            .any(|s| s.iter().all(|b| *b == b'x')));
        assert_eq!(
            run(
                fixture("large"),
                vec![b'y'; 192 * 1024],
                Duration::from_secs(5),
                32 * 1024
            )
            .err()
            .unwrap()
            .code,
            "result_too_large"
        );
        assert_eq!(
            run(
                fixture("sleep"),
                Vec::new(),
                Duration::from_millis(100),
                1024
            )
            .err()
            .unwrap()
            .code,
            "worker_timeout"
        );
    }

    #[test]
    fn cancels_running_child_reaps_pipes_and_keeps_next_worker_usable() {
        use std::sync::Arc;
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/task-scratch")
            .join(format!("worker-cancel-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("owner.json"),
            r#"{"purpose":"real child cancellation; remove on success"}"#,
        )
        .unwrap();
        let ready = root.join("ready.txt");
        let cancelled = Arc::new(AtomicBool::new(false));
        let worker_flag = cancelled.clone();
        let mut command = fixture("cancel");
        command.env("ZICODE_WORKER_CANCEL_READY", &ready);
        let task = thread::spawn(move || {
            run_cancellable(
                command,
                Vec::new(),
                Duration::from_secs(5),
                1024,
                Some(&worker_flag),
            )
        });
        let started = Instant::now();
        while !ready.exists() && started.elapsed() < Duration::from_secs(4) {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(
            ready.exists(),
            "Child must actually be executing before cancellation"
        );
        let cancel_started = Instant::now();
        cancelled.store(true, Ordering::Release);
        assert_eq!(task.join().unwrap().err().unwrap().code, "worker_cancelled");
        assert!(cancel_started.elapsed() < Duration::from_secs(2));
        assert!(!ready.with_extension("finished").exists());
        // Pre-cancelled invocation must not try to launch this nonexistent path.
        assert_eq!(
            run_cancellable(
                crate::process_command::new_command(root.join("missing.exe")),
                Vec::new(),
                Duration::from_secs(5),
                1024,
                Some(&cancelled)
            )
            .err()
            .unwrap()
            .code,
            "worker_cancelled"
        );
        assert!(run(
            fixture("large"),
            vec![b'y'; 192 * 1024],
            Duration::from_secs(5),
            256 * 1024
        )
        .map_err(|error| error.message)
        .unwrap()
        .0
        .success());
        std::fs::remove_file(ready).unwrap();
        std::fs::remove_file(root.join("owner.json")).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn owns_descendants_on_cancel_timeout_and_output_overflow() {
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use std::sync::Arc;
        use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};
        for (mode, expected) in [("tree-live", "worker_cancelled"), ("tree-timeout", "worker_timeout"), ("tree-overflow", "result_too_large"), ("tree-exit", "success"), ("tree-success", "success")] {
            let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch")
                .join(format!("worker-tree-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&root).unwrap();
            std::fs::write(root.join("owner.json"), r#"{"purpose":"owned grandchild cleanup acceptance; remove on success"}"#).unwrap();
            let ready = root.join("grandchild.txt");
            let flag = Arc::new(AtomicBool::new(false));
            let worker_flag = flag.clone();
            let mut command = fixture(mode);
            command.env("ZICODE_TREE_READY", &ready);
            let task = thread::spawn(move || run_cancellable(command, Vec::new(), Duration::from_secs(2), 1024, Some(&worker_flag)));
            let deadline = Instant::now() + Duration::from_secs(2);
            while !ready.exists() && Instant::now() < deadline { thread::sleep(Duration::from_millis(5)); }
            assert!(ready.exists(), "Grandchild must actually start");
            let id: u32 = std::fs::read_to_string(&ready).unwrap().parse().unwrap();
            // Retain the process identity while it may be terminated. PID reuse
            // cannot turn a different process into the cleanup proof.
            let handle = unsafe { OpenProcess(0x00100000, 0, id) }; // SYNCHRONIZE
            let handle = (!handle.is_null()).then(|| unsafe { OwnedHandle::from_raw_handle(handle) });
            if mode == "tree-live" { assert!(handle.is_some()); flag.store(true, Ordering::Release); }
            let finish = Instant::now();
            let result = task.join().unwrap();
            if expected == "success" { assert!(result.unwrap().0.success()); }
            else { assert_eq!(result.unwrap_err().code, expected); }
            assert!(finish.elapsed() < Duration::from_secs(5), "Pipe join must not wait for the 10-second descendant");
            if let Some(handle) = handle { assert_eq!(unsafe { WaitForSingleObject(handle.as_raw_handle(), 1000) }, windows_sys::Win32::Foundation::WAIT_OBJECT_0); }
            assert!(!ready.with_extension("finished").exists());
            std::fs::remove_file(&ready).unwrap();
            std::fs::remove_file(root.join("owner.json")).unwrap();
            std::fs::remove_dir(root).unwrap();
        }
        assert!(run(fixture("large"), vec![b'y';192*1024], Duration::from_secs(5), 256*1024).unwrap().0.success());
    }
}
