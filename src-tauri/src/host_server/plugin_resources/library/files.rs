use super::*;
use std::{fs, io::Read, path::Path};
const PROFILE: &str = "resource.save.draft1";
const MAX_BYTES: u64 = 32 * 1024 * 1024;
fn uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}
fn hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn ordinary(path: &Path, directory: bool) -> Result<fs::Metadata, ApiError> {
    let meta = fs::symlink_metadata(path).map_err(|_| rejected("saved_output_unavailable"))?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err(rejected("saved_output_unsafe"));
        }
    }
    if meta.file_type().is_symlink()
        || (directory && !meta.is_dir())
        || (!directory && !meta.is_file())
    {
        return Err(rejected("saved_output_unsafe"));
    }
    Ok(meta)
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Source {
    plugin_id: String,
    capability_id: String,
    resource_id: String,
    package_version: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt {
    schema_version: u32,
    profile: String,
    save_id: String,
    workspace_id: String,
    relative_path: String,
    mime_type: String,
    byte_length: u64,
    content_version: String,
    prepared_at: String,
    source: Source,
}
struct Entry {
    receipt: Receipt,
    version: String,
    filename: String,
}
fn bounded(path: &Path, limit: u64) -> Result<Vec<u8>, ApiError> {
    if ordinary(path, false)?.len() > limit {
        return Err(rejected("saved_output_changed"));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| rejected("saved_output_unavailable"))?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| rejected("saved_output_unavailable"))?;
    if bytes.len() as u64 > limit {
        return Err(rejected("saved_output_changed"));
    }
    Ok(bytes)
}
fn recorded(root: &Path, workspace: &str, id: &str, name: &str) -> Result<Entry, ApiError> {
    if !uuid(id) {
        return Err(rejected("saved_output_unavailable"));
    }
    let folder = root.join(id);
    ordinary(&folder, true)?;
    let metadata = bounded(&folder.join(name), 8192)?;
    let receipt: Receipt =
        serde_json::from_slice(&metadata).map_err(|_| rejected("saved_output_unsafe"))?;
    let extension = crate::plugin_output_types::extension(&receipt.mime_type)
        .ok_or_else(|| rejected("saved_output_unsafe"))?;
    let filename = format!("result.{extension}");
    if receipt.schema_version != 1
        || receipt.profile != PROFILE
        || receipt.save_id != id
        || receipt.workspace_id != workspace
        || receipt.relative_path != format!(".zicode/outputs/{id}/{filename}")
        || receipt.byte_length > MAX_BYTES
        || !hash(&receipt.content_version)
        || chrono::DateTime::parse_from_rfc3339(&receipt.prepared_at).is_err()
        || !uuid(&receipt.source.resource_id)
        || [
            &receipt.source.plugin_id,
            &receipt.source.capability_id,
            &receipt.source.package_version,
        ]
        .iter()
        .any(|v| v.is_empty() || v.len() > 256 || v.chars().any(char::is_control))
    {
        return Err(rejected("saved_output_unsafe"));
    }
    Ok(Entry {
        receipt,
        version: sha256_hex(&metadata),
        filename,
    })
}
fn entry(root: &Path, workspace: &str, id: &str) -> Result<Entry, ApiError> {
    let result = recorded(root, workspace, id, "receipt.json")?;
    if ordinary(&root.join(id).join(&result.filename), false)?.len() != result.receipt.byte_length {
        return Err(rejected("saved_output_changed"));
    }
    Ok(result)
}
fn root(workspace: &Path) -> Result<Option<PathBuf>, ApiError> {
    // Never create directories on library access.
    ordinary(workspace, true)?;
    let mut path = workspace.to_path_buf();
    for component in [".zicode", "outputs"] {
        path.push(component);
        match fs::symlink_metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            _ => {
                ordinary(&path, true)?;
            }
        }
    }
    Ok(Some(path))
}
pub(super) fn list(
    workspace: &Path,
    workspace_id: &str,
    query: &str,
    offset: usize,
) -> Result<Value, ApiError> {
    let mut rows = Vec::new();
    let mut skipped = 0;
    if let Some(root) = root(workspace)? {
        for (index, item) in fs::read_dir(&root)
            .map_err(|_| rejected("saved_output_unavailable"))?
            .take(129)
            .enumerate()
        {
            if index >= 128 {
                return Err(rejected("resource_save_quota_exceeded"));
            }
            let item = item.map_err(|_| rejected("saved_output_unavailable"))?;
            let id = item.file_name().to_string_lossy().into_owned();
            match entry(&root, workspace_id, &id) {
                Ok(entry) => rows.push(entry),
                Err(_) => skipped += 1,
            }
        }
    }
    rows.sort_by(|a, b| {
        b.receipt
            .prepared_at
            .cmp(&a.receipt.prepared_at)
            .then(a.receipt.save_id.cmp(&b.receipt.save_id))
    });
    let query = query.trim().to_lowercase();
    rows.retain(|r| {
        format!(
            "{} {} {} {}",
            r.receipt.relative_path,
            r.receipt.mime_type,
            r.receipt.source.plugin_id,
            r.receipt.source.capability_id
        )
        .to_lowercase()
        .contains(&query)
    });
    let total = rows.len();
    let items: Vec<Value> = rows
        .into_iter()
        .skip(offset)
        .take(40)
        .map(|r| json!({"receipt":r.receipt,"receiptVersion":r.version,"integrity":"not_checked"}))
        .collect();
    Ok(
        json!({"schemaVersion":1,"profile":"resource.library.draft1","workspaceId":workspace_id,"items":items,"total":total,
        "offset":offset,"pageSize":40,"hasMore":offset.saturating_add(40)<total,"skippedEntries":skipped,"payloadsRead":false}),
    )
}
pub(super) fn read(
    workspace: &Path,
    workspace_id: &str,
    id: &str,
    version: &str,
) -> Result<(Vec<u8>, String), ApiError> {
    if !hash(version) {
        return Err(rejected("saved_output_changed"));
    }
    let root = root(workspace)?.ok_or_else(|| rejected("saved_output_unavailable"))?;
    let entry = entry(&root, workspace_id, id)?;
    if entry.version != version {
        return Err(rejected("saved_output_changed"));
    }
    let bytes = bounded(&root.join(id).join(&entry.filename), MAX_BYTES)?;
    if bytes.len() as u64 != entry.receipt.byte_length
        || sha256_hex(&bytes) != entry.receipt.content_version
    {
        return Err(rejected("saved_output_changed"));
    }
    // Detect receipt replacement during the read; callers also recheck current project authority.
    if sha256_hex(&bounded(&root.join(id).join("receipt.json"), 8192)?) != version {
        return Err(rejected("saved_output_changed"));
    }
    Ok((bytes, entry.filename))
}

