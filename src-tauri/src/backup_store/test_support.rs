//! Run backup tests against a separate real desktop profile, never user backups.
use std::fs;
use std::path::PathBuf;

pub(super) fn isolated() -> bool {
    let thread = std::thread::current();
    let name = thread.name().expect("named Rust test thread");
    if std::env::var("ZICODE_BACKUP_TEST_CASE").as_deref() == Ok(name) {
        let root = PathBuf::from(std::env::var_os("ZICODE_BACKUP_TEST_PROFILE").unwrap());
        crate::desktop_profile::initialize([
            "--isolated-profile".into(),
            root.clone().into_os_string(),
        ])
        .unwrap();
        assert_eq!(
            super::backups_root().unwrap(),
            root.canonicalize().unwrap().join("system/backups")
        );
        return true;
    }
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    fs::create_dir_all(&scratch).unwrap();
    let scratch = scratch.canonicalize().unwrap();
    let owner = scratch.join(format!("backup-profile-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&owner).unwrap();
    fs::write(
        owner.join("owner.json"),
        r#"{"purpose":"isolated backup tests","lifetime":"remove on pass; retain on failure"}"#,
    )
    .unwrap();
    let result = crate::process_command::new_command(std::env::current_exe().unwrap())
        .args(["--exact", name, "--nocapture"])
        .env("ZICODE_BACKUP_TEST_CASE", name)
        .env("ZICODE_BACKUP_TEST_PROFILE", owner.join("profile"))
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "isolated {name} failed:\n{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
    assert_eq!(owner.parent(), Some(scratch.as_path()));
    fs::remove_dir_all(owner).unwrap();
    false
}
