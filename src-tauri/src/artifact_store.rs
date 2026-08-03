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

#[derive(Clone, Debug)]
pub struct ArtifactDraft {
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
        Ok(Self { root })
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
        for entry in fs::read_dir(self.root.join("items"))
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
            .root
            .join("items")
            .join(format!("{}.json", validate_artifact_id(artifact_id)?)))
    }

    fn content_path(&self, artifact_id: &str) -> Result<PathBuf, ArtifactError> {
        Ok(self.root.join("items").join(format!(
            "{}.content.json",
            validate_artifact_id(artifact_id)?
        )))
    }
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
    use super::{ArtifactDraft, ArtifactStore};
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
        let created = store
            .create(ArtifactDraft {
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
        let listed = store
            .list(
                "finance",
                Some("report"),
                Some("com.zicode.finance"),
                Some("back"),
            )
            .unwrap();
        assert_eq!(listed.artifacts.len(), 1);
        assert_eq!(
            store
                .get("finance", &created.descriptor.id)
                .unwrap()
                .content["metrics"]["totalReturn"],
            0.12
        );
        assert_eq!(
            store
                .delete("finance", &created.descriptor.id, "stale")
                .unwrap_err()
                .code,
            "version_conflict"
        );
        store
            .delete(
                "finance",
                &created.descriptor.id,
                &created.descriptor.version,
            )
            .unwrap();
        let _ = fs::remove_dir_all(root);
    }
}
