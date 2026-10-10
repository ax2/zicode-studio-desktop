//! Start the installed binary as a separate worker after explicit user action.

use super::control;
use crate::process_command::new_command;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

pub(super) fn start(public_dir: &Path) -> Result<&'static str, String> {
    let _launch_lock = control::acquire_launch_lock()?;
    let existing = control::status()?;
    if existing != "stopped" {
        return Ok(existing);
    }
    if !public_dir.is_absolute() || !public_dir.join("index.html").is_file() {
        return Err("Automation worker resources are unavailable".into());
    }
    let current_exe = std::env::current_exe()
        .map_err(|error| format!("Cannot locate automation worker executable: {error}"))?;
    let appimage = stable_appimage(&current_exe)?;
    let executable = appimage.as_deref().unwrap_or(&current_exe);
    let mut command = new_command(executable);
    command.arg("--zicode-automation-worker");
    if appimage.is_none() {
        command.arg("--public-dir").arg(public_dir);
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Cannot start automation worker: {error}"))?;
    for _ in 0..20 {
        let status = control::status()?;
        if status != "stopped" {
            return Ok(status);
        }
        if let Some(exit) = child
            .try_wait()
            .map_err(|error| format!("Cannot inspect automation worker startup: {error}"))?
        {
            return Err(format!("Automation worker exited during startup ({exit})"));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Ok("starting")
}

#[cfg(target_os = "linux")]
fn stable_appimage(current_exe: &Path) -> Result<Option<PathBuf>, String> {
    let Some(mount) = std::env::var_os("APPDIR").map(PathBuf::from) else {
        return Ok(None);
    };
    if !mount.is_absolute() || !current_exe.starts_with(&mount) {
        return Ok(None);
    }
    let image = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .ok_or("Cannot locate the installed AppImage for the automation worker")?;
    if !image.is_absolute() || !image.is_file() {
        return Err("Automation worker AppImage is unavailable".into());
    }
    Ok(Some(image))
}

#[cfg(not(target_os = "linux"))]
fn stable_appimage(_current_exe: &Path) -> Result<Option<PathBuf>, String> {
    Ok(None)
}
