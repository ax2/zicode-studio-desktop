//! Elect one automation executor across desktop processes for this user.
//! Keep the OS lock until process exit, after Host shutdown has drained work.

#[cfg(not(test))]
use fs2::FileExt;
#[cfg(not(test))]
use std::fs::{self, File, OpenOptions};
#[cfg(not(test))]
use std::sync::OnceLock;

#[cfg(not(test))]
static LEADER: OnceLock<File> = OnceLock::new();

pub(super) fn try_acquire() -> Result<bool, String> {
    // Contract tests start several HostServer instances in one process and do
    // not exercise cross-process election. Preserve their independent scans.
    #[cfg(test)]
    {
        Ok(true)
    }
    #[cfg(not(test))]
    {
        if LEADER.get().is_some() {
            return Ok(false);
        }
        let root = crate::app_paths::system_root()?;
        fs::create_dir_all(&root).map_err(|_| "automation_leader_unavailable")?;
        let path = root.join("automation-runner.lock");
        if fs::symlink_metadata(&path)
            .is_ok_and(|metadata| !metadata.is_file() || metadata.file_type().is_symlink())
        {
            return Err("automation_leader_invalid".into());
        }
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path)
            .map_err(|_| "automation_leader_unavailable")?;
        match file.try_lock_exclusive() {
            Ok(()) => Ok(LEADER.set(file).is_ok()),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => Ok(false),
            Err(_) => Err("automation_leader_unavailable".into()),
        }
    }
}
