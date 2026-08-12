use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const ARTIFACT_PLUGIN_ID: &str = "com.zicode.artifacts";
const MAX_ARTIFACTS: usize = 2_000;
const MAX_CONTENT_BYTES: usize = 1024 * 1024;
const MAX_PROVENANCE_BYTES: usize = 32 * 1024;
const MAX_TITLE_CHARS: usize = 200;
const MAX_SUMMARY_CHARS: usize = 1_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactDescriptor {
    pub id: String,
    pub handle: String,
    #[serde(default)]
    pub workspace_id: String,
    pub scene_id: String,
    pub plugin_id: String,
    pub kind: String,
    pub title: String,
    pub summary: String,
    pub created_at: String,
    pub mime_type: String,
    pub size: usize,
    pub version: String,
    #[serde(default)]
    pub provenance: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactDocument {
    #[serde(flatten)]
    pub descriptor: ArtifactDescriptor,
    pub content: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSnapshot {
    pub artifacts: Vec<ArtifactDescriptor>,
    pub kinds: Vec<String>,
    pub plugins: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactMigrationReport {
    pub claimed_workspace_id: String,
    pub moved_artifacts: usize,
    pub skipped: bool,
}

#[derive(Clone, Debug)]
pub struct ArtifactDraft {
    pub workspace_id: String,
    pub scene_id: String,
    pub plugin_id: String,
    pub kind: String,
    pub title: String,
    pub summary: String,
    pub mime_type: String,
    pub provenance: Value,
    pub content: Value,
}

#[derive(Clone, Debug)]
pub struct ArtifactError {
    pub code: &'static str,
    pub message: String,
}

impl ArtifactError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Clone)]
pub struct ArtifactStore {
    root: PathBuf,
    workspace_id: Option<String>,
    workspace_roots:
        Option<std::sync::Arc<std::sync::RwLock<std::collections::HashMap<String, PathBuf>>>>,
    system_root: Option<PathBuf>,
}

impl ArtifactStore {
    pub fn new(plugin_root: PathBuf) -> Result<Self, String> {
        let root = plugin_root
            .parent()
            .unwrap_or(&plugin_root)
            .join("plugin-data")
            .join(ARTIFACT_PLUGIN_ID);
        fs::create_dir_all(root.join("items"))
            .map_err(|error| format!("Cannot create Artifacts data directory: {error}"))?;
        Ok(Self {
            root,
            workspace_id: None,
            workspace_roots: None,
            system_root: None,
        })
    }

    /// Point workspace-scoped stores at `<workspace>/.zicode/artifacts`
    /// instead of the app-data plugin directory. Unregistered workspaces keep
    /// the legacy layout so the store stays readable in tests and during
    /// migration.
    pub fn with_workspace_registry(
        mut self,
        workspace_roots: std::sync::Arc<
            std::sync::RwLock<std::collections::HashMap<String, PathBuf>>,
        >,
        system_root: PathBuf,
    ) -> Self {
        self.workspace_roots = Some(workspace_roots);
        self.system_root = Some(system_root);
        self
    }

    /// Return a workspace-scoped view over `items/<workspaceId>/`.
    ///
    /// The first scoped access claims legacy artifact files that predate
    /// workspace attribution (one-time migration guarded by a marker file).
    pub fn scoped(&self, workspace_id: &str) -> Result<ArtifactStore, ArtifactError> {
        let workspace_id = validate_workspace_id(workspace_id)?;
        let items = self.root.join("items");
        let items_dir = self.resolved_items_dir(&workspace_id, &items)?;
        fs::create_dir_all(&items_dir).map_err(|_| {
            ArtifactError::new("storage_unavailable", "Cannot create artifact directory")
        })?;
        self.migrate_legacy(&workspace_id)?;
        Ok(ArtifactStore {
            root: self.root.clone(),
            workspace_id: Some(workspace_id),
            workspace_roots: self.workspace_roots.clone(),
            system_root: self.system_root.clone(),
        })
    }

    /// Resolve the on-disk items directory for a workspace. When the registry
    /// knows the root, data lives in `<workspace>/.zicode/artifacts` and the
    /// legacy app-data directory is moved there once.
    fn resolved_items_dir(
        &self,
        workspace_id: &str,
        legacy_items: &Path,
    ) -> Result<PathBuf, ArtifactError> {
        let legacy = legacy_items.join(workspace_id);
        let Some(registry) = &self.workspace_roots else {
            return Ok(legacy);
        };
        let Some(system_root) = &self.system_root else {
            return Ok(legacy);
        };
        let Ok(roots) = registry.read() else {
            return Ok(legacy);
        };
        let Some(workspace_root) = roots.get(workspace_id) else {
            return Ok(legacy);
        };
        let resolved =
            crate::app_paths::workspace_app_dir(workspace_root, system_root).join("artifacts");
        if !resolved.exists() && legacy.is_dir() {
            if let Some(parent) = resolved.parent() {
                fs::create_dir_all(parent).map_err(|_| {
                    ArtifactError::new("storage_unavailable", "Cannot create artifact directory")
                })?;
            }
            fs::rename(&legacy, &resolved).map_err(|_| {
                ArtifactError::new("storage_unavailable", "Cannot migrate legacy artifacts")
            })?;
        }
        Ok(resolved)
    }

    /// One-time migration: move legacy artifact files (created before project
    /// attribution) under the first workspace that accesses them.
    pub fn migrate_legacy(
        &self,
        workspace_id: &str,
    ) -> Result<ArtifactMigrationReport, ArtifactError> {
        let workspace_id = validate_workspace_id(workspace_id)?;
        let items = self.root.join("items");
        if !items.exists() {
            return Ok(ArtifactMigrationReport {
                claimed_workspace_id: workspace_id,
                moved_artifacts: 0,
                skipped: true,
            });
        }
        let marker = items.join(".migrated-workspace");
        if marker.exists() {
            return Ok(ArtifactMigrationReport {
                claimed_workspace_id: workspace_id,
                moved_artifacts: 0,
                skipped: true,
            });
        }
        let workspace_dir = items.join(&workspace_id);
        fs::create_dir_all(&workspace_dir).map_err(|_| {
            ArtifactError::new("storage_unavailable", "Cannot create artifact directory")
        })?;
        let mut moved_artifacts = 0usize;
        for entry in fs::read_dir(&items)
            .map_err(|_| ArtifactError::new("storage_unavailable", "Cannot read artifacts"))?
            .flatten()
        {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_file() || file_type.is_symlink() {
                continue;
            }
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if name.starts_with('.') {
                continue;
            }
            let destination = workspace_dir.join(&name);
            if destination.exists() {
                continue;
            }
            fs::rename(entry.path(), &destination).map_err(|_| {
                ArtifactError::new("storage_unavailable", "Cannot migrate legacy artifact")
            })?;
            // Stamp the claimed workspace into migrated descriptors so the
            // metadata itself records project attribution going forward.
            if name.ends_with(".json") && !name.ends_with(".content.json") {
                if let Ok(bytes) = fs::read(&destination) {
                    if let Ok(mut descriptor) = serde_json::from_slice::<ArtifactDescriptor>(&bytes)
                    {
                        if descriptor.workspace_id.is_empty() {
                            descriptor.workspace_id = workspace_id.clone();
                            if let Ok(updated) = serde_json::to_vec_pretty(&descriptor) {
                                let _ = atomic_write(&destination, &updated);
                            }
                        }
                    }
                }
            }
            moved_artifacts += 1;
        }
        fs::write(&marker, &workspace_id).map_err(|_| {
            ArtifactError::new("storage_unavailable", "Cannot finalize artifact migration")
        })?;
        Ok(ArtifactMigrationReport {
            claimed_workspace_id: workspace_id,
            moved_artifacts,
            skipped: false,
        })
    }

    fn items_dir(&self) -> PathBuf {
        let items = self.root.join("items");
        match &self.workspace_id {
            Some(workspace_id) => self
                .resolved_items_dir(workspace_id, &items)
                .unwrap_or_else(|_| items.join(workspace_id)),
            None => items,
        }
    }

    pub fn list(
        &self,
        scene_id: &str,
        kind: Option<&str>,
        plugin_id: Option<&str>,
        query: Option<&str>,
    ) -> Result<ArtifactSnapshot, ArtifactError> {
        validate_scene_id(scene_id)?;
        let expected_kind = kind
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(validate_kind)
            .transpose()?;
        let expected_plugin = plugin_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(validate_plugin_id)
            .transpose()?;
        let query = query
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_lowercase);
        let mut artifacts = Vec::new();
        let mut kinds = std::collections::BTreeSet::new();
        let mut plugins = std::collections::BTreeSet::new();
        for entry in fs::read_dir(self.items_dir())
            .map_err(|_| ArtifactError::new("storage_unavailable", "Cannot read artifacts"))?
            .flatten()
            .take(MAX_ARTIFACTS * 2 + 1)
        {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json")
                || path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .is_some_and(|name| name.ends_with(".content.json"))
            {
                continue;
            }
            let Ok(bytes) = fs::read(&path) else {
                continue;
            };
            let Ok(descriptor) = serde_json::from_slice::<ArtifactDescriptor>(&bytes) else {
                continue;
            };
            if descriptor.scene_id != scene_id {
                continue;
            }
            kinds.insert(descriptor.kind.clone());
            plugins.insert(descriptor.plugin_id.clone());
            if expected_kind
                .as_ref()
                .is_some_and(|value| value != &descriptor.kind)
                || expected_plugin
                    .as_ref()
                    .is_some_and(|value| value != &descriptor.plugin_id)
            {
                continue;
            }
            if query.as_ref().is_some_and(|needle| {
                !format!(
                    "{}\n{}\n{}\n{}",
                    descriptor.title, descriptor.summary, descriptor.kind, descriptor.plugin_id
                )
                .to_lowercase()
                .contains(needle)
            }) {
                continue;
            }
            artifacts.push(descriptor);
        }
        artifacts.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        artifacts.truncate(MAX_ARTIFACTS);
        Ok(ArtifactSnapshot {
            artifacts,
            kinds: kinds.into_iter().collect(),
            plugins: plugins.into_iter().collect(),
        })
    }

    pub fn create(&self, draft: ArtifactDraft) -> Result<ArtifactDocument, ArtifactError> {
        let scene_id = validate_scene_id(&draft.scene_id)?;
        let plugin_id = validate_plugin_id(&draft.plugin_id)?;
        let kind = validate_kind(&draft.kind)?;
        let title = validate_text(&draft.title, MAX_TITLE_CHARS, "Artifact title")?;
        let summary = if draft.summary.trim().is_empty() {
            String::new()
        } else {
            validate_text(&draft.summary, MAX_SUMMARY_CHARS, "Artifact summary")?
        };
        let mime_type = validate_mime_type(&draft.mime_type)?;
        let provenance_bytes = serde_json::to_vec(&draft.provenance)
            .map_err(|_| ArtifactError::new("invalid_parameters", "Invalid provenance"))?;
        if provenance_bytes.len() > MAX_PROVENANCE_BYTES {
            return Err(ArtifactError::new(
                "payload_too_large",
                "Artifact provenance exceeds 32 KiB",
            ));
        }
        let content_bytes = serde_json::to_vec_pretty(&draft.content)
            .map_err(|_| ArtifactError::new("invalid_parameters", "Invalid artifact content"))?;
        if content_bytes.len() > MAX_CONTENT_BYTES {
            return Err(ArtifactError::new(
                "payload_too_large",
                "Artifact content exceeds 1 MiB",
            ));
        }
        if self.list(&scene_id, None, None, None)?.artifacts.len() >= MAX_ARTIFACTS {
            return Err(ArtifactError::new(
                "quota_exceeded",
                "The scene artifact limit has been reached",
            ));
        }
        let id = Uuid::new_v4().to_string();
        let descriptor = ArtifactDescriptor {
            id: id.clone(),
            handle: format!("artifact:{id}"),
            workspace_id: validate_workspace_id(&draft.workspace_id)?,
            scene_id,
            plugin_id,
            kind,
            title,
            summary,
            created_at: now_iso(),
            mime_type,
            size: content_bytes.len(),
            version: version_for(&content_bytes),
            provenance: draft.provenance,
        };
        atomic_write(&self.content_path(&id)?, &content_bytes)?;
        let metadata = serde_json::to_vec_pretty(&descriptor)
            .map_err(|_| ArtifactError::new("serialization_failed", "Cannot encode artifact"))?;
        if let Err(error) = atomic_write(&self.metadata_path(&id)?, &metadata) {
            let _ = fs::remove_file(self.content_path(&id)?);
            return Err(error);
        }
        Ok(ArtifactDocument {
            descriptor,
            content: draft.content,
        })
    }

    /// Restore a previously exported artifact, preserving its original id and
    /// metadata so cross-references (notes, knowledge links) keep working.
    pub fn import_document(
        &self,
        workspace_id: &str,
        document: ArtifactDocument,
    ) -> Result<ArtifactDocument, ArtifactError> {
        let descriptor = document.descriptor.clone();
        let id = validate_opaque_id(&descriptor.id)?;
        let content_bytes = serde_json::to_vec_pretty(&document.content)
            .map_err(|_| ArtifactError::new("invalid_parameters", "Invalid artifact content"))?;
        if content_bytes.len() > MAX_CONTENT_BYTES {
            return Err(ArtifactError::new(
                "payload_too_large",
                "Artifact content exceeds 1 MiB",
            ));
        }
        let content_path = self.content_path(&id)?;
        if content_path.exists() {
            // Idempotent restore: an artifact with the same id already exists.
            return Ok(document);
        }
        validate_scene_id(&descriptor.scene_id)?;
        validate_plugin_id(&descriptor.plugin_id)?;
        validate_kind(&descriptor.kind)?;
        validate_text(&descriptor.title, MAX_TITLE_CHARS, "Artifact title")?;
        if descriptor.summary.trim().len().saturating_sub(0) > MAX_SUMMARY_CHARS {
            return Err(ArtifactError::new(
                "invalid_parameters",
                "Artifact summary exceeds the limit",
            ));
        }
        validate_mime_type(&descriptor.mime_type)?;
        if self
            .list(&descriptor.scene_id, None, None, None)?
            .artifacts
            .len()
            >= MAX_ARTIFACTS
        {
            return Err(ArtifactError::new(
                "quota_exceeded",
                "The scene artifact limit has been reached",
            ));
        }
        atomic_write(&content_path, &content_bytes)?;
        let mut restored = document;
        restored.descriptor.workspace_id = validate_workspace_id(workspace_id)?;
        restored.descriptor.size = content_bytes.len();
        let metadata = serde_json::to_vec_pretty(&restored.descriptor)
            .map_err(|_| ArtifactError::new("serialization_failed", "Cannot encode artifact"))?;
        if let Err(error) = atomic_write(&self.metadata_path(&id)?, &metadata) {
            let _ = fs::remove_file(&content_path);
            return Err(error);
        }
        Ok(restored)
    }

    /// Restore a workspace-level artifact bundle produced by the bulk export.
    /// Returns the number of artifacts actually written (existing ids skipped).
    pub fn import_all(
        &self,
        workspace_id: &str,
        documents: Vec<ArtifactDocument>,
    ) -> Result<usize, ArtifactError> {
        let mut imported = 0usize;
        for document in documents {
            let id = validate_opaque_id(&document.descriptor.id)?;
            if self.content_path(&id)?.exists() {
                continue;
            }
            self.import_document(workspace_id, document)?;
            imported += 1;
        }
        Ok(imported)
    }

    pub fn get(
        &self,
        scene_id: &str,
        artifact_id: &str,
    ) -> Result<ArtifactDocument, ArtifactError> {
        validate_scene_id(scene_id)?;
        let id = validate_artifact_id(artifact_id)?;
        let metadata = fs::read(self.metadata_path(&id)?)
            .map_err(|_| ArtifactError::new("artifact_not_found", "Artifact does not exist"))?;
        let descriptor: ArtifactDescriptor = serde_json::from_slice(&metadata)
            .map_err(|_| ArtifactError::new("artifact_corrupt", "Artifact metadata is damaged"))?;
        if descriptor.scene_id != scene_id || descriptor.id != id {
            return Err(ArtifactError::new(
                "artifact_not_found",
                "Artifact does not exist in this scene",
            ));
        }
        let content_bytes = fs::read(self.content_path(&id)?)
            .map_err(|_| ArtifactError::new("artifact_corrupt", "Artifact content is missing"))?;
        if content_bytes.len() > MAX_CONTENT_BYTES
            || version_for(&content_bytes) != descriptor.version
        {
            return Err(ArtifactError::new(
                "artifact_corrupt",
                "Artifact content failed integrity validation",
            ));
        }
        let content = serde_json::from_slice(&content_bytes)
            .map_err(|_| ArtifactError::new("artifact_corrupt", "Artifact content is invalid"))?;
        Ok(ArtifactDocument {
            descriptor,
            content,
        })
    }

    pub fn delete(
        &self,
        scene_id: &str,
        artifact_id: &str,
        expected_version: &str,
    ) -> Result<(), ArtifactError> {
        let document = self.get(scene_id, artifact_id)?;
        if expected_version.is_empty() || document.descriptor.version != expected_version {
            return Err(ArtifactError::new(
                "version_conflict",
                "Artifact changed after it was opened",
            ));
        }
        let id = document.descriptor.id;
        fs::remove_file(self.metadata_path(&id)?)
            .map_err(|_| ArtifactError::new("storage_unavailable", "Cannot delete artifact"))?;
        fs::remove_file(self.content_path(&id)?)
            .map_err(|_| ArtifactError::new("storage_unavailable", "Cannot delete artifact data"))
    }

    fn metadata_path(&self, artifact_id: &str) -> Result<PathBuf, ArtifactError> {
        Ok(self
            .items_dir()
            .join(format!("{}.json", validate_artifact_id(artifact_id)?)))
    }

    fn content_path(&self, artifact_id: &str) -> Result<PathBuf, ArtifactError> {
        Ok(self.items_dir().join(format!(
            "{}.content.json",
            validate_artifact_id(artifact_id)?
        )))
    }
}

