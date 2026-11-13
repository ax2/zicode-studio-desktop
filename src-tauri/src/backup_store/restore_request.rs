//! Persistent request for an explicitly confirmed offline restore.
use super::{is_reparse_point, validate_backup_id, validate_workspace_id, RestoreReport};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
};

const REQUEST: &str = "workspace-restore-request.json";
const TEMPORARY: &str = "workspace-restore-request.tmp";
const RESULT: &str = "workspace-restore-result.json";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RestoreRequest {
    pub(crate) request_id: String,
    pub(crate) workspace_id: String,
    pub(crate) backup_id: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreOutcome {
    pub(crate) request_id: String,
    pub(crate) workspace_id: String,
    pub(crate) report: RestoreReport,
}

pub(super) fn read(system_root: &Path) -> Result<Option<RestoreRequest>, String> {
    let path = system_root.join(REQUEST);
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Ok(metadata) if metadata.is_file() && !is_reparse_point(&metadata) => {}
        _ => return Err("Cannot inspect workspace restore request".into()),
    }
    let mut bytes = Vec::new();
    File::open(&path)
        .and_then(|file| file.take(4097).read_to_end(&mut bytes))
        .map_err(|error| format!("Cannot read workspace restore request: {error}"))?;
    if bytes.len() > 4096 {
        return Err("Workspace restore request is too large".into());
    }
    let request: RestoreRequest =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid workspace restore request")?;
    validate_workspace_id(&request.workspace_id)?;
    validate_backup_id(&request.backup_id)?;
    if request.request_id.len() != 32
        || !request
            .request_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("Invalid workspace restore request ID".into());
    }
    Ok(Some(request))
}

/// Caller holds the request lock while deciding whether to publish.
pub(super) fn enqueue(
    system_root: &Path,
    workspace_id: &str,
    backup_id: &str,
) -> Result<RestoreRequest, String> {
    validate_workspace_id(workspace_id)?;
    validate_backup_id(backup_id)?;
    if let Some(request) = read(system_root)? {
        return if request.workspace_id == workspace_id && request.backup_id == backup_id {
            Ok(request)
        } else {
            Err("Another workspace restore is already queued".into())
        };
    }
    let request = RestoreRequest {
        request_id: uuid::Uuid::new_v4().simple().to_string(),
        workspace_id: workspace_id.to_owned(),
        backup_id: backup_id.to_owned(),
    };
    let temporary = system_root.join(TEMPORARY);
    // A process can exit while writing the unpublished request. Remove only a
    // regular temp file left in this locked system root.
    match fs::symlink_metadata(&temporary) {
        Ok(metadata) if metadata.is_file() && !is_reparse_point(&metadata) => {
            fs::remove_file(&temporary).map_err(|error| error.to_string())?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        _ => return Err("Cannot inspect unpublished workspace restore request".into()),
    }
    let bytes = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|error| error.to_string())?;
    drop(file);
    fs::rename(&temporary, system_root.join(REQUEST)).map_err(|error| error.to_string())?;
    Ok(request)
}

pub(super) fn complete(
    system_root: &Path,
    request: RestoreRequest,
    report: RestoreReport,
) -> Result<(), String> {
    let outcome = RestoreOutcome {
        request_id: request.request_id,
        workspace_id: request.workspace_id,
        report,
    };
    let temporary = system_root.join("workspace-restore-result.tmp");
    if let Ok(metadata) = fs::symlink_metadata(&temporary) {
        if !metadata.is_file() || is_reparse_point(&metadata) {
            return Err("Cannot inspect unpublished workspace restore result".into());
        }
        fs::remove_file(&temporary).map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec(&outcome).map_err(|error| error.to_string())?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|error| error.to_string())?;
    drop(file);
    fs::rename(&temporary, system_root.join(RESULT)).map_err(|error| error.to_string())?;
    fs::remove_file(system_root.join(REQUEST)).map_err(|error| error.to_string())
}

pub(super) fn outcome(system_root: &Path) -> Result<Option<RestoreOutcome>, String> {
    let path = system_root.join(RESULT);
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Ok(metadata)
            if metadata.is_file() && !is_reparse_point(&metadata) && metadata.len() < 4096 =>
        {
            let bytes = fs::read(path).map_err(|error| error.to_string())?;
            serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|error| error.to_string())
        }
        _ => Err("Cannot inspect workspace restore result".into()),
    }
}

/// Called under the system request lock, after the transaction is reconciled.
pub(super) fn cancel(system_root: &Path, request: &RestoreRequest) -> Result<(), String> {
    let receipt = system_root.join(format!(
        "workspace-restore-cancelled-{}.json",
        request.request_id
    ));
    match fs::symlink_metadata(&receipt) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        _ => return Err("Cannot publish workspace restore cancellation receipt".into()),
    }
    fs::rename(system_root.join(REQUEST), receipt)
        .map_err(|error| format!("Cannot cancel workspace restore request: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_reuses_published_request_and_cannot_replace_another() {
        let scratch = Path::new(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
        fs::create_dir_all(&scratch).unwrap();
        let root = scratch.canonicalize().unwrap().join(format!(
            "issue-31-request-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir(&root).unwrap();
        fs::write(
            root.join("owner.txt"),
            "Issue #31 synthetic restore request test",
        )
        .unwrap();
        fs::write(root.join(TEMPORARY), b"incomplete write").unwrap();
        assert!(read(&root).unwrap().is_none());
        let first = enqueue(&root, "workspace", "backup-one").unwrap();
        let retry = enqueue(&root, "workspace", "backup-one").unwrap();
        assert_eq!(first.request_id, retry.request_id);
        assert!(enqueue(&root, "workspace", "backup-two").is_err());
        assert_eq!(read(&root).unwrap().unwrap().backup_id, "backup-one");
        fs::remove_dir_all(root).unwrap();
    }
}