// Recovery metadata is independent of volatile resource/grant/runtime state.
// "not_observed" is deliberately not a claim that the save failed or ended.
pub(super) fn attempts(
    workspace: &Path,
    workspace_id: &str,
    query: &str,
    offset: usize,
) -> Result<Value, ApiError> {
    let mut rows = Vec::new();
    let mut skipped = 0;
    if let Some(root) = root(workspace)? {
        for (index, item) in fs::read_dir(&root)
            .map_err(|_| rejected("saved_output_unavailable"))?
            .take(129)
            .enumerate()
        {
            if index >= 128 {
                return Err(rejected("resource_save_quota_exceeded"));
            }
            let item = item.map_err(|_| rejected("saved_output_unavailable"))?;
            let id = item.file_name().to_string_lossy().into_owned();
            let (name, publication) = match fs::symlink_metadata(item.path().join("receipt.json")) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    (".receipt.pending", "not_observed")
                }
                _ => ("receipt.json", "observed"),
            };
            // Never fall back to an older pending record when a published receipt is unsafe.
            match recorded(&root, workspace_id, &id, name) {
                Ok(record) => rows.push((record, publication)),
                Err(_) => skipped += 1,
            }
        }
    }
    rows.sort_by(|a, b| {
        b.0.receipt
            .prepared_at
            .cmp(&a.0.receipt.prepared_at)
            .then(a.0.receipt.save_id.cmp(&b.0.receipt.save_id))
    });
    let query = query.trim().to_lowercase();
    rows.retain(|(r, _)| {
        format!(
            "{} {} {} {}",
            r.receipt.relative_path,
            r.receipt.mime_type,
            r.receipt.source.plugin_id,
            r.receipt.source.capability_id
        )
        .to_lowercase()
        .contains(&query)
    });
    let total = rows.len();
    let items: Vec<Value> = rows.into_iter().skip(offset).take(40).map(|(r, publication)| json!({"receipt":r.receipt,"receiptVersion":r.version,"integrity":"not_checked","publication":publication})).collect();
    Ok(
        json!({"schemaVersion":1,"profile":"resource.save.recovery.draft1","workspaceId":workspace_id,"items":items,"total":total,
        "offset":offset,"pageSize":40,"hasMore":offset.saturating_add(40)<total,"skippedEntries":skipped,"payloadsRead":false}),
    )
}
