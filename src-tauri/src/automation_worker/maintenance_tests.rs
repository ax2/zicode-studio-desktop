//! Exercise real file locks in a child process with a synthetic desktop profile.
use super::*;
use fs2::FileExt;
use std::{fs, time::Duration};

fn isolated() -> bool {
    let thread = std::thread::current();
    let name = thread.name().expect("named test");
    if std::env::var("ZICODE_MAINTENANCE_TEST").as_deref() == Ok(name) {
        let profile = std::env::var_os("ZICODE_MAINTENANCE_PROFILE").unwrap();
        crate::desktop_profile::initialize(["--isolated-profile".into(), profile]).unwrap();
        return true;
    }
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    fs::create_dir_all(&scratch).unwrap();
    let scratch = scratch.canonicalize().unwrap();
    let root = scratch.join(format!("worker-maintenance-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    fs::write(
        root.join("owner"),
        b"worker maintenance tests; retain on failure",
    )
    .unwrap();
    let output = crate::process_command::new_command(std::env::current_exe().unwrap())
        .args(["--exact", name, "--nocapture"])
        .env("ZICODE_MAINTENANCE_TEST", name)
        .env("ZICODE_MAINTENANCE_PROFILE", root.join("profile"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        root.canonicalize().unwrap().parent(),
        Some(scratch.as_path())
    );
    assert_eq!(
        fs::read(root.join("owner")).unwrap(),
        b"worker maintenance tests; retain on failure"
    );
    fs::remove_dir_all(root).unwrap();
    false
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
}

async fn wait_for_stop() {
    for _ in 0..100 {
        if control::status().unwrap() == "stopping" {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("Maintenance did not request worker shutdown");
}

#[test]
fn restore_waits_for_worker_release_and_excludes_relaunch_without_resume() {
    if !isolated() {
        return;
    }
    runtime().block_on(async {
        let worker = control::WorkerInstance::acquire().unwrap();
        let (lease, ()) = tokio::join!(stop_for_restore(), async {
            wait_for_stop().await;
            assert!(worker.stop_requested().unwrap());
            // A shutdown request alone must not permit restoring underneath writers.
            assert!(control::try_acquire_update_lock().unwrap().is_none());
            tokio::time::sleep(Duration::from_millis(50)).await;
            drop(worker);
        });
        let lease = lease.unwrap();
        assert!(lease.was_running());
        assert_eq!(status().unwrap(), "stopped");
        assert!(!resume::pending().unwrap());
        assert!(control::acquire_launch_lock().is_err());
        assert!(control::WorkerInstance::acquire().is_err());
        drop(lease);
        let _new_worker = control::WorkerInstance::acquire().unwrap();
    });
}

#[test]
fn update_still_records_resume_after_draining_worker() {
    if !isolated() {
        return;
    }
    runtime().block_on(async {
        let worker = control::WorkerInstance::acquire().unwrap();
        let (lease, ()) = tokio::join!(stop_for_update(), async {
            wait_for_stop().await;
            drop(worker);
        });
        let _lease = lease.unwrap();
        assert!(resume::pending().unwrap());
    });
}

#[test]
fn restore_waits_for_legacy_worker_without_shared_maintenance_lock() {
    if !isolated() {
        return;
    }
    let root = crate::app_paths::system_root().unwrap();
    fs::create_dir_all(&root).unwrap();
    let legacy = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(root.join("automation-worker.lock"))
        .unwrap();
    FileExt::try_lock_exclusive(&legacy).unwrap();
    runtime().block_on(async {
        let (lease, ()) = tokio::join!(stop_for_restore(), async {
            wait_for_stop().await;
            assert_eq!(status().unwrap(), "stopping");
            drop(legacy);
        });
        let _lease = lease.unwrap();
        assert_eq!(status().unwrap(), "stopped");
        assert!(!resume::pending().unwrap());
    });
}

#[test]
fn launcher_to_worker_handoff_keeps_maintenance_excluded() {
    if !isolated() {
        return;
    }
    let launcher = control::acquire_launch_lock().unwrap();
    assert!(control::try_acquire_update_lock().unwrap().is_none());
    let worker = control::WorkerInstance::acquire().unwrap();
    drop(launcher);
    assert!(control::try_acquire_update_lock().unwrap().is_none());
    drop(worker);
    let lease = control::try_acquire_update_lock().unwrap().unwrap();
    assert!(control::acquire_launch_lock().is_err());
    drop(lease);
    let _launcher = control::acquire_launch_lock().unwrap();
}
