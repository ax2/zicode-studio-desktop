//! Same-user, filesystem-backed control for the no-window worker.
//! The OS lock identifies a live worker; the stop request is never a PID kill.

use fs2::FileExt;
use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

const LOCK_FILE: &str = "automation-worker.lock";
const STOP_FILE: &str = "automation-worker.stop";
const UPDATE_LOCK_FILE: &str = "automation-update.lock";

pub(super) struct UpdateLock {
    _file: File,
}

pub(super) fn acquire_launch_lock() -> Result<UpdateLock, String> {
    let lock = open_update_lock()?;
    match FileExt::try_lock_shared(&lock) {
        Ok(()) => Ok(UpdateLock { _file: lock }),
        Err(error) if error.kind() == ErrorKind::WouldBlock => {
            Err("App update is in progress".into())
        }
        Err(_) => Err("Cannot acquire automation update lock".into()),
    }
}

pub(super) fn try_acquire_update_lock() -> Result<Option<UpdateLock>, String> {
    let lock = open_update_lock()?;
    match FileExt::try_lock_exclusive(&lock) {
        Ok(()) => Ok(Some(UpdateLock { _file: lock })),
        Err(error) if error.kind() == ErrorKind::WouldBlock => Ok(None),
        Err(_) => Err("Cannot acquire automation update lock".into()),
    }
}

fn open_update_lock() -> Result<File, String> {
    let root = crate::app_paths::system_root()?;
    fs::create_dir_all(&root).map_err(|_| "Cannot create automation control directory")?;
    let path = root.join(UPDATE_LOCK_FILE);
    ensure_regular_or_missing(&path)?;
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)
        .map_err(|_| "Cannot open automation update lock".into())
}

pub(super) struct WorkerInstance {
    _lock: File,
    _update_lock: File,
    stop_path: PathBuf,
}

impl WorkerInstance {
    pub(super) fn acquire() -> Result<Self, String> {
        let update_lock = open_update_lock()?;
        match FileExt::try_lock_shared(&update_lock) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                return Err("App update is in progress".into());
            }
            Err(_) => return Err("Cannot acquire automation update lock".into()),
        }
        let root = crate::app_paths::system_root()?;
        fs::create_dir_all(&root).map_err(|_| "Cannot create automation control directory")?;
        let lock_path = root.join(LOCK_FILE);
        ensure_regular_or_missing(&lock_path)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)
            .map_err(|_| "Cannot open automation worker lock")?;
        match lock.try_lock_exclusive() {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                return Err("Automation worker is already running".into());
            }
            Err(_) => return Err("Cannot acquire automation worker lock".into()),
        }
        let stop_path = root.join(STOP_FILE);
        ensure_regular_or_missing(&stop_path)?;
        if stop_path.exists() {
            fs::remove_file(&stop_path)
                .map_err(|_| "Cannot clear stale automation stop request")?;
        }
        Ok(Self {
            _lock: lock,
            _update_lock: update_lock,
            stop_path,
        })
    }

    pub(super) fn stop_requested(&self) -> Result<bool, String> {
        match fs::symlink_metadata(&self.stop_path) {
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
            Err(_) => Err("Cannot inspect automation stop request".into()),
            Ok(metadata) if !metadata.is_file() || metadata.file_type().is_symlink() => {
                Err("Automation stop request is not a regular file".into())
            }
            Ok(_) => fs::read(&self.stop_path)
                .map(|bytes| bytes == b"stop")
                .map_err(|_| "Cannot read automation stop request".into()),
        }
    }
}

impl Drop for WorkerInstance {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.stop_path);
    }
}

pub(super) fn request_stop() -> Result<(), String> {
    let root = crate::app_paths::system_root()?;
    let lock_path = root.join(LOCK_FILE);
    ensure_regular_or_missing(&lock_path)?;
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|_| "Automation worker is not running")?;
    match lock.try_lock_exclusive() {
        Ok(()) => return Err("Automation worker is not running".into()),
        Err(error) if error.kind() == ErrorKind::WouldBlock => {}
        Err(_) => return Err("Cannot inspect automation worker lock".into()),
    }
    let stop_path = root.join(STOP_FILE);
    ensure_regular_or_missing(&stop_path)?;
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&stop_path)
    {
        Ok(mut file) => file
            .write_all(b"stop")
            .map_err(|_| "Cannot write automation stop request".into()),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {
            if fs::read(&stop_path).is_ok_and(|bytes| bytes == b"stop") {
                Ok(())
            } else {
                Err("Automation stop request is invalid".into())
            }
        }
        Err(_) => Err("Cannot create automation stop request".into()),
    }
}

pub(super) fn status() -> Result<&'static str, String> {
    let root = crate::app_paths::system_root()?;
    let lock_path = root.join(LOCK_FILE);
    ensure_regular_or_missing(&lock_path)?;
    let lock = match OpenOptions::new().read(true).write(true).open(&lock_path) {
        Ok(lock) => lock,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok("stopped"),
        Err(_) => return Err("Cannot inspect automation worker lock".into()),
    };
    match lock.try_lock_exclusive() {
        Ok(()) => Ok("stopped"),
        Err(error) if error.kind() == ErrorKind::WouldBlock => {
            let stop_path = root.join(STOP_FILE);
            ensure_regular_or_missing(&stop_path)?;
            if stop_path.exists() {
                Ok("stopping")
            } else {
                Ok("running")
            }
        }
        Err(_) => Err("Cannot inspect automation worker lock".into()),
    }
}

pub(super) fn ensure_regular_or_missing(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Cannot inspect automation control path".into()),
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => Ok(()),
        Ok(_) => Err("Automation control path is not a regular file".into()),
    }
}
