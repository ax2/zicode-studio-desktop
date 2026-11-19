//! Disposable browser metadata and engine directories. Private owners never fall
//! back to a persistent session, even if a delayed callback arrives after close.
use crate::browser_store::Store;
use fs2::FileExt;
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
};

struct Private {
    store: Store,
    dir: PathBuf,
    _lock: File,
}
static LIVE: LazyLock<Mutex<HashMap<String, Private>>> = LazyLock::new(Default::default);
const MARKER: &str = "zicode-private-owner";
fn base() -> Result<PathBuf, String> {
    Ok(crate::app_paths::data_root()?.join("browser/private-windows"))
}
fn ordinary(path: &Path) -> bool {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return false;
    };
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    !meta.file_type().is_symlink()
}
pub(crate) fn begin(owner: &str) -> Result<(), String> {
    let id = owner
        .strip_prefix(crate::browser_windows::PRIVATE)
        .ok_or("Invalid private window")?;
    if uuid::Uuid::parse_str(id)
        .ok()
        .is_none_or(|u| u.to_string() != id)
    {
        return Err("Invalid private window".into());
    }
    let store = Store::memory()?;
    let root = base()?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    if !ordinary(&root) {
        return Err("Invalid private storage directory".into());
    }
    let dir = root.join(id);
    fs::create_dir(&dir).map_err(|e| e.to_string())?;
    let lock = File::create_new(dir.join(MARKER)).map_err(|e| e.to_string())?;
    lock.try_lock_exclusive().map_err(|e| e.to_string())?;
    use std::io::Write;
    (&lock)
        .write_all(id.as_bytes())
        .map_err(|e| e.to_string())?;
    LIVE.lock()
        .map_err(|_| "Private browser unavailable")?
        .insert(
            owner.to_owned(),
            Private {
                store,
                dir,
                _lock: lock,
            },
        );
    Ok(())
}
pub(crate) fn store<T>(
    root: &Path,
    owner: &str,
    task: impl FnOnce(&mut Store) -> Result<T, String>,
) -> Result<T, String> {
    if !crate::browser_windows::private(owner) {
        return task(&mut Store::open(root)?);
    }
    let mut live = LIVE.lock().map_err(|_| "Private browser unavailable")?;
    task(
        &mut live
            .get_mut(owner)
            .ok_or("Private browser window closed")?
            .store,
    )
}
pub(crate) fn engine(owner: &str) -> Result<PathBuf, String> {
    Ok(LIVE
        .lock()
        .map_err(|_| "Private browser unavailable")?
        .get(owner)
        .ok_or("Private browser window closed")?
        .dir
        .join("engine"))
}
fn remove_owned(root: &Path, dir: &Path) -> bool {
    let Some(id) = dir.file_name().and_then(|v| v.to_str()) else {
        return false;
    };
    if uuid::Uuid::parse_str(id)
        .ok()
        .is_none_or(|u| u.to_string() != id)
        || dir.parent() != Some(root)
        || !ordinary(root)
        || !ordinary(dir)
    {
        return false;
    }
    let marker = dir.join(MARKER);
    if !ordinary(&marker)
        || !fs::metadata(&marker).is_ok_and(|m| m.is_file() && m.len() == id.len() as u64)
        || fs::read_to_string(&marker).ok().as_deref() != Some(id)
    {
        return false;
    }
    let Ok(lock) = OpenOptions::new().read(true).write(true).open(&marker) else {
        return false;
    };
    if lock.try_lock_exclusive().is_err() {
        return false;
    }
    // Remove engine files before the receipt so cleanup can retry locked profiles.
    let engine = dir.join("engine");
    if engine.exists() && (!ordinary(&engine) || fs::remove_dir_all(&engine).is_err()) {
        return false;
    }
    drop(lock);
    fs::remove_file(marker).is_ok() && fs::remove_dir(dir).is_ok()
}

pub(crate) fn finish(owner: &str) {
    let Some(private) = LIVE.lock().ok().and_then(|mut l| l.remove(owner)) else {
        return;
    };
    let dir = private.dir.clone();
    drop(private);
    if let Some(root) = dir.parent().map(Path::to_owned) {
        std::thread::spawn(move || {
            for _ in 0..20 {
                if remove_owned(&root, &dir) || !dir.exists() {
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
        });
    }
}
pub(crate) fn cleanup_previous() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        std::thread::spawn(|| {
            let Ok(root) = base() else { return };
            if !ordinary(&root) {
                return;
            }
            let Ok(entries) = fs::read_dir(&root) else {
                return;
            };
            for item in entries.flatten() {
                remove_owned(&root, &item.path());
            }
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cleanup_checks_receipt_and_process_lock_before_removing_an_engine() {
        let root =
            std::env::temp_dir().join(format!("studio-private-cleanup-{}", uuid::Uuid::new_v4()));
        let id = uuid::Uuid::new_v4().to_string();
        let dir = root.join(&id);
        fs::create_dir_all(dir.join("engine")).unwrap();
        fs::write(dir.join("engine/canary"), b"synthetic").unwrap();
        fs::write(dir.join(MARKER), b"not our receipt").unwrap();
        assert!(!remove_owned(&root, &dir));
        fs::write(dir.join(MARKER), &id).unwrap();
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .open(dir.join(MARKER))
            .unwrap();
        lock.try_lock_exclusive().unwrap();
        assert!(!remove_owned(&root, &dir));
        assert!(dir.join("engine/canary").is_file());
        drop(lock);
        assert!(remove_owned(&root, &dir));
        assert!(!dir.exists());
        fs::remove_dir(root).unwrap();
    }
}
