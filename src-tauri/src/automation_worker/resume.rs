//! A one-shot, same-user intent to resume the worker after an app update.
//! File creation is the marker; no executable path or credentials are stored.

use super::control;
use std::fs::{self, OpenOptions};
use std::path::PathBuf;

const RESUME_FILE: &str = "automation-worker-resume-after-update";

fn path() -> Result<PathBuf, String> {
    Ok(crate::app_paths::system_root()?.join(RESUME_FILE))
}

pub(super) fn pending() -> Result<bool, String> {
    let path = path()?;
    control::ensure_regular_or_missing(&path)?;
    Ok(path.exists())
}

pub(super) fn mark() -> Result<(), String> {
    let path = path()?;
    let parent = path
        .parent()
        .ok_or("Automation resume directory is unavailable")?;
    fs::create_dir_all(parent).map_err(|_| "Cannot create automation resume directory")?;
    control::ensure_regular_or_missing(&path)?;
    match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            control::ensure_regular_or_missing(&path)
        }
        Err(_) => Err("Cannot save automation resume intent".into()),
    }
}

pub(super) fn clear() -> Result<(), String> {
    let path = path()?;
    control::ensure_regular_or_missing(&path)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Cannot clear automation resume intent".into()),
    }
}