fn validate_workspace_id(value: &str) -> Result<String, ArtifactError> {
    Uuid::parse_str(value)
        .map(|id| id.to_string())
        .map_err(|_| ArtifactError::new("invalid_parameters", "Invalid workspace ID"))
}

fn validate_artifact_id(value: &str) -> Result<String, ArtifactError> {
    Uuid::parse_str(value)
        .map(|id| id.to_string())
        .map_err(|_| ArtifactError::new("invalid_parameters", "Invalid artifact ID"))
}

fn validate_scene_id(value: &str) -> Result<String, ArtifactError> {
    validate_identifier(value, "scene ID")
}

fn validate_plugin_id(value: &str) -> Result<String, ArtifactError> {
    validate_identifier(value, "plugin ID")
}

fn validate_identifier(value: &str, label: &str) -> Result<String, ArtifactError> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'));
    if !valid {
        return Err(ArtifactError::new(
            "invalid_parameters",
            format!("Invalid {label}"),
        ));
    }
    Ok(value.to_string())
}

fn validate_kind(value: &str) -> Result<String, ArtifactError> {
    match value {
        "report" | "chart" | "dataset" | "file" => Ok(value.to_string()),
        _ => Err(ArtifactError::new(
            "invalid_parameters",
            "Artifact kind must be report, chart, dataset, or file",
        )),
    }
}

