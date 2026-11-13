//! Recover workspace directory swaps interrupted by a process exit.
use super::{is_plain_directory_metadata, is_reparse_point, BACKUP_APPS};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

const PREPARING: &str = ".restore-v2-preparing-";
const PENDING: &str = ".restore-v2-pending-";
const FINISHED: &str = ".restore-v2-finished-";
const JOURNAL: &str = "restore.json";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Swap {
    app: String,
    had_previous: bool,
}

fn entry(path: &Path) -> Result<Option<fs::Metadata>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Cannot inspect {}: {error}", path.display())),
    }
}

fn directory(path: &Path) -> Result<bool, String> {
    match entry(path)? {
        Some(metadata) if is_plain_directory_metadata(&metadata) => Ok(true),
        None => Ok(false),
        _ => Err(format!("Unsupported restore directory: {}", path.display())),
    }
}

fn regular_file(path: &Path) -> Result<(), String> {
    match entry(path)? {
        Some(metadata) if !metadata.is_file() || is_reparse_point(&metadata) => {
            Err(format!("Unsupported restore file: {}", path.display()))
        }
        _ => Ok(()),
    }
}

fn rename(from: &Path, to: &Path) -> Result<(), String> {
    fs::rename(from, to).map_err(|error| {
        format!(
            "Cannot move {} to {}: {error}",
            from.display(),
            to.display()
        )
    })
}

pub(super) fn lock(root: &Path) -> Result<File, String> {
    let path = root.join(".restore-lock");
    regular_file(&path)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)
        .map_err(|error| format!("Cannot open workspace restore lock: {error}"))?;
    fs2::FileExt::try_lock_exclusive(&file)
        .map_err(|error| format!("Workspace restore is busy or cannot be locked: {error}"))?;
    Ok(file)
}

pub(super) fn preparing(root: &Path, id: &str) -> PathBuf {
    root.join(format!("{PREPARING}{id}"))
}

pub(super) fn publish(
    root: &Path,
    staged: &Path,
    id: &str,
    apps: &[&str],
) -> Result<PathBuf, String> {
    let mut swaps = Vec::new();
    for &app in apps {
        swaps.push(Swap {
            app: app.to_owned(),
            had_previous: directory(&root.join(app))?,
        });
    }
    fs::create_dir(staged.join("previous")).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec(&swaps).map_err(|error| error.to_string())?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(staged.join(JOURNAL))
        .map_err(|error| format!("Cannot create workspace restore journal: {error}"))?;
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|error| format!("Cannot save workspace restore journal: {error}"))?;
    drop(file);
    let pending = root.join(format!("{PENDING}{id}"));
    rename(staged, &pending)?;
    Ok(pending)
}

fn read_journal(staging: &Path) -> Result<Vec<Swap>, String> {
    let path = staging.join(JOURNAL);
    regular_file(&path)?;
    let mut bytes = Vec::new();
    File::open(&path)
        .and_then(|file| file.take(4097).read_to_end(&mut bytes))
        .map_err(|error| format!("Cannot read restore journal {}: {error}", path.display()))?;
    let invalid = || format!("Invalid workspace restore journal: {}", path.display());
    if bytes.len() > 4096 {
        return Err(invalid());
    }
    let swaps: Vec<Swap> = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    if swaps.is_empty()
        || swaps.iter().enumerate().any(|(index, swap)| {
            !BACKUP_APPS.contains(&swap.app.as_str())
                || swaps[..index].iter().any(|prior| prior.app == swap.app)
        })
    {
        return Err(invalid());
    }
    if !directory(&staging.join("previous"))? || !directory(&staging.join("next"))? {
        return Err(invalid());
    }
    Ok(swaps)
}

pub(super) fn install(root: &Path, staging: &Path) -> Result<(), String> {
    install_with(root, staging, || {})
}

fn install_with(root: &Path, staging: &Path, after_move_previous: impl Fn()) -> Result<(), String> {
    for swap in read_journal(staging)? {
        let target = root.join(&swap.app);
        if swap.had_previous {
            rename(&target, &staging.join("previous").join(&swap.app))?;
            after_move_previous();
        }
        rename(&staging.join("next").join(&swap.app), &target)?;
    }
    Ok(())
}

