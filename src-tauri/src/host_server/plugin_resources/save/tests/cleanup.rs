//! Test-only cleanup after Host shutdown; persistent locks remain test failures.
use std::{fs, io, path::Path, time::Duration};

pub(super) async fn remove_owned(root: &Path, attempts: usize) -> io::Result<usize> {
    let scratch = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .canonicalize()?;
    let resolved = root.canonicalize()?;
    let owner: serde_json::Value = serde_json::from_slice(&fs::read(root.join("owner.json"))?)?;
    if attempts == 0
        || resolved.parent() != Some(scratch.as_path())
        || fs::symlink_metadata(root)?.file_type().is_symlink()
        || owner["purpose"] != "resource save workspace close race"
        || owner["pid"] != std::process::id()
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Not this test's owned cleanup directory",
        ));
    }
    for attempt in 1..=attempts {
        match fs::remove_dir_all(&resolved) {
            Ok(()) => {
                if attempt > 1 {
                    eprintln!(
                        "Owned cleanup succeeded after {attempt} attempts: {}",
                        resolved.display()
                    );
                }
                return Ok(attempt);
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(attempt),
            Err(error)
                if cfg!(windows) && error.raw_os_error() == Some(32) && attempt < attempts =>
            {
                if attempt == 1 {
                    eprintln!("Transient Windows sharing conflict after Host release; bounded cleanup retry: {}", resolved.display());
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            Err(error) => {
                eprintln!("Owned cleanup failed after {attempt} attempts; remaining evidence retained at {}: {error}", resolved.display());
                return Err(error);
            }
        }
    }
    unreachable!("Positive attempt count always returns a result")
}

#[cfg(windows)]
mod tests {
    use super::*;
    use std::{fs::OpenOptions, os::windows::fs::OpenOptionsExt, path::PathBuf};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../.cache/task-scratch")
                .join(format!("save-cleanup-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&root).unwrap();
            fs::write(
                root.join("owner.json"),
                serde_json::json!({
                    "purpose":"resource save workspace close race", "pid":std::process::id()
                })
                .to_string(),
            )
            .unwrap();
            fs::write(root.join("locked.bin"), b"controlled lock").unwrap();
            Self(root)
        }
        fn hold(&self) -> fs::File {
            OpenOptions::new()
                .read(true)
                .share_mode(1)
                .open(self.0.join("locked.bin"))
                .unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            if let Ok(root) = self.0.canonicalize() {
                let scratch = Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../.cache/task-scratch")
                    .canonicalize()
                    .unwrap();
                assert_eq!(root.parent(), Some(scratch.as_path()));
                fs::remove_dir_all(root).unwrap();
            }
        }
    }

    #[tokio::test]
    async fn released_windows_lock_is_retried_and_directory_is_removed() {
        let f = Fixture::new();
        let held = f.hold();
        let (result, ()) = tokio::join!(remove_owned(&f.0, 100), async {
            tokio::time::sleep(Duration::from_millis(80)).await;
            drop(held);
        });
        assert!(result.unwrap() > 1);
        assert!(!f.0.exists());
    }

    #[tokio::test]
    async fn persistent_windows_lock_is_an_error_and_retains_evidence() {
        let f = Fixture::new();
        let held = f.hold();
        assert_eq!(
            remove_owned(&f.0, 3).await.unwrap_err().raw_os_error(),
            Some(32)
        );
        assert!(f.0.join("locked.bin").is_file());
        drop(held);
    }

    #[tokio::test]
    async fn wrong_owner_is_rejected_without_deleting_files() {
        let f = Fixture::new();
        fs::write(f.0.join("owner.json"), b"{}").unwrap();
        assert_eq!(
            remove_owned(&f.0, 3).await.unwrap_err().kind(),
            io::ErrorKind::PermissionDenied
        );
        assert_eq!(
            fs::read(f.0.join("locked.bin")).unwrap(),
            b"controlled lock"
        );
    }
}