fn validate_mime_type(value: &str) -> Result<String, ArtifactError> {
    match value {
        "application/json" | "text/markdown" | "text/plain" => Ok(value.to_string()),
        _ => Err(ArtifactError::new(
            "invalid_parameters",
            "Artifact MIME type is not allowed",
        )),
    }
}

fn validate_text(value: &str, maximum: usize, label: &str) -> Result<String, ArtifactError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > maximum || value.chars().any(char::is_control) {
        return Err(ArtifactError::new(
            "invalid_parameters",
            format!("{label} is invalid"),
        ));
    }
    Ok(value.to_string())
}

fn validate_opaque_id(value: &str) -> Result<String, ArtifactError> {
    if value.len() > 128
        || value.is_empty()
        || value
            .chars()
            .any(|ch| !ch.is_ascii_alphanumeric() && ch != '-' && ch != '_')
    {
        return Err(ArtifactError::new(
            "invalid_parameters",
            "Artifact id is invalid",
        ));
    }
    Ok(value.to_string())
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn version_for(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!(
        "sha256:{}",
        digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    )
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), ArtifactError> {
    let parent = path
        .parent()
        .ok_or_else(|| ArtifactError::new("storage_unavailable", "Invalid artifact path"))?;
    fs::create_dir_all(parent).map_err(|_| {
        ArtifactError::new("storage_unavailable", "Cannot create artifact directory")
    })?;
    let temporary = parent.join(format!(".write-{}.tmp", Uuid::new_v4().simple()));
    fs::write(&temporary, bytes)
        .map_err(|_| ArtifactError::new("storage_unavailable", "Cannot write artifact"))?;
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(ArtifactError::new(
            "storage_unavailable",
            format!("Cannot finish artifact write: {error}"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ArtifactDocument, ArtifactDraft, ArtifactStore};
    use serde_json::json;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn creates_lists_reads_and_version_deletes_opaque_artifacts() {
        let root = std::env::temp_dir().join(format!(
            "zicode-artifacts-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = ArtifactStore::new(root.join("plugins")).unwrap();
        let workspace_id = "11111111-1111-4111-8111-111111111111";
        let scoped = store.scoped(workspace_id).unwrap();
        let created = scoped
            .create(ArtifactDraft {
                workspace_id: workspace_id.into(),
                scene_id: "finance".into(),
                plugin_id: "com.zicode.finance".into(),
                kind: "report".into(),
                title: "Backtest".into(),
                summary: "Deterministic result".into(),
                mime_type: "application/json".into(),
                provenance: json!({"executionId": "local-1"}),
                content: json!({"metrics": {"totalReturn": 0.12}}),
            })
            .unwrap();
        assert!(created.descriptor.handle.starts_with("artifact:"));
        assert_eq!(created.descriptor.workspace_id, workspace_id);
        let listed = scoped
            .list(
                "finance",
                Some("report"),
                Some("com.zicode.finance"),
                Some("back"),
            )
            .unwrap();
        assert_eq!(listed.artifacts.len(), 1);
        assert_eq!(
            scoped
                .get("finance", &created.descriptor.id)
                .unwrap()
                .content["metrics"]["totalReturn"],
            0.12
        );
        assert_eq!(
            scoped
                .delete("finance", &created.descriptor.id, "stale")
                .unwrap_err()
                .code,
            "version_conflict"
        );
        scoped
            .delete(
                "finance",
                &created.descriptor.id,
                &created.descriptor.version,
            )
            .unwrap();
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn legacy_flat_items_are_claimed_by_the_first_scoped_workspace() {
        let root = std::env::temp_dir().join(format!(
            "zicode-artifacts-migrate-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = ArtifactStore::new(root.join("plugins")).unwrap();
        let items = root
            .join("plugin-data")
            .join("com.zicode.artifacts")
            .join("items");
        fs::create_dir_all(&items).unwrap();
        fs::write(
            items.join("legacy-id.json"),
            serde_json::to_vec(&serde_json::json!({
                "id": "legacy-id",
                "handle": "artifact:legacy-id",
                "workspaceId": "",
                "sceneId": "finance",
                "pluginId": "com.zicode.finance",
                "kind": "report",
                "title": "Legacy",
                "summary": "",
                "createdAt": "2026-01-01T00:00:00Z",
                "mimeType": "application/json",
                "size": 1,
                "version": "sha256:test",
                "provenance": {}
            }))
            .unwrap(),
        )
        .unwrap();
        let workspace_id = "22222222-2222-4222-8222-222222222222";
        let report = store.migrate_legacy(workspace_id).unwrap();
        assert_eq!(report.moved_artifacts, 1);
        assert!(items.join(workspace_id).join("legacy-id.json").is_file());
        assert!(!items.join("legacy-id.json").exists());
        // Idempotent: a second call skips without moving anything.
        let again = store.migrate_legacy(workspace_id).unwrap();
        assert!(again.skipped);
        // Stamped descriptor carries the claimed workspace.
        let migrated: serde_json::Value = serde_json::from_slice(
            &fs::read(items.join(workspace_id).join("legacy-id.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(migrated["workspaceId"], workspace_id);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn restores_exported_artifacts_preserving_ids_and_content() {
        let root = std::env::temp_dir().join(format!(
            "zicode-artifacts-restore-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let workspace_a = "11111111-1111-4111-8111-111111111111";
        let workspace_b = "22222222-2222-4222-8222-222222222222";
        let source = ArtifactStore::new(root.join("source")).unwrap();
        let created = source
            .scoped(workspace_a)
            .unwrap()
            .create(ArtifactDraft {
                workspace_id: workspace_a.into(),
                scene_id: "finance".into(),
                plugin_id: "com.zicode.finance".into(),
                kind: "report".into(),
                title: "Backtest".into(),
                summary: "Deterministic result".into(),
                mime_type: "application/json".into(),
                provenance: json!({ "engine": "local" }),
                content: json!({ "metrics": { "totalReturn": 0.12 } }),
            })
            .unwrap();
        let exported = source
            .scoped(workspace_a)
            .unwrap()
            .get("finance", &created.descriptor.id)
            .unwrap();

        let target = ArtifactStore::new(root.join("target")).unwrap();
        let imported_count = target
            .scoped(workspace_b)
            .unwrap()
            .import_all(
                workspace_b,
                vec![ArtifactDocument {
                    descriptor: exported.descriptor.clone(),
                    content: exported.content.clone(),
                }],
            )
            .unwrap();
        assert_eq!(imported_count, 1);
        let restored = target
            .scoped(workspace_b)
            .unwrap()
            .get("finance", &created.descriptor.id)
            .unwrap();
        assert_eq!(restored.descriptor.id, created.descriptor.id);
        assert_eq!(restored.descriptor.handle, created.descriptor.handle);
        assert_eq!(restored.descriptor.title, "Backtest");
        assert_eq!(restored.content["metrics"]["totalReturn"], json!(0.12));
        // A second import is idempotent and reports zero new artifacts.
        let again = target
            .scoped(workspace_b)
            .unwrap()
            .import_all(workspace_b, vec![exported])
            .unwrap();
        assert_eq!(again, 0);
        let _ = fs::remove_dir_all(root);
    }
}
