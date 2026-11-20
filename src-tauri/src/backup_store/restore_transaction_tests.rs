use super::*;

const APPS: &[&str] = &["notes", "tasks", "automation"];

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let scratch = Path::new(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
        fs::create_dir_all(&scratch).unwrap();
        let root = scratch.canonicalize().unwrap().join(format!(
            "issue-31-restore-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("owner.txt"), "Issue #31 synthetic restore test").unwrap();
        Self(root)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if !std::thread::panicking() {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
}

fn put(path: &Path, value: &str) {
    fs::create_dir_all(path).unwrap();
    fs::write(path.join("sentinel"), value).unwrap();
}

#[test]
fn recovery_rolls_back_at_every_swap_boundary_and_can_retry() {
    for (cut, interrupt_rollback) in (0..=5).map(|cut| (cut, false)).chain([(5, true)]) {
        let fixture = Fixture::new();
        let root = fixture.0.as_path();
        let id = "0123456789abcdef0123456789abcdef";
        put(&root.join("notes"), "old note");
        put(&root.join("tasks"), "old task");
        let preparing = preparing(root, id);
        for app in APPS {
            put(&preparing.join("next").join(app), "snapshot");
        }
        let pending = publish(root, &preparing, id, APPS).unwrap();
        let moves = [
            (root.join("notes"), pending.join("previous/notes")),
            (pending.join("next/notes"), root.join("notes")),
            (root.join("tasks"), pending.join("previous/tasks")),
            (pending.join("next/tasks"), root.join("tasks")),
            (pending.join("next/automation"), root.join("automation")),
        ];
        for (from, to) in &moves[..cut] {
            rename(from, to).unwrap();
        }
        if interrupt_rollback {
            // A prior recovery stopped after undoing two of its own moves.
            for (from, to) in moves[3..].iter().rev() {
                rename(to, from).unwrap();
            }
        }
        recover(root).unwrap();
        recover(root).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("notes/sentinel")).unwrap(),
            "old note"
        );
        assert_eq!(
            fs::read_to_string(root.join("tasks/sentinel")).unwrap(),
            "old task"
        );
        assert!(!root.join("automation").exists());
        assert!(!pending.exists());
    }
}

#[test]
fn finished_swap_is_preserved_when_cleanup_was_interrupted() {
    let fixture = Fixture::new();
    let root = fixture.0.as_path();
    let id = "0123456789abcdef0123456789abcdef";
    put(&root.join("notes"), "old");
    let preparing = preparing(root, id);
    put(&preparing.join("next/notes"), "snapshot");
    let pending = publish(root, &preparing, id, &["notes"]).unwrap();
    install(root, &pending).unwrap();
    rename(&pending, &root.join(format!("{FINISHED}{id}"))).unwrap();
    recover(root).unwrap();
    assert_eq!(
        fs::read_to_string(root.join("notes/sentinel")).unwrap(),
        "snapshot"
    );
    assert!(!root.join(format!("{FINISHED}{id}")).exists());
}

#[test]
fn ambiguous_state_is_reported_before_any_moves_and_legacy_is_preserved() {
    let fixture = Fixture::new();
    let root = fixture.0.as_path();
    let id = "0123456789abcdef0123456789abcdef";
    let preparing = preparing(root, id);
    put(&root.join("notes"), "old note");
    put(&preparing.join("next/notes"), "snapshot");
    put(&preparing.join("next/tasks"), "snapshot");
    let pending = publish(root, &preparing, id, &["tasks", "notes"]).unwrap();
    install(root, &pending).unwrap();
    put(&pending.join("next/tasks"), "unexpected");
    assert!(recover(root).unwrap_err().contains("Ambiguous"));
    assert!(pending.join("previous/notes/sentinel").is_file());
    assert_eq!(
        fs::read_to_string(root.join("notes/sentinel")).unwrap(),
        "snapshot"
    );
    let legacy = root.join(format!(".restore-{id}"));
    rename(&pending, &legacy).unwrap();
    assert!(recover(root).unwrap_err().contains("manual recovery"));
    assert!(legacy.join("previous/notes/sentinel").is_file());
}

#[test]
fn restore_lock_excludes_a_second_operation() {
    let fixture = Fixture::new();
    let first = lock(&fixture.0).unwrap();
    assert!(lock(&fixture.0).is_err());
    drop(first);
    assert!(lock(&fixture.0).is_ok());
}

#[cfg(windows)]
#[test]
fn terminated_windows_process_leaves_a_recoverable_swap() {
    use std::time::{Duration, Instant};

    const TEST: &str = "backup_store::restore_transaction::tests::terminated_windows_process_leaves_a_recoverable_swap";
    const ROOT_ENV: &str = "ZICODE_ISSUE31_CRASH_TEST_ROOT";
    const ID: &str = "0123456789abcdef0123456789abcdef";
    if let Some(root) = std::env::var_os(ROOT_ENV) {
        let root = PathBuf::from(root);
        assert_eq!(
            fs::read_to_string(root.join("owner.txt")).unwrap(),
            "Issue #31 synthetic restore test"
        );
        let _lock = lock(&root).unwrap();
        let pending = root.join(format!("{PENDING}{ID}"));
        install_with(&root, &pending, || {
            fs::write(root.join("at-swap-boundary"), b"previous moved").unwrap();
            std::thread::sleep(Duration::from_secs(30));
        })
        .unwrap();
        panic!("Parent did not terminate the child at the swap boundary");
    }

    let fixture = Fixture::new();
    let root = &fixture.0;
    put(&root.join("notes"), "original note");
    let staging = preparing(root, ID);
    put(&staging.join("next/notes"), "snapshot note");
    let pending = publish(root, &staging, ID, &["notes"]).unwrap();
    let mut child = crate::process_command::new_command(std::env::current_exe().unwrap())
        .args(["--exact", TEST])
        .env(ROOT_ENV, root)
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    let boundary = root.join("at-swap-boundary");
    while !boundary.is_file() && Instant::now() < deadline {
        assert!(
            child.try_wait().unwrap().is_none(),
            "Child exited before swapping"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    // Child::kill uses the handle returned by spawn, so PID reuse cannot
    // redirect termination to an unrelated process.
    let observed_boundary = boundary.is_file() && !root.join("notes").exists();
    child.kill().unwrap();
    assert!(!child.wait().unwrap().success());
    assert!(observed_boundary);
    assert_eq!(
        fs::read_to_string(pending.join("previous/notes/sentinel")).unwrap(),
        "original note"
    );
    assert!(pending.join("next/notes/sentinel").is_file());
    let _lock = lock(root).unwrap();
    recover(root).unwrap();
    assert_eq!(
        fs::read_to_string(root.join("notes/sentinel")).unwrap(),
        "original note"
    );
    assert!(!pending.exists());
}