fn rollback(root: &Path, staging: &Path) -> Result<(), String> {
    let mut actions = Vec::new();
    for swap in read_journal(staging)?.into_iter().rev() {
        let target = root.join(&swap.app);
        let previous = staging.join("previous").join(&swap.app);
        let next = staging.join("next").join(&swap.app);
        let state = (
            directory(&target)?,
            directory(&previous)?,
            directory(&next)?,
        );
        match (swap.had_previous, state) {
            (true, (true, false, true)) | (false, (false, false, true)) => {}
            (true, (false, true, true)) => actions.push((previous, target)),
            (true, (true, true, false)) => {
                actions.push((target.clone(), next));
                actions.push((previous, target));
            }
            (false, (true, false, false)) => actions.push((target, next)),
            _ => {
                return Err(format!(
                    "Ambiguous interrupted restore for {}",
                    target.display()
                ))
            }
        }
    }
    for (from, to) in actions {
        rename(&from, &to)?;
    }
    Ok(())
}

fn cleanup(path: &Path) {
    if let Err(error) = fs::remove_dir_all(path) {
        log::warn!(
            "Cannot remove workspace restore staging {}: {error}",
            path.display()
        );
    }
}

pub(super) fn finish(root: &Path, staging: &Path, id: &str) -> Result<(), String> {
    let finished = commit(root, staging, id)?;
    cleanup(&finished);
    Ok(())
}

pub(super) fn committed(root: &Path, id: &str) -> PathBuf {
    root.join(format!("{FINISHED}{id}"))
}

pub(super) fn commit(root: &Path, staging: &Path, id: &str) -> Result<PathBuf, String> {
    // Rename publishes the completed outcome before deleting any recovery data.
    let finished = committed(root, id);
    rename(staging, &finished)?;
    Ok(finished)
}

fn transaction_id(name: &str, prefix: &str) -> Option<String> {
    let id = name.strip_prefix(prefix)?;
    (id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit())).then(|| id.to_owned())
}

pub(super) fn needs_recovery(root: &Path) -> Result<bool, String> {
    if !directory(root)? {
        return Ok(false);
    }
    for child in fs::read_dir(root).map_err(|error| error.to_string())? {
        let child = child.map_err(|error| error.to_string())?;
        if child.file_name().to_str().is_some_and(|name| {
            [PENDING, FINISHED, PREPARING, ".restore-"]
                .iter()
                .any(|prefix| transaction_id(name, prefix).is_some())
        }) {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
pub(super) fn recover(root: &Path) -> Result<(), String> {
    recover_preserving(root, None)
}

pub(super) fn recover_preserving(root: &Path, request_id: Option<&str>) -> Result<(), String> {
    let mut pending = None;
    let mut disposable = Vec::new();
    for child in fs::read_dir(root).map_err(|error| error.to_string())? {
        let child = child.map_err(|error| error.to_string())?;
        let name = child.file_name();
        let Some(name) = name.to_str() else { continue };
        let path = child.path();
        if let Some(id) = transaction_id(name, PENDING) {
            if !directory(&path)? || pending.replace((path, id)).is_some() {
                return Err("Multiple or invalid pending workspace restore transactions".into());
            }
        } else if transaction_id(name, FINISHED).is_some_and(|id| Some(id.as_str()) != request_id)
            || transaction_id(name, PREPARING).is_some()
        {
            if directory(&path)? {
                disposable.push(path);
            }
        } else if transaction_id(name, ".restore-").is_some()
            && directory(&path)?
            && directory(&path.join("previous"))?
        {
            return Err(format!(
                "Legacy workspace restore requires manual recovery: {}",
                path.display()
            ));
        }
    }
    if let Some((staging, id)) = pending {
        rollback(root, &staging)?;
        let discarded = preparing(root, &id);
        rename(&staging, &discarded)?;
        cleanup(&discarded);
    }
    for path in disposable {
        cleanup(&path);
    }
    Ok(())
}

#[cfg(test)]
#[path = "restore_transaction_tests.rs"]
mod tests;
