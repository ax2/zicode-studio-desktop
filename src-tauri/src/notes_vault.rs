use base64::Engine;
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};
use uuid::Uuid;

const NOTES_PLUGIN_ID: &str = "com.zicode.notes";
const VAULT_SCHEMA_VERSION: u32 = 1;
const MAX_NOTE_BYTES: usize = 1024 * 1024;
const MAX_NOTES: usize = 2_000;
const MAX_NOTEBOOKS: usize = 200;
const MAX_TITLE_CHARS: usize = 200;
const MAX_ICON_CHARS: usize = 8;
const MAX_TAGS: usize = 20;
const MAX_TAG_CHARS: usize = 64;
const MAX_ATTACHMENT_BYTES: usize = 5 * 1024 * 1024;
const MAX_EXPORT_ATTACHMENT_BYTES: usize = 50 * 1024 * 1024;
const MAX_CHANGE_LOG_BYTES: u64 = 10 * 1024 * 1024;
const RETAINED_CHANGE_RECORDS: usize = 10_000;
const TRASH_RETENTION_DAYS: u64 = 30;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookDescriptor {
    pub id: String,
    #[serde(default)]
    pub workspace_id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub note_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSource {
    pub url: String,
    pub captured_at: String,
    pub content_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: String,
    pub notebook_id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<NoteSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
    pub version: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDocument {
    #[serde(flatten)]
    pub summary: NoteSummary,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub notebook_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notebook_title: Option<String>,
    pub note: NoteSummary,
    pub deleted_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesSnapshot {
    pub notebooks: Vec<NotebookDescriptor>,
    pub notes: Vec<NoteSummary>,
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteKnowledgeLink {
    pub from_notebook_id: String,
    pub from_note_id: String,
    pub from_title: String,
    pub to_notebook_id: String,
    pub to_note_id: String,
    pub to_title: String,
    pub kind: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarNotePair {
    pub left_notebook_id: String,
    pub left_note_id: String,
    pub left_title: String,
    pub right_notebook_id: String,
    pub right_note_id: String,
    pub right_title: String,
    pub score: f64,
    pub shared_tags: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteKnowledgeConflict {
    pub left_notebook_id: String,
    pub left_note_id: String,
    pub left_title: String,
    pub right_notebook_id: String,
    pub right_note_id: String,
    pub right_title: String,
    pub reason: String,
    pub source_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesKnowledgeSnapshot {
    pub links: Vec<NoteKnowledgeLink>,
    pub similar: Vec<SimilarNotePair>,
    pub conflicts: Vec<NoteKnowledgeConflict>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteChange {
    pub cursor: String,
    pub operation: String,
    pub notebook_id: String,
    pub note_id: String,
    pub version: Option<String>,
    pub changed_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesChangeSnapshot {
    pub changes: Vec<NoteChange>,
    pub next_cursor: Option<String>,
    pub reset_required: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentDescriptor {
    pub id: String,
    pub note_id: String,
    pub file_name: String,
    pub mime_type: String,
    pub size: usize,
    pub public_path: String,
    pub markdown: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultExportAttachment {
    pub note_id: String,
    pub file_name: String,
    pub mime_type: String,
    pub data_base64: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultExport {
    pub schema_version: u32,
    pub exported_at: String,
    pub notebook: NotebookDescriptor,
    pub notes: Vec<NoteDocument>,
    #[serde(default)]
    pub trashed_notes: Vec<TrashNoteExport>,
    pub attachments: Vec<VaultExportAttachment>,
}

/// A workspace-level archival bundle produced by `export_all_notebooks` and
/// accepted by `import_all_export` for one-shot restores.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultExportBundle {
    pub schema_version: u32,
    #[serde(default)]
    pub notebooks: Vec<VaultExport>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashNoteExport {
    pub note: NoteDocument,
    pub deleted_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultRebuildReport {
    pub notebook_id: String,
    pub valid_notes: usize,
    pub invalid_files: Vec<VaultInvalidFile>,
    pub orphan_attachment_directories: Vec<String>,
    pub rebuilt_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesMigrationReport {
    pub claimed_workspace_id: String,
    pub moved_notebooks: usize,
    pub skipped: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AstroPublishReport {
    pub notebook_id: String,
    pub note_count: usize,
    pub output_directory: String,
    pub built_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInvalidFile {
    pub file_name: String,
    pub error: String,
}

#[derive(Clone, Debug)]
pub struct NotesError {
    pub code: &'static str,
    pub message: String,
}

impl NotesError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Clone)]
pub struct NotesVault {
    root: PathBuf,
    workspace_id: Option<String>,
    workspace_roots:
        Option<std::sync::Arc<std::sync::RwLock<std::collections::HashMap<String, PathBuf>>>>,
    system_root: Option<PathBuf>,
}

fn snippet_for(content: &str, needle: &str) -> Option<String> {
    let needle = needle.trim();
    if needle.is_empty() {
        return None;
    }
    let lower = content.to_lowercase();
    let index = lower.find(&needle.to_lowercase())?;
    let start = index.saturating_sub(40);
    let end = (index + needle.len() + 80).min(content.len());
    let mut snippet = content[start..end].trim().to_string();
    if start > 0 {
        snippet.insert(0, '…');
    }
    if end < content.len() {
        snippet.push('…');
    }
    Some(snippet)
}

impl NotesVault {
    pub fn new(plugin_root: PathBuf) -> Result<Self, String> {
        let root = plugin_root
            .parent()
            .unwrap_or(&plugin_root)
            .join("plugin-data")
            .join(NOTES_PLUGIN_ID);
        fs::create_dir_all(root.join("vaults"))
            .map_err(|error| format!("Cannot create Notes data directory: {error}"))?;
        Ok(Self {
            root,
            workspace_id: None,
            workspace_roots: None,
            system_root: None,
        })
    }

    /// Point workspace-scoped vaults at `<workspace>/.zicode/notes` instead of
    /// the app-data plugin directory. Unregistered workspaces keep the legacy
    /// layout so the store stays readable in tests and during migration.
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

    /// Return a workspace-scoped view over `vaults/<workspaceId>/`.
    ///
    /// The first scoped access claims legacy vault directories that predate
    /// workspace attribution (one-time migration guarded by a marker file).
    pub fn scoped(&self, workspace_id: &str) -> Result<NotesVault, NotesError> {
        let workspace_id = validate_opaque_id(workspace_id)?;
        let vaults = self.root.join("vaults");
        let vault_dir = self.resolved_vault_dir(&workspace_id, &vaults)?;
        fs::create_dir_all(&vault_dir)
            .map_err(|_| NotesError::new("storage_unavailable", "Notes storage is unavailable"))?;
        self.migrate_legacy(&workspace_id)?;
        Ok(NotesVault {
            root: self.root.clone(),
            workspace_id: Some(workspace_id),
            workspace_roots: self.workspace_roots.clone(),
            system_root: self.system_root.clone(),
        })
    }

    /// Resolve the on-disk vault directory for a workspace. When the
    /// workspace registry knows the root, data lives in
    /// `<workspace>/.zicode/notes` and the legacy app-data vault is moved
    /// there once. Otherwise the legacy `vaults/<id>` path is used.
    fn resolved_vault_dir(
        &self,
        workspace_id: &str,
        legacy_vaults: &Path,
    ) -> Result<PathBuf, NotesError> {
        let legacy = legacy_vaults.join(workspace_id);
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
            crate::app_paths::workspace_app_dir(workspace_root, system_root).join("notes");
        if !resolved.exists() && legacy.is_dir() {
            if let Some(parent) = resolved.parent() {
                fs::create_dir_all(parent).map_err(|_| {
                    NotesError::new("storage_unavailable", "Notes storage is unavailable")
                })?;
            }
            fs::rename(&legacy, &resolved).map_err(|_| {
                NotesError::new("storage_unavailable", "Cannot migrate legacy notes")
            })?;
        }
        Ok(resolved)
    }

    /// One-time migration: move legacy notebook directories (created before
    /// project attribution) under the first workspace that accesses them.
    ///
    /// A marker file makes the claim idempotent across restarts. Directories
    /// that already live under a workspace (or a marker that names a different
    /// workspace) are left untouched.
    pub fn migrate_legacy(&self, workspace_id: &str) -> Result<NotesMigrationReport, NotesError> {
        let workspace_id = validate_opaque_id(workspace_id)?;
        let vaults = self.root.join("vaults");
        if !vaults.exists() {
            return Ok(NotesMigrationReport {
                claimed_workspace_id: workspace_id,
                moved_notebooks: 0,
                skipped: true,
            });
        }
        let marker = vaults.join(".migrated-workspace");
        if marker.exists() {
            return Ok(NotesMigrationReport {
                claimed_workspace_id: workspace_id,
                moved_notebooks: 0,
                skipped: true,
            });
        }
        let workspace_dir = self.resolved_vault_dir(&workspace_id, &vaults)?;
        fs::create_dir_all(&workspace_dir)
            .map_err(|_| NotesError::new("storage_unavailable", "Notes storage is unavailable"))?;
        let mut moved_notebooks = 0usize;
        for entry in fs::read_dir(&vaults)
            .map_err(|_| NotesError::new("storage_unavailable", "Cannot read notebooks"))?
            .flatten()
        {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() || file_type.is_symlink() {
                continue;
            }
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if name.starts_with('.') || name == workspace_id {
                continue;
            }
            if validate_opaque_id(&name).is_err() {
                continue;
            }
            let destination = workspace_dir.join(&name);
            if destination.exists() {
                continue;
            }
            fs::rename(entry.path(), &destination).map_err(|_| {
                NotesError::new("storage_unavailable", "Cannot migrate legacy notebook")
            })?;
            moved_notebooks += 1;
        }
        fs::write(&marker, &workspace_id).map_err(|_| {
            NotesError::new("storage_unavailable", "Cannot finalize notes migration")
        })?;
        Ok(NotesMigrationReport {
            claimed_workspace_id: workspace_id,
            moved_notebooks,
            skipped: false,
        })
    }

    fn vaults_dir(&self) -> PathBuf {
        let vaults = self.root.join("vaults");
        match &self.workspace_id {
            Some(workspace_id) => self
                .resolved_vault_dir(workspace_id, &vaults)
                .unwrap_or_else(|_| vaults.join(workspace_id)),
            None => vaults,
        }
    }

    fn change_log_path(&self) -> PathBuf {
        self.vaults_dir().join("changes.jsonl")
    }

    pub fn list(
        &self,
        notebook_id: Option<&str>,
        query: Option<&str>,
        tag: Option<&str>,
        source_only: bool,
    ) -> Result<NotesSnapshot, NotesError> {
        let notebooks = self.list_notebooks()?;
        let selected = notebook_id.map(validate_opaque_id).transpose()?;
        let query = query
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_lowercase);
        let requested_tag = tag
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_lowercase);
        let mut notes = Vec::new();
        let mut tags = BTreeSet::new();
        for notebook in &notebooks {
            if selected.as_ref().is_some_and(|id| id != &notebook.id) {
                continue;
            }
            for mut note in self.scan_notebook_notes(&notebook.id)? {
                for candidate in &note.tags {
                    tags.insert(candidate.clone());
                }
                if source_only && note.source.is_none() {
                    continue;
                }
                if requested_tag.as_ref().is_some_and(|expected| {
                    !note
                        .tags
                        .iter()
                        .any(|candidate| candidate.to_lowercase() == *expected)
                }) {
                    continue;
                }
                if let Some(needle) = &query {
                    let document = self.get_note(&notebook.id, &note.id)?;
                    let source_url = document
                        .summary
                        .source
                        .as_ref()
                        .map(|source| source.url.as_str())
                        .unwrap_or_default();
                    if !format!(
                        "{}\n{}\n{}\n{}",
                        document.summary.title,
                        document.summary.tags.join("\n"),
                        document.content,
                        source_url
                    )
                    .to_lowercase()
                    .contains(needle)
                    {
                        continue;
                    }
                    note.snippet = snippet_for(&document.content, needle);
                }
                notes.push(note);
                if notes.len() >= MAX_NOTES {
                    break;
                }
            }
        }
        notes.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        Ok(NotesSnapshot {
            notebooks,
            notes,
            tags: tags.into_iter().collect(),
        })
    }

    pub fn knowledge(&self) -> Result<NotesKnowledgeSnapshot, NotesError> {
        let summaries = self.list(None, None, None, false)?.notes;
        let by_title: HashMap<String, &NoteSummary> = summaries
            .iter()
            .map(|note| (note.title.trim().to_lowercase(), note))
            .collect();
        let by_ref: HashMap<String, &NoteSummary> = summaries
            .iter()
            .map(|note| (format!("{}/{}", note.notebook_id, note.id), note))
            .collect();
        let mut links = Vec::new();
        let mut seen_links = BTreeSet::new();
        for source in &summaries {
            let document = self.get_note(&source.notebook_id, &source.id)?;
            for (kind, target) in extract_note_targets(&document.content, &by_title, &by_ref) {
                if target.id == source.id && target.notebook_id == source.notebook_id {
                    continue;
                }
                let key = format!(
                    "{}/{}/{}/{}/{}",
                    source.notebook_id, source.id, target.notebook_id, target.id, kind
                );
                if !seen_links.insert(key) {
                    continue;
                }
                links.push(NoteKnowledgeLink {
                    from_notebook_id: source.notebook_id.clone(),
                    from_note_id: source.id.clone(),
                    from_title: source.title.clone(),
                    to_notebook_id: target.notebook_id.clone(),
                    to_note_id: target.id.clone(),
                    to_title: target.title.clone(),
                    kind,
                });
            }
        }
        let mut similar = Vec::new();
        for (index, left) in summaries.iter().enumerate() {
            let left_tags: BTreeSet<String> =
                left.tags.iter().map(|tag| tag.to_lowercase()).collect();
            if left_tags.is_empty() {
                continue;
            }
            for right in summaries.iter().skip(index + 1) {
                let right_tags: BTreeSet<String> =
                    right.tags.iter().map(|tag| tag.to_lowercase()).collect();
                let shared_tags: Vec<String> =
                    left_tags.intersection(&right_tags).cloned().collect();
                if shared_tags.is_empty() {
                    continue;
                }
                let union_size = left_tags.union(&right_tags).count();
                similar.push(SimilarNotePair {
                    left_notebook_id: left.notebook_id.clone(),
                    left_note_id: left.id.clone(),
                    left_title: left.title.clone(),
                    right_notebook_id: right.notebook_id.clone(),
                    right_note_id: right.id.clone(),
                    right_title: right.title.clone(),
                    score: shared_tags.len() as f64 / union_size as f64,
                    shared_tags,
                });
            }
        }
        similar.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        similar.truncate(100);
        let mut conflicts = Vec::new();
        for (index, left) in summaries.iter().enumerate() {
            for right in summaries.iter().skip(index + 1) {
                if left.version == right.version {
                    continue;
                }
                let shared_source = left.source.as_ref().and_then(|left_source| {
                    right
                        .source
                        .as_ref()
                        .filter(|right_source| right_source.url == left_source.url)
                        .map(|_| left_source.url.clone())
                });
                let same_title = left.title.trim().eq_ignore_ascii_case(right.title.trim());
                if !same_title && shared_source.is_none() {
                    continue;
                }
                conflicts.push(NoteKnowledgeConflict {
                    left_notebook_id: left.notebook_id.clone(),
                    left_note_id: left.id.clone(),
                    left_title: left.title.clone(),
                    right_notebook_id: right.notebook_id.clone(),
                    right_note_id: right.id.clone(),
                    right_title: right.title.clone(),
                    reason: if shared_source.is_some() {
                        "source_changed".to_string()
                    } else {
                        "duplicate_title".to_string()
                    },
                    source_url: shared_source,
                });
            }
        }
        conflicts.truncate(100);
        Ok(NotesKnowledgeSnapshot {
            links,
            similar,
            conflicts,
        })
    }

    pub fn changes(
        &self,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<NotesChangeSnapshot, NotesError> {
        let path = self.change_log_path();
        if !path.exists() {
            return Ok(NotesChangeSnapshot {
                changes: Vec::new(),
                next_cursor: cursor.map(str::to_string),
                reset_required: cursor.is_some(),
            });
        }
        let metadata = fs::metadata(&path)
            .map_err(|_| NotesError::new("storage_unavailable", "Cannot read note changes"))?;
        if metadata.len() > MAX_CHANGE_LOG_BYTES {
            compact_change_log(&path, MAX_CHANGE_LOG_BYTES, RETAINED_CHANGE_RECORDS)?;
        }
        let text = fs::read_to_string(path)
            .map_err(|_| NotesError::new("storage_unavailable", "Cannot read note changes"))?;
        let all = text
            .lines()
            .filter_map(|line| serde_json::from_str::<NoteChange>(line).ok())
            .collect::<Vec<_>>();
        let (start, reset_required) = match cursor {
            None => (0, false),
            Some(cursor) => match all.iter().position(|change| change.cursor == cursor) {
                Some(index) => (index + 1, false),
                None => (0, true),
            },
        };
        let changes = all
            .into_iter()
            .skip(start)
            .take(limit.clamp(1, 500))
            .collect::<Vec<_>>();
        let next_cursor = changes
            .last()
            .map(|change| change.cursor.clone())
            .or_else(|| cursor.map(str::to_string));
        Ok(NotesChangeSnapshot {
            changes,
            next_cursor,
            reset_required,
        })
    }

    pub fn create_notebook(
        &self,
        title: &str,
        icon: Option<String>,
        parent_id: Option<String>,
    ) -> Result<NotebookDescriptor, NotesError> {
        let title = validate_title(title)?;
        let icon = validate_icon(icon)?;
        if let Some(parent) = &parent_id {
            self.read_notebook(parent)?;
        }
        if self.list_notebooks()?.len() >= MAX_NOTEBOOKS {
            return Err(NotesError::new(
                "quota_exceeded",
                "The maximum number of notebooks has been reached",
            ));
        }
        let id = Uuid::new_v4().to_string();
        let now = now_iso();
        let descriptor = NotebookDescriptor {
            id: id.clone(),
            workspace_id: self.workspace_id.clone().unwrap_or_default(),
            title,
            icon,
            parent_id,
            created_at: now.clone(),
            updated_at: now,
            note_count: 0,
        };
        let root = self.vault_root(&id)?;
        create_astro_vault(&root, &descriptor)?;
        Ok(descriptor)
    }

    pub fn update_notebook(
        &self,
        notebook_id: &str,
        title: Option<String>,
        icon: Option<String>,
        parent_id: Option<String>,
    ) -> Result<NotebookDescriptor, NotesError> {
        let notebook_id = validate_opaque_id(notebook_id)?;
        let mut notebook = self.read_notebook(&notebook_id)?;
        if let Some(title) = title {
            notebook.title = validate_title(&title)?;
        }
        if let Some(icon) = icon {
            notebook.icon = validate_icon(Some(icon))?;
        }
        if let Some(parent) = parent_id {
            let trimmed = parent.trim();
            notebook.parent_id = if trimmed.is_empty() {
                None
            } else {
                let new_parent = validate_opaque_id(trimmed)?;
                self.read_notebook(&new_parent)?;
                // Reject nesting a notebook inside itself or one of its own
                // descendants, which would create an unreachable cycle.
                let notebooks = self.list_notebooks()?;
                let mut cursor = Some(new_parent.as_str());
                while let Some(id) = cursor {
                    if id == notebook_id {
                        return Err(NotesError::new(
                            "invalid_parent",
                            "A notebook cannot be nested inside itself or one of its own children",
                        ));
                    }
                    cursor = notebooks
                        .iter()
                        .find(|entry| entry.id == id)
                        .and_then(|entry| entry.parent_id.as_deref());
                }
                Some(new_parent)
            };
        }
        notebook.updated_at = now_iso();
        let metadata = VaultMetadata {
            schema_version: VAULT_SCHEMA_VERSION,
            id: notebook.id.clone(),
            title: notebook.title.clone(),
            icon: notebook.icon.clone(),
            parent_id: notebook.parent_id.clone(),
            created_at: notebook.created_at.clone(),
            updated_at: notebook.updated_at.clone(),
        };
        atomic_json_write(
            &self
                .vault_root(&notebook_id)?
                .join(".zicode")
                .join("vault.json"),
            &metadata,
        )?;
        Ok(notebook)
    }

    pub fn delete_notebook(&self, notebook_id: &str) -> Result<(), NotesError> {
        let notebook_id = validate_opaque_id(notebook_id)?;
        let root = self.vault_root(&notebook_id)?;
        if !root.exists() {
            return Err(NotesError::new(
                "notebook_not_found",
                "Notebook does not exist",
            ));
        }
        // Collect the notebook and every descendant (nested notebooks share
        // the parent_id chain) so the whole subtree moves to the trash area
        // instead of being permanently removed.
        let notebooks = self.list_notebooks()?;
        let mut to_delete = Vec::new();
        let mut queue = vec![notebook_id.clone()];
        while let Some(id) = queue.pop() {
            if to_delete.contains(&id) {
                continue;
            }
            to_delete.push(id.clone());
            for candidate in &notebooks {
                if candidate.parent_id.as_deref() == Some(id.as_str()) {
                    queue.push(candidate.id.clone());
                }
            }
        }
        let deleted_root = self.deleted_vaults_dir();
        fs::create_dir_all(&deleted_root).map_err(|_| {
            NotesError::new("storage_unavailable", "Cannot prepare the Notes trash")
        })?;
        for id in &to_delete {
            let source = self.vault_root(id)?;
            if !source.exists() {
                continue;
            }
            let target = deleted_root.join(id);
            if target.exists() {
                return Err(NotesError::new(
                    "storage_unavailable",
                    format!("Notebook {id} is already in the trash"),
                ));
            }
            // Move every active note into the notebook's own `.trash` first
            // so the existing restore/purge pipeline stays uniform for
            // deleted notebooks.
            let notes = self.scan_notebook_notes(id)?;
            if !notes.is_empty() {
                let trash_dir = source.join(".trash");
                fs::create_dir_all(&trash_dir).map_err(|_| {
                    NotesError::new("storage_unavailable", "Cannot prepare the Notes trash")
                })?;
                for note in &notes {
                    let note_path = self.note_path(id, &note.id)?;
                    let trash_path = trash_dir.join(format!("{}.md", &note.id));
                    fs::rename(&note_path, &trash_path).map_err(|_| {
                        NotesError::new("storage_unavailable", "Cannot move the note to trash")
                    })?;
                    self.append_change("deleted", note, None)?;
                }
            }
            fs::rename(&source, &target).map_err(|_| {
                NotesError::new("storage_unavailable", "Cannot move the notebook to trash")
            })?;
        }
        Ok(())
    }

    pub fn create_note(
        &self,
        notebook_id: &str,
        title: &str,
        content: &str,
        tags: Vec<String>,
        icon: Option<String>,
        source: Option<NoteSource>,
    ) -> Result<NoteDocument, NotesError> {
        let notebook_id = validate_opaque_id(notebook_id)?;
        self.read_notebook(&notebook_id)?;
        let title = validate_title(title)?;
        validate_content(content)?;
        let tags = normalize_tags(tags)?;
        let icon = validate_icon(icon)?;
        if let Some(source) = &source {
            validate_source(source)?;
        }
        let id = Uuid::new_v4().to_string();
        let now = now_iso();
        let summary = NoteSummary {
            id: id.clone(),
            notebook_id: notebook_id.clone(),
            title,
            icon,
            created_at: now.clone(),
            updated_at: now,
            tags,
            source,
            snippet: None,
            version: String::new(),
        };
        let document = NoteDocument {
            summary,
            content: normalize_newlines(content),
        };
        let written = self.write_note(&document, None)?;
        self.touch_notebook(&notebook_id)?;
        self.append_change("created", &written.summary, Some(&written.summary.version))?;
        Ok(written)
    }

    pub fn get_note(&self, notebook_id: &str, note_id: &str) -> Result<NoteDocument, NotesError> {
        let notebook_id = validate_opaque_id(notebook_id)?;
        let note_id = validate_opaque_id(note_id)?;
        let path = self.note_path(&notebook_id, &note_id)?;
        read_note_file(&path, &notebook_id)
    }

    // Each parameter is a distinct field of the note document (identity,
    // content, metadata and optimistic-concurrency version); grouping them
    // into a struct would hide the expected_version invariant, so keep the
    // explicit signature.
    #[allow(clippy::too_many_arguments)]
    pub fn save_note(
        &self,
        notebook_id: &str,
        note_id: &str,
        title: &str,
        content: &str,
        tags: Vec<String>,
        icon: Option<String>,
        expected_version: &str,
    ) -> Result<NoteDocument, NotesError> {
        let notebook_id = validate_opaque_id(notebook_id)?;
        let note_id = validate_opaque_id(note_id)?;
        let existing = self.get_note(&notebook_id, &note_id)?;
        if expected_version.is_empty() || existing.summary.version != expected_version {
            return Err(NotesError::new(
                "version_conflict",
                "The note changed after it was opened",
            ));
        }
        let document = NoteDocument {
            summary: NoteSummary {
                id: note_id,
                notebook_id: notebook_id.clone(),
                title: validate_title(title)?,
                icon: match icon {
                    Some(icon) => validate_icon(Some(icon))?,
                    None => existing.summary.icon.clone(),
                },
                created_at: existing.summary.created_at,
                updated_at: now_iso(),
                tags: normalize_tags(tags)?,
                source: existing.summary.source,
                snippet: None,
                version: String::new(),
            },
            content: {
                validate_content(content)?;
                normalize_newlines(content)
            },
        };
        let written = self.write_note(&document, Some(expected_version))?;
        self.touch_notebook(&notebook_id)?;
        self.append_change("updated", &written.summary, Some(&written.summary.version))?;
        Ok(written)
    }

    pub fn move_note(
        &self,
        notebook_id: &str,
        note_id: &str,
        target_notebook_id: &str,
        expected_version: &str,
    ) -> Result<NoteDocument, NotesError> {
        let notebook_id = validate_opaque_id(notebook_id)?;
        let note_id = validate_opaque_id(note_id)?;
        let target_notebook_id = validate_opaque_id(target_notebook_id)?;
        if notebook_id == target_notebook_id {
            return Err(NotesError::new(
                "invalid_parameters",
                "The note is already in that notebook",
            ));
        }
        let existing = self.get_note(&notebook_id, &note_id)?;
        if expected_version.is_empty() || existing.summary.version != expected_version {
            return Err(NotesError::new(
                "version_conflict",
                "The note changed after it was opened",
            ));
        }
        self.read_notebook(&target_notebook_id)?;
        let mut moved = existing;
        moved.summary.notebook_id = target_notebook_id.clone();
        moved.summary.updated_at = now_iso();
        moved.summary.version = String::new();
        let target_path = self.note_path(&target_notebook_id, &note_id)?;
        if target_path.exists() {
            return Err(NotesError::new(
                "conflict",
                "A note with this ID already exists in the target notebook",
            ));
        }
        let bytes = serialize_note(&moved)?;
        atomic_write(&target_path, &bytes)?;
        let source_path = self.note_path(&notebook_id, &note_id)?;
        fs::remove_file(&source_path).map_err(|_| {
            NotesError::new(
                "storage_unavailable",
                "Cannot remove the note from its source",
            )
        })?;
        let mut written = moved;
        written.summary.version = version_for(&bytes);
        self.touch_notebook(&target_notebook_id)?;
        self.touch_notebook(&notebook_id)?;
        self.append_change("moved", &written.summary, Some(&written.summary.version))?;
        Ok(written)
    }

    pub fn delete_note(
        &self,
        notebook_id: &str,
        note_id: &str,
        expected_version: &str,
    ) -> Result<(), NotesError> {
        let existing = self.get_note(notebook_id, note_id)?;
        if expected_version.is_empty() || existing.summary.version != expected_version {
            return Err(NotesError::new(
                "version_conflict",
                "The note changed after it was opened",
            ));
        }
        let path = self.note_path(notebook_id, note_id)?;
        let trash_dir = self.vault_root(notebook_id)?.join(".trash");
        fs::create_dir_all(&trash_dir).map_err(|_| {
            NotesError::new("storage_unavailable", "Cannot prepare the Notes trash")
        })?;
        let trash_path = trash_dir.join(format!("{}.md", validate_opaque_id(note_id)?));
        fs::rename(&path, &trash_path)
            .map_err(|_| NotesError::new("storage_unavailable", "Cannot move the note to trash"))?;
        self.touch_notebook(notebook_id)?;
        self.append_change("deleted", &existing.summary, None)?;
        Ok(())
    }

    /// List notes currently in the workspace trash, newest deletion first.
    pub fn list_trash(&self, notebook_id: Option<&str>) -> Result<Vec<TrashEntry>, NotesError> {
        self.list_trash_with_retention(notebook_id, TRASH_RETENTION_DAYS)
    }

    fn list_trash_with_retention(
        &self,
        notebook_id: Option<&str>,
        retention_days: u64,
    ) -> Result<Vec<TrashEntry>, NotesError> {
        let selected = notebook_id.map(validate_opaque_id).transpose()?;
        let mut entries = Vec::new();
        // Active notebooks keep their `.trash` directories.
        for notebook in self.list_notebooks()? {
            if selected.as_ref().is_some_and(|id| id != &notebook.id) {
                continue;
            }
            let directory = self.vault_root(&notebook.id)?;
            self.collect_trash_directory(
                &directory,
                &notebook.id,
                &notebook.title,
                retention_days,
                &mut entries,
            )?;
        }
        // Deleted notebooks live under `.deleted/`; their notes were moved
        // into each notebook's `.trash` before the move, so the same
        // collection applies. Once a deleted notebook's trash is empty the
        // whole directory is removed (retention also purges it over time).
        let deleted_root = self.deleted_vaults_dir();
        if deleted_root.is_dir() {
            let mut cleaned = Vec::new();
            for entry in fs::read_dir(&deleted_root)
                .map_err(|_| NotesError::new("storage_unavailable", "Cannot read the notes trash"))?
                .flatten()
            {
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                if !file_type.is_dir() || file_type.is_symlink() {
                    continue;
                }
                let Some(id) = entry.file_name().to_str().map(str::to_string) else {
                    continue;
                };
                if validate_opaque_id(&id).is_err() {
                    continue;
                }
                if selected
                    .as_ref()
                    .is_some_and(|selected_id| selected_id != &id)
                {
                    continue;
                }
                let Ok(notebook) = self.read_notebook(&id) else {
                    continue;
                };
                self.collect_trash_directory(
                    &deleted_root.join(&id),
                    &id,
                    &notebook.title,
                    retention_days,
                    &mut entries,
                )?;
                cleaned.push(id);
            }
            for id in cleaned {
                let directory = deleted_root.join(&id);
                let trash_dir = directory.join(".trash");
                let empty = !trash_dir.is_dir()
                    || fs::read_dir(&trash_dir)
                        .map(|mut read| read.next().is_none())
                        .unwrap_or(true);
                if empty {
                    let _ = fs::remove_dir_all(&directory);
                }
            }
        }
        entries.sort_by(|left, right| right.deleted_at.cmp(&left.deleted_at));
        Ok(entries)
    }

    fn collect_trash_directory(
        &self,
        directory: &Path,
        notebook_id: &str,
        notebook_title: &str,
        retention_days: u64,
        entries: &mut Vec<TrashEntry>,
    ) -> Result<(), NotesError> {
        let trash_dir = directory.join(".trash");
        if !trash_dir.is_dir() {
            return Ok(());
        }
        for entry in fs::read_dir(&trash_dir)
            .map_err(|_| NotesError::new("storage_unavailable", "Cannot read trash"))?
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
            if !name.ends_with(".md") {
                continue;
            }
            let Some(note_id) = name.strip_suffix(".md").map(str::to_string) else {
                continue;
            };
            if modified_before_days(&entry.path(), retention_days)
                && self.purge_note(notebook_id, &note_id).is_ok()
            {
                continue;
            }
            if let Ok(note) = read_note_file(&entry.path(), notebook_id) {
                entries.push(TrashEntry {
                    notebook_id: notebook_id.to_string(),
                    notebook_title: Some(notebook_title.to_string()),
                    note: note.summary,
                    deleted_at: modified_at_iso(&entry.path()),
                });
            }
        }
        Ok(())
    }

    /// Restore a trashed note back into its original notebook.
    pub fn restore_note(
        &self,
        notebook_id: &str,
        note_id: &str,
    ) -> Result<NoteDocument, NotesError> {
        let notebook_id = validate_opaque_id(notebook_id)?;
        let note_id = validate_opaque_id(note_id)?;
        // Restoring a note from a deleted notebook brings the whole notebook
        // back first; the remaining trashed notes stay recoverable.
        let active = self.vaults_dir().join(&notebook_id);
        let deleted = self.deleted_vaults_dir().join(&notebook_id);
        if !active.exists() && deleted.is_dir() {
            fs::rename(&deleted, &active).map_err(|_| {
                NotesError::new("storage_unavailable", "Cannot restore the notebook")
            })?;
        }
        let trash_path = self.trash_path(&notebook_id, &note_id)?;
        if !trash_path.is_file() {
            return Err(NotesError::new(
                "trash_empty",
                "No trashed note with this ID",
            ));
        }
        let restored = read_note_file(&trash_path, &notebook_id)?;
        let target = self.note_path(&notebook_id, &note_id)?;
        if target.exists() {
            return Err(NotesError::new(
                "conflict",
                "A note with this ID already exists in the notebook",
            ));
        }
        fs::rename(&trash_path, &target)
            .map_err(|_| NotesError::new("storage_unavailable", "Cannot restore the note"))?;
        self.touch_notebook(&notebook_id)?;
        self.append_change(
            "restored",
            &restored.summary,
            Some(&restored.summary.version),
        )?;
        Ok(restored)
    }

    /// Permanently delete a trashed note and its attachments.
    pub fn purge_note(&self, notebook_id: &str, note_id: &str) -> Result<(), NotesError> {
        let trash_path = self.trash_path(notebook_id, note_id)?;
        if !trash_path.is_file() {
            return Err(NotesError::new(
                "trash_empty",
                "No trashed note with this ID",
            ));
        }
        let summary = read_note_file(&trash_path, notebook_id)?.summary;
        fs::remove_file(&trash_path).map_err(|_| {
            NotesError::new("storage_unavailable", "Cannot permanently delete the note")
        })?;
        let attachment_directory = self
            .vault_root(notebook_id)?
            .join("public")
            .join("attachments")
            .join(validate_opaque_id(note_id)?);
        if attachment_directory.is_dir() {
            fs::remove_dir_all(&attachment_directory).map_err(|_| {
                NotesError::new("storage_unavailable", "Cannot delete note attachments")
            })?;
        }
        self.touch_notebook(notebook_id)?;
        self.append_change("purged", &summary, None)?;
        Ok(())
    }

    /// Permanently delete every trashed note (optionally scoped to one
    /// notebook) and return how many entries were removed.
    pub fn empty_trash(&self, notebook_id: Option<&str>) -> Result<usize, NotesError> {
        let entries = self.list_trash(notebook_id)?;
        let mut purged = 0usize;
        for entry in &entries {
            self.purge_note(&entry.notebook_id, &entry.note.id)?;
            purged += 1;
        }
        Ok(purged)
    }

    fn trash_path(&self, notebook_id: &str, note_id: &str) -> Result<PathBuf, NotesError> {
        Ok(self
            .vault_root(notebook_id)?
            .join(".trash")
            .join(format!("{}.md", validate_opaque_id(note_id)?)))
    }

    pub fn store_attachment(
        &self,
        notebook_id: &str,
        note_id: &str,
        file_name: &str,
        mime_type: &str,
        bytes: &[u8],
    ) -> Result<AttachmentDescriptor, NotesError> {
        let notebook_id = validate_opaque_id(notebook_id)?;
        let note_id = validate_opaque_id(note_id)?;
        self.get_note(&notebook_id, &note_id)?;
        if bytes.is_empty() || bytes.len() > MAX_ATTACHMENT_BYTES {
            return Err(NotesError::new(
                "payload_too_large",
                "Attachments must contain 1 byte to 5 MiB",
            ));
        }
        let (extension, normalized_mime, image) = validate_attachment(file_name, mime_type)?;
        let id = format!("{}.{}", Uuid::new_v4(), extension);
        let directory = self
            .vault_root(&notebook_id)?
            .join("public")
            .join("attachments")
            .join(&note_id);
        let path = directory.join(&id);
        atomic_write(&path, bytes)?;
        let public_path = format!("/attachments/{note_id}/{id}");
        let escaped_name = file_name.replace(['[', ']'], "");
        let markdown = if image {
            format!("![{escaped_name}]({public_path})")
        } else {
            format!("[{escaped_name}]({public_path})")
        };
        Ok(AttachmentDescriptor {
            id,
            note_id,
            file_name: file_name.trim().to_string(),
            mime_type: normalized_mime.to_string(),
            size: bytes.len(),
            public_path,
            markdown,
        })
    }

    pub fn read_attachment(
        &self,
        notebook_id: &str,
        note_id: &str,
        attachment_id: &str,
    ) -> Result<(Vec<u8>, String), NotesError> {
        let notebook_id = validate_opaque_id(notebook_id)?;
        let note_id = validate_opaque_id(note_id)?;
        let attachment_id = validate_attachment_id(attachment_id)?;
        let note_exists = self.note_path(&notebook_id, &note_id)?.is_file()
            || self.trash_path(&notebook_id, &note_id)?.is_file();
        if !note_exists {
            return Err(NotesError::new("note_not_found", "Note does not exist"));
        }
        let path = self
            .vault_root(&notebook_id)?
            .join("public")
            .join("attachments")
            .join(&note_id)
            .join(&attachment_id);
        let metadata = fs::symlink_metadata(&path)
            .map_err(|_| NotesError::new("attachment_not_found", "Attachment does not exist"))?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > MAX_ATTACHMENT_BYTES as u64
        {
            return Err(NotesError::new(
                "attachment_not_found",
                "Attachment is not a valid file",
            ));
        }
        let mime = attachment_mime_from_name(&attachment_id)?;
        let bytes = fs::read(path)
            .map_err(|_| NotesError::new("storage_unavailable", "Cannot read attachment"))?;
        Ok((bytes, mime.to_string()))
    }

    pub fn export_notebook(&self, notebook_id: &str) -> Result<VaultExport, NotesError> {
        let notebook_id = validate_opaque_id(notebook_id)?;
        let notebook = self.read_notebook(&notebook_id)?;
        let summaries = self.scan_notebook_notes(&notebook_id)?;
        let mut notes = Vec::with_capacity(summaries.len());
        for summary in summaries {
            notes.push(self.get_note(&notebook_id, &summary.id)?);
        }
        let mut trashed_notes = Vec::new();
        let trash_dir = self.vault_root(&notebook_id)?.join(".trash");
        if trash_dir.is_dir() {
            for entry in fs::read_dir(&trash_dir)
                .map_err(|_| NotesError::new("storage_unavailable", "Cannot read trash"))?
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
                if !name.ends_with(".md") {
                    continue;
                }
                if let Ok(document) = read_note_file(&entry.path(), &notebook_id) {
                    trashed_notes.push(TrashNoteExport {
                        note: document,
                        deleted_at: modified_at_iso(&entry.path()),
                    });
                }
            }
        }
        let mut attachments = Vec::new();
        let mut total_attachment_bytes = 0usize;
        let attachment_root = self
            .vault_root(&notebook_id)?
            .join("public")
            .join("attachments");
        if let Ok(note_directories) = fs::read_dir(attachment_root) {
            for note_directory in note_directories.flatten() {
                let Some(note_id) = note_directory.file_name().to_str().map(str::to_string) else {
                    continue;
                };
                if validate_opaque_id(&note_id).is_err() {
                    continue;
                }
                let Ok(files) = fs::read_dir(note_directory.path()) else {
                    continue;
                };
                for file in files.flatten() {
                    let Some(file_name) = file.file_name().to_str().map(str::to_string) else {
                        continue;
                    };
                    let Ok((bytes, mime_type)) =
                        self.read_attachment(&notebook_id, &note_id, &file_name)
                    else {
                        continue;
                    };
                    total_attachment_bytes = total_attachment_bytes.saturating_add(bytes.len());
                    if total_attachment_bytes > MAX_EXPORT_ATTACHMENT_BYTES {
                        return Err(NotesError::new(
                            "quota_exceeded",
                            "Notebook attachments exceed the 50 MiB export limit",
                        ));
                    }
                    attachments.push(VaultExportAttachment {
                        note_id: note_id.clone(),
                        file_name,
                        mime_type,
                        data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
                    });
                }
            }
        }
        Ok(VaultExport {
            schema_version: VAULT_SCHEMA_VERSION,
            exported_at: now_iso(),
            notebook,
            notes,
            trashed_notes,
            attachments,
        })
    }

    /// Export every notebook in this vault as one archival bundle so users can
    /// back up an entire workspace without exporting notebooks one by one.
    pub fn export_all_notebooks(&self) -> Result<Vec<VaultExport>, NotesError> {
        let notebooks = self.list_notebooks()?;
        let mut exports = Vec::with_capacity(notebooks.len());
        for notebook in notebooks {
            exports.push(self.export_notebook(&notebook.id)?);
        }
        Ok(exports)
    }

    pub fn import_export(&self, export: VaultExport) -> Result<NotebookDescriptor, NotesError> {
        if export.schema_version != VAULT_SCHEMA_VERSION {
            return Err(NotesError::new(
                "invalid_parameters",
                "Unsupported Notes backup schema version",
            ));
        }
        if export
            .notes
            .len()
            .saturating_add(export.trashed_notes.len())
            > MAX_NOTES
        {
            return Err(NotesError::new(
                "quota_exceeded",
                "Notes backup contains too many notes",
            ));
        }
        let imported_title = format!("{} (Imported)", export.notebook.title);
        validate_title(&imported_title)?;
        let mut note_ids = BTreeSet::new();
        let imported_note_count = export.notes.len();
        for document in &export.notes {
            validate_opaque_id(&document.summary.id)?;
            validate_title(&document.summary.title)?;
            validate_content(&document.content)?;
            normalize_tags(document.summary.tags.clone())?;
            if let Some(source) = &document.summary.source {
                validate_source(source)?;
            }
            if !note_ids.insert(document.summary.id.clone()) {
                return Err(NotesError::new(
                    "invalid_parameters",
                    "Notes backup contains duplicate note IDs",
                ));
            }
        }
        for trashed in &export.trashed_notes {
            let document = &trashed.note;
            validate_opaque_id(&document.summary.id)?;
            validate_title(&document.summary.title)?;
            validate_content(&document.content)?;
            normalize_tags(document.summary.tags.clone())?;
            if let Some(source) = &document.summary.source {
                validate_source(source)?;
            }
            if !note_ids.insert(document.summary.id.clone()) {
                return Err(NotesError::new(
                    "invalid_parameters",
                    "Notes backup contains duplicate note IDs",
                ));
            }
        }
        let mut total_attachment_bytes = 0usize;
        let mut decoded_attachments = Vec::with_capacity(export.attachments.len());
        for attachment in export.attachments {
            if !note_ids.contains(&attachment.note_id) {
                return Err(NotesError::new(
                    "invalid_parameters",
                    "Backup attachment references a missing note",
                ));
            }
            let attachment_id = validate_attachment_id(&attachment.file_name)?;
            let expected_mime = attachment_mime_from_name(&attachment_id)?;
            if expected_mime != attachment.mime_type {
                return Err(NotesError::new(
                    "invalid_parameters",
                    "Backup attachment MIME type is invalid",
                ));
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(attachment.data_base64)
                .map_err(|_| {
                    NotesError::new(
                        "invalid_parameters",
                        "Backup attachment is not valid base64",
                    )
                })?;
            if bytes.is_empty() || bytes.len() > MAX_ATTACHMENT_BYTES {
                return Err(NotesError::new(
                    "payload_too_large",
                    "Backup attachment exceeds the 5 MiB per-file limit",
                ));
            }
            total_attachment_bytes = total_attachment_bytes.saturating_add(bytes.len());
            if total_attachment_bytes > MAX_EXPORT_ATTACHMENT_BYTES {
                return Err(NotesError::new(
                    "quota_exceeded",
                    "Backup attachments exceed the 50 MiB import limit",
                ));
            }
            decoded_attachments.push((attachment.note_id, attachment_id, bytes));
        }

        let notebook = self.create_notebook(&imported_title, None, None)?;
        let import_result = (|| {
            for document in export.notes {
                let imported = NoteDocument {
                    summary: NoteSummary {
                        id: document.summary.id,
                        notebook_id: notebook.id.clone(),
                        title: document.summary.title,
                        icon: validate_icon(document.summary.icon)?,
                        created_at: document.summary.created_at,
                        updated_at: document.summary.updated_at,
                        tags: normalize_tags(document.summary.tags)?,
                        source: document.summary.source,
                        snippet: None,
                        version: String::new(),
                    },
                    content: normalize_newlines(&document.content),
                };
                self.write_note(&imported, None)?;
            }
            let trash_dir = self.vault_root(&notebook.id)?.join(".trash");
            fs::create_dir_all(&trash_dir).map_err(|_| {
                NotesError::new("storage_unavailable", "Cannot prepare the Notes trash")
            })?;
            for trashed in export.trashed_notes {
                let imported = NoteDocument {
                    summary: NoteSummary {
                        id: trashed.note.summary.id,
                        notebook_id: notebook.id.clone(),
                        title: trashed.note.summary.title,
                        icon: validate_icon(trashed.note.summary.icon)?,
                        created_at: trashed.note.summary.created_at,
                        updated_at: trashed.note.summary.updated_at,
                        tags: normalize_tags(trashed.note.summary.tags)?,
                        source: trashed.note.summary.source,
                        snippet: None,
                        version: String::new(),
                    },
                    content: normalize_newlines(&trashed.note.content),
                };
                let bytes = serialize_note(&imported)?;
                atomic_write(
                    &trash_dir.join(format!("{}.md", imported.summary.id)),
                    &bytes,
                )?;
            }
            for (note_id, attachment_id, bytes) in decoded_attachments {
                let path = self
                    .vault_root(&notebook.id)?
                    .join("public")
                    .join("attachments")
                    .join(validate_opaque_id(&note_id)?)
                    .join(attachment_id);
                atomic_write(&path, &bytes)?;
            }
            self.touch_notebook(&notebook.id)
        })();
        if let Err(error) = import_result {
            let _ = fs::remove_dir_all(self.vault_root(&notebook.id)?);
            return Err(error);
        }
        // Report the real note count (the freshly created descriptor starts
        // at zero until the imported documents are written).
        Ok(NotebookDescriptor {
            note_count: imported_note_count,
            ..notebook
        })
    }

    /// Restore every notebook from a workspace-level backup bundle. Each
    /// notebook is imported with the standard "(Imported)" suffix, matching
    /// the per-notebook restore path.
    pub fn import_all_export(
        &self,
        bundle: VaultExportBundle,
    ) -> Result<Vec<NotebookDescriptor>, NotesError> {
        if bundle.schema_version != 1 {
            return Err(NotesError::new(
                "invalid_parameters",
                "Unsupported Notes workspace backup schema version",
            ));
        }
        let mut imported = Vec::with_capacity(bundle.notebooks.len());
        for export in bundle.notebooks {
            imported.push(self.import_export(export)?);
        }
        Ok(imported)
    }

    pub fn import_markdown(
        &self,
        notebook_id: &str,
        file_name: &str,
        markdown: &str,
    ) -> Result<NoteDocument, NotesError> {
        validate_content(markdown)?;
        let normalized = normalize_newlines(markdown);
        let (title, content, tags) = if normalized.starts_with("---\n") {
            match split_frontmatter(&normalized) {
                Ok((frontmatter, content)) => (
                    optional_frontmatter_string(frontmatter, "title")
                        .unwrap_or_else(|| title_from_file_name(file_name)),
                    content.to_string(),
                    frontmatter_line(frontmatter, "tags")
                        .and_then(|value| serde_json::from_str::<Vec<String>>(value).ok())
                        .unwrap_or_default(),
                ),
                Err(_) => (title_from_file_name(file_name), normalized, Vec::new()),
            }
        } else {
            (title_from_file_name(file_name), normalized, Vec::new())
        };
        self.create_note(notebook_id, &title, &content, tags, None, None)
    }

    pub fn rebuild_index(&self, notebook_id: &str) -> Result<VaultRebuildReport, NotesError> {
        let notebook_id = validate_opaque_id(notebook_id)?;
        self.read_notebook(&notebook_id)?;
        let vault_root = self.vault_root(&notebook_id)?;
        let notes_directory = vault_root.join("src").join("content").join("notes");
        fs::create_dir_all(&notes_directory)
            .map_err(|_| NotesError::new("storage_unavailable", "Cannot repair notes directory"))?;
        let mut summaries = Vec::new();
        let mut invalid_files = Vec::new();
        for entry in fs::read_dir(&notes_directory)
            .map_err(|_| NotesError::new("storage_unavailable", "Cannot scan notes directory"))?
            .flatten()
            .take(MAX_NOTES + 1)
        {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if entry.path().extension().and_then(|value| value.to_str()) != Some("md") {
                continue;
            }
            match read_note_file(&entry.path(), &notebook_id) {
                Ok(note) => summaries.push(note.summary),
                Err(error) => invalid_files.push(VaultInvalidFile {
                    file_name,
                    error: error.message,
                }),
            }
        }
        summaries.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        let valid_note_ids = summaries
            .iter()
            .map(|summary| summary.id.as_str())
            .collect::<BTreeSet<_>>();
        let mut orphan_attachment_directories = Vec::new();
        let attachment_root = vault_root.join("public").join("attachments");
        fs::create_dir_all(&attachment_root).map_err(|_| {
            NotesError::new("storage_unavailable", "Cannot repair attachment directory")
        })?;
        for entry in fs::read_dir(&attachment_root)
            .map_err(|_| NotesError::new("storage_unavailable", "Cannot scan attachments"))?
            .flatten()
        {
            let name = entry.file_name().to_string_lossy().to_string();
            if entry.path().is_dir() && !valid_note_ids.contains(name.as_str()) {
                orphan_attachment_directories.push(name);
            }
        }
        let rebuilt_at = now_iso();
        atomic_json_write(
            &vault_root.join(".zicode").join("index.json"),
            &json!({
                "schemaVersion": VAULT_SCHEMA_VERSION,
                "rebuiltAt": rebuilt_at,
                "notes": &summaries,
                "invalidFiles": &invalid_files,
                "orphanAttachmentDirectories": &orphan_attachment_directories,
            }),
        )?;
        Ok(VaultRebuildReport {
            notebook_id,
            valid_notes: summaries.len(),
            invalid_files,
            orphan_attachment_directories,
            rebuilt_at,
        })
    }

    pub fn publish_astro(&self, notebook_id: &str) -> Result<AstroPublishReport, NotesError> {
        let notebook_id = validate_opaque_id(notebook_id)?;
        self.read_notebook(&notebook_id)?;
        let note_count = self
            .list(Some(&notebook_id), None, None, false)?
            .notes
            .len();
        let root = self.vault_root(&notebook_id)?;
        let package_path = root.join("package.json");
        let config_path = root.join("astro.config.mjs");
        if !package_path.is_file() || !config_path.is_file() {
            return Err(NotesError::new(
                "invalid_vault",
                "The notebook does not contain a complete Astro project",
            ));
        }
        let package: Value = serde_json::from_str(
            &fs::read_to_string(&package_path)
                .map_err(|_| NotesError::new("storage_unavailable", "Cannot read package.json"))?,
        )
        .map_err(|_| NotesError::new("invalid_vault", "package.json is not valid JSON"))?;
        if package["scripts"]["build"].as_str() != Some("astro build") {
            return Err(NotesError::new(
                "unsafe_build",
                "The Astro build script was modified and cannot be executed",
            ));
        }
        let log_path = root.join(".zicode").join("publish.log");
        fs::write(&log_path, b"").map_err(|error| {
            NotesError::new(
                "storage_unavailable",
                format!("Cannot reset Astro publish log: {error}"),
            )
        })?;
        run_bun_step(&root, &["install", "--ignore-scripts"], &log_path, 300)?;
        run_bun_step(&root, &["run", "build"], &log_path, 300)?;
        let output = root.join("dist").join("index.html");
        if !output.is_file() {
            return Err(NotesError::new(
                "build_failed",
                "Astro finished without producing dist/index.html",
            ));
        }
        Ok(AstroPublishReport {
            notebook_id,
            note_count,
            output_directory: "dist".to_string(),
            built_at: now_iso(),
        })
    }

    pub fn find_source_duplicate(
        &self,
        content_hash: &str,
    ) -> Result<Option<NoteSummary>, NotesError> {
        for notebook in self.list_notebooks()? {
            if let Some(note) = self
                .scan_notebook_notes(&notebook.id)?
                .into_iter()
                .find(|note| {
                    note.source
                        .as_ref()
                        .is_some_and(|source| source.content_hash == content_hash)
                })
            {
                return Ok(Some(note));
            }
        }
        Ok(None)
    }

    fn list_notebooks(&self) -> Result<Vec<NotebookDescriptor>, NotesError> {
        let vaults = self.vaults_dir();
        fs::create_dir_all(&vaults)
            .map_err(|_| NotesError::new("storage_unavailable", "Notes storage is unavailable"))?;
        let entries = fs::read_dir(vaults)
            .map_err(|_| NotesError::new("storage_unavailable", "Cannot read notebooks"))?;
        let mut notebooks = Vec::new();
        for entry in entries.flatten().take(MAX_NOTEBOOKS + 1) {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() || file_type.is_symlink() {
                continue;
            }
            let Some(id) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if validate_opaque_id(&id).is_err() {
                continue;
            }
            if let Ok(mut descriptor) = self.read_notebook(&id) {
                descriptor.note_count = self.scan_notebook_notes(&id)?.len();
                notebooks.push(descriptor);
            }
        }
        notebooks.sort_by(|left, right| left.title.to_lowercase().cmp(&right.title.to_lowercase()));
        Ok(notebooks)
    }

    fn read_notebook(&self, notebook_id: &str) -> Result<NotebookDescriptor, NotesError> {
        let path = self
            .vault_root(notebook_id)?
            .join(".zicode")
            .join("vault.json");
        let bytes = fs::read(path)
            .map_err(|_| NotesError::new("notebook_not_found", "Notebook does not exist"))?;
        let metadata: VaultMetadata = serde_json::from_slice(&bytes)
            .map_err(|_| NotesError::new("vault_corrupt", "Notebook metadata is damaged"))?;
        if metadata.schema_version != VAULT_SCHEMA_VERSION || metadata.id != notebook_id {
            return Err(NotesError::new(
                "vault_corrupt",
                "Notebook metadata identity is invalid",
            ));
        }
        Ok(NotebookDescriptor {
            id: metadata.id,
            workspace_id: self.workspace_id.clone().unwrap_or_default(),
            title: metadata.title,
            icon: metadata.icon,
            parent_id: metadata.parent_id,
            created_at: metadata.created_at,
            updated_at: metadata.updated_at,
            note_count: 0,
        })
    }

    fn touch_notebook(&self, notebook_id: &str) -> Result<(), NotesError> {
        let mut notebook = self.read_notebook(notebook_id)?;
        notebook.updated_at = now_iso();
        let metadata = VaultMetadata {
            schema_version: VAULT_SCHEMA_VERSION,
            id: notebook.id,
            title: notebook.title,
            icon: notebook.icon,
            parent_id: notebook.parent_id,
            created_at: notebook.created_at,
            updated_at: notebook.updated_at,
        };
        atomic_json_write(
            &self
                .vault_root(notebook_id)?
                .join(".zicode")
                .join("vault.json"),
            &metadata,
        )
    }

    fn scan_notebook_notes(&self, notebook_id: &str) -> Result<Vec<NoteSummary>, NotesError> {
        let directory = self
            .vault_root(notebook_id)?
            .join("src")
            .join("content")
            .join("notes");
        let entries = fs::read_dir(directory)
            .map_err(|_| NotesError::new("vault_corrupt", "Notebook notes directory is missing"))?;
        let mut notes = Vec::new();
        for entry in entries.flatten().take(MAX_NOTES + 1) {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_file()
                || file_type.is_symlink()
                || entry.path().extension().and_then(|value| value.to_str()) != Some("md")
            {
                continue;
            }
            if let Ok(note) = read_note_file(&entry.path(), notebook_id) {
                notes.push(note.summary);
            }
        }
        Ok(notes)
    }

    fn write_note(
        &self,
        document: &NoteDocument,
        expected_version: Option<&str>,
    ) -> Result<NoteDocument, NotesError> {
        let path = self.note_path(&document.summary.notebook_id, &document.summary.id)?;
        if let Some(expected) = expected_version {
            let current = fs::read(&path)
                .map_err(|_| NotesError::new("note_not_found", "Note does not exist"))?;
            if version_for(&current) != expected {
                return Err(NotesError::new(
                    "version_conflict",
                    "The note changed after it was opened",
                ));
            }
        } else if path.exists() {
            return Err(NotesError::new("conflict", "Note already exists"));
        }
        let bytes = serialize_note(document)?;
        atomic_write(&path, &bytes)?;
        let mut written = document.clone();
        written.summary.version = version_for(&bytes);
        Ok(written)
    }

    fn append_change(
        &self,
        operation: &str,
        summary: &NoteSummary,
        version: Option<&str>,
    ) -> Result<(), NotesError> {
        let path = self.change_log_path();
        let parent = path.parent().ok_or_else(|| {
            NotesError::new("storage_unavailable", "Cannot create note change log")
        })?;
        fs::create_dir_all(parent)
            .map_err(|_| NotesError::new("storage_unavailable", "Cannot create note change log"))?;
        compact_change_log(&path, MAX_CHANGE_LOG_BYTES, RETAINED_CHANGE_RECORDS)?;
        let change = NoteChange {
            cursor: Uuid::new_v4().to_string(),
            operation: operation.to_string(),
            notebook_id: summary.notebook_id.clone(),
            note_id: summary.id.clone(),
            version: version.map(str::to_string),
            changed_at: now_iso(),
        };
        let line = serde_json::to_string(&change)
            .map_err(|_| NotesError::new("serialization_failed", "Cannot encode note change"))?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|_| NotesError::new("storage_unavailable", "Cannot write note change log"))?;
        writeln!(file, "{line}")
            .map_err(|_| NotesError::new("storage_unavailable", "Cannot write note change log"))
    }

    fn vault_root(&self, notebook_id: &str) -> Result<PathBuf, NotesError> {
        let notebook_id = validate_opaque_id(notebook_id)?;
        let active = self.vaults_dir().join(&notebook_id);
        let deleted = self.deleted_vaults_dir().join(&notebook_id);
        if active.exists() || !deleted.exists() {
            return Ok(active);
        }
        Ok(deleted)
    }

    fn deleted_vaults_dir(&self) -> PathBuf {
        self.vaults_dir().join(".deleted")
    }

    fn note_path(&self, notebook_id: &str, note_id: &str) -> Result<PathBuf, NotesError> {
        let note_id = validate_opaque_id(note_id)?;
        Ok(self
            .vault_root(notebook_id)?
            .join("src")
            .join("content")
            .join("notes")
            .join(format!("{note_id}.md")))
    }
}

fn compact_change_log(path: &Path, max_bytes: u64, retain: usize) -> Result<(), NotesError> {
    if !path
        .metadata()
        .is_ok_and(|metadata| metadata.len() > max_bytes)
    {
        return Ok(());
    }
    let text = fs::read_to_string(path)
        .map_err(|_| NotesError::new("storage_unavailable", "Cannot compact note change log"))?;
    let records = text
        .lines()
        .filter_map(|line| serde_json::from_str::<NoteChange>(line).ok())
        .collect::<Vec<_>>();
    let start = records.len().saturating_sub(retain.max(1));
    let mut compacted = Vec::new();
    for change in &records[start..] {
        serde_json::to_writer(&mut compacted, change)
            .map_err(|_| NotesError::new("serialization_failed", "Cannot compact note changes"))?;
        compacted.push(b'\n');
    }
    atomic_write(path, &compacted)
}

fn run_bun_step(
    working_directory: &Path,
    arguments: &[&str],
    log_path: &Path,
    timeout_seconds: u64,
) -> Result<(), NotesError> {
    let parent = log_path
        .parent()
        .ok_or_else(|| NotesError::new("storage_unavailable", "Invalid publish log path"))?;
    fs::create_dir_all(parent)
        .map_err(|_| NotesError::new("storage_unavailable", "Cannot create publish log"))?;
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|_| NotesError::new("storage_unavailable", "Cannot write publish log"))?;
    let stderr = stdout
        .try_clone()
        .map_err(|_| NotesError::new("storage_unavailable", "Cannot write publish log"))?;
    let mut command = crate::process_command::new_command(resolve_bun_executable());
    command
        .args(arguments)
        .current_dir(working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    let mut child = command.spawn().map_err(|_| {
        NotesError::new(
            "runtime_unavailable",
            "Bun is required to build this Astro notebook but was not found",
        )
    })?;
    let deadline = Instant::now() + Duration::from_secs(timeout_seconds);
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|_| NotesError::new("build_failed", "Cannot monitor the Astro build"))?
        {
            return if status.success() {
                Ok(())
            } else {
                Err(NotesError::new(
                    "build_failed",
                    "Astro build failed. See .zicode/publish.log in the notebook Vault.",
                ))
            };
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(NotesError::new(
                "build_timeout",
                "Astro build exceeded the five minute limit",
            ));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn resolve_bun_executable() -> PathBuf {
    if let Some(configured) = std::env::var_os("ZICODE_BUN_RUNTIME") {
        let configured = PathBuf::from(configured);
        if configured.is_file() {
            return configured;
        }
    }
    let executable_name = if cfg!(target_os = "windows") {
        "bun.exe"
    } else {
        "bun"
    };
    if let Ok(current) = std::env::current_exe() {
        if let Some(resource_root) = current.parent() {
            let bundled = resource_root.join("bun").join(executable_name);
            if bundled.is_file() {
                return bundled;
            }
        }
    }
    if cfg!(debug_assertions) {
        let bundled = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("bun")
            .join(executable_name);
        if bundled.is_file() {
            return bundled;
        }
    }
    PathBuf::from("bun")
}

pub fn configure_bundled_bun(static_directory: &Path) -> Result<(), String> {
    let executable_name = if cfg!(target_os = "windows") {
        "bun.exe"
    } else {
        "bun"
    };
    let mut candidates = static_directory
        .parent()
        .map(|root| vec![root.join("bun").join(executable_name)])
        .unwrap_or_default();
    if cfg!(debug_assertions) {
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("bun")
                .join(executable_name),
        );
    }
    if let Some(executable) = candidates.into_iter().find(|candidate| candidate.is_file()) {
        std::env::set_var("ZICODE_BUN_RUNTIME", executable);
        return Ok(());
    }
    if cfg!(debug_assertions) {
        Ok(())
    } else {
        Err("Bundled Bun runtime is missing from the application resources".to_string())
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultMetadata {
    schema_version: u32,
    id: String,
    title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    parent_id: Option<String>,
    created_at: String,
    updated_at: String,
}

fn create_astro_vault(root: &Path, descriptor: &NotebookDescriptor) -> Result<(), NotesError> {
    if root.exists() {
        return Err(NotesError::new(
            "conflict",
            "Notebook directory already exists",
        ));
    }
    let notes = root.join("src").join("content").join("notes");
    let zicode = root.join(".zicode");
    fs::create_dir_all(&notes)
        .and_then(|_| fs::create_dir_all(root.join("src").join("pages")))
        .and_then(|_| fs::create_dir_all(root.join("src").join("layouts")))
        .and_then(|_| fs::create_dir_all(root.join("public").join("attachments")))
        .and_then(|_| fs::create_dir_all(&zicode))
        .map_err(|_| NotesError::new("storage_unavailable", "Cannot create notebook structure"))?;
    let metadata = VaultMetadata {
        schema_version: VAULT_SCHEMA_VERSION,
        id: descriptor.id.clone(),
        title: descriptor.title.clone(),
        icon: descriptor.icon.clone(),
        parent_id: descriptor.parent_id.clone(),
        created_at: descriptor.created_at.clone(),
        updated_at: descriptor.updated_at.clone(),
    };
    let result = (|| {
        atomic_json_write(&zicode.join("vault.json"), &metadata)?;
        atomic_json_write(
            &zicode.join("index.json"),
            &json!({
                "schemaVersion": VAULT_SCHEMA_VERSION,
                "rebuiltAt": descriptor.created_at,
                "notes": [],
                "invalidFiles": [],
                "orphanAttachmentDirectories": [],
            }),
        )?;
        atomic_write(
            &root.join("package.json"),
            serde_json::to_string_pretty(&json!({
                "name": format!("zicode-notes-{}", descriptor.id),
                "private": true,
                "type": "module",
                "scripts": {
                    "dev": "astro dev",
                    "build": "astro build",
                    "preview": "astro preview"
                },
                "dependencies": { "astro": "5.13.5" }
            }))
            .map_err(|_| NotesError::new("serialization_failed", "Cannot encode package metadata"))?
            .as_bytes(),
        )?;
        atomic_write(
            &root.join("astro.config.mjs"),
            b"import { defineConfig } from \"astro/config\";\n\nexport default defineConfig({});\n",
        )?;
        atomic_write(
            &root.join("src").join("content.config.ts"),
            br#"import { defineCollection, z } from "astro:content";

const notes = defineCollection({
  type: "content",
  schema: z.object({
    id: z.string(),
    title: z.string(),
    icon: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    tags: z.array(z.string()).default([]),
    source: z.object({
      url: z.string().url(),
      capturedAt: z.string(),
      contentHash: z.string(),
      author: z.string().optional(),
      publishedAt: z.string().optional(),
    }).optional(),
  }),
});

export const collections = { notes };
"#,
        )?;
        atomic_write(
            &root.join("src").join("layouts").join("NoteLayout.astro"),
            br#"---
const { title, description = "", tags = [] } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <meta name="description" content={description} />
    <title>{title}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main>
      <nav><a href="/">All notes</a></nav>
      <article>
        <h1>{title}</h1>
        {tags.length > 0 && <p class="tags">{tags.join(" / ")}</p>}
        <slot />
      </article>
    </main>
  </body>
</html>
"#,
        )?;
        atomic_write(
            &root.join("src").join("pages").join("index.astro"),
            br#"---
import { getCollection } from "astro:content";
import NoteLayout from "../layouts/NoteLayout.astro";
const notes = (await getCollection("notes")).sort((a, b) => b.data.updatedAt.localeCompare(a.data.updatedAt));
---
<NoteLayout title="Notes" description="Published from ZiCode Notes">
  <ul class="note-list">
    {notes.map((note) => <li><a href={`/notes/${note.id}/`}>{note.data.title}</a><time>{note.data.updatedAt}</time></li>)}
  </ul>
</NoteLayout>
"#,
        )?;
        atomic_write(
            &root
                .join("src")
                .join("pages")
                .join("notes")
                .join("[...id].astro"),
            br#"---
import { getCollection, render } from "astro:content";
import NoteLayout from "../../layouts/NoteLayout.astro";
export async function getStaticPaths() {
  const notes = await getCollection("notes");
  return notes.map((note) => ({ params: { id: note.id }, props: { note } }));
}
const { note } = Astro.props;
const { Content } = await render(note);
---
<NoteLayout title={note.data.title} tags={note.data.tags}>
  <Content />
</NoteLayout>
"#,
        )?;
        atomic_write(
            &root.join("public").join("styles.css"),
            br#":root { color-scheme: light dark; font-family: Inter, system-ui, sans-serif; }
body { margin: 0; line-height: 1.65; }
main { width: min(760px, calc(100% - 32px)); margin: 48px auto; }
nav { margin-bottom: 32px; }
a { color: #4f7cff; }
.note-list { display: grid; gap: 12px; padding: 0; list-style: none; }
.note-list li { display: flex; justify-content: space-between; gap: 16px; }
time, .tags { opacity: .65; }
pre { overflow: auto; padding: 16px; border-radius: 8px; background: #111827; color: #f9fafb; }
img { max-width: 100%; height: auto; }
"#,
        )
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(root);
        return Err(error);
    }
    Ok(())
}

fn serialize_note(document: &NoteDocument) -> Result<Vec<u8>, NotesError> {
    let mut output = String::from("---\n");
    output.push_str(&format!(
        "id: {}\ntitle: {}\ncreatedAt: {}\nupdatedAt: {}\ntags: {}\n",
        yaml_string(&document.summary.id),
        yaml_string(&document.summary.title),
        yaml_string(&document.summary.created_at),
        yaml_string(&document.summary.updated_at),
        serde_json::to_string(&document.summary.tags)
            .map_err(|_| NotesError::new("serialization_failed", "Cannot encode note tags"))?,
    ));
    if let Some(icon) = &document.summary.icon {
        output.push_str(&format!("icon: {}\n", yaml_string(icon)));
    }
    if let Some(source) = &document.summary.source {
        output.push_str("source:\n");
        output.push_str(&format!("  url: {}\n", yaml_string(&source.url)));
        output.push_str(&format!(
            "  capturedAt: {}\n",
            yaml_string(&source.captured_at)
        ));
        output.push_str(&format!(
            "  contentHash: {}\n",
            yaml_string(&source.content_hash)
        ));
        if let Some(author) = &source.author {
            output.push_str(&format!("  author: {}\n", yaml_string(author)));
        }
        if let Some(published_at) = &source.published_at {
            output.push_str(&format!("  publishedAt: {}\n", yaml_string(published_at)));
        }
        if let Some(site_name) = &source.site_name {
            output.push_str(&format!("  siteName: {}\n", yaml_string(site_name)));
        }
        if let Some(image) = &source.image {
            output.push_str(&format!("  image: {}\n", yaml_string(image)));
        }
    }
    output.push_str("---\n\n");
    output.push_str(&document.content);
    if !output.ends_with('\n') {
        output.push('\n');
    }
    if output.len() > MAX_NOTE_BYTES {
        return Err(NotesError::new(
            "payload_too_large",
            "Note exceeds the 1 MiB limit",
        ));
    }
    Ok(output.into_bytes())
}

fn read_note_file(path: &Path, notebook_id: &str) -> Result<NoteDocument, NotesError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| NotesError::new("note_not_found", "Note does not exist"))?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_NOTE_BYTES as u64
    {
        return Err(NotesError::new(
            "note_corrupt",
            "Note is not a valid Markdown file",
        ));
    }
    let bytes = fs::read(path)
        .map_err(|_| NotesError::new("storage_unavailable", "Cannot read the note"))?;
    let text = String::from_utf8(bytes.clone())
        .map_err(|_| NotesError::new("note_corrupt", "Note is not UTF-8 Markdown"))?;
    let (frontmatter, content) = split_frontmatter(&text)?;
    let id = required_frontmatter_string(frontmatter, "id")?;
    let file_id = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if id != file_id || validate_opaque_id(&id).is_err() {
        return Err(NotesError::new(
            "note_corrupt",
            "Note identity does not match its filename",
        ));
    }
    let tags = frontmatter_line(frontmatter, "tags")
        .and_then(|value| serde_json::from_str::<Vec<String>>(value).ok())
        .unwrap_or_default();
    let source = if frontmatter.lines().any(|line| line.trim() == "source:") {
        let url = required_frontmatter_string(frontmatter, "url")?;
        Some(NoteSource {
            url,
            captured_at: required_frontmatter_string(frontmatter, "capturedAt")?,
            content_hash: required_frontmatter_string(frontmatter, "contentHash")?,
            author: optional_frontmatter_string(frontmatter, "author"),
            published_at: optional_frontmatter_string(frontmatter, "publishedAt"),
            site_name: optional_frontmatter_string(frontmatter, "siteName"),
            image: optional_frontmatter_string(frontmatter, "image"),
        })
    } else {
        None
    };
    Ok(NoteDocument {
        summary: NoteSummary {
            id,
            notebook_id: notebook_id.to_string(),
            title: required_frontmatter_string(frontmatter, "title")?,
            icon: optional_frontmatter_string(frontmatter, "icon"),
            created_at: required_frontmatter_string(frontmatter, "createdAt")?,
            updated_at: required_frontmatter_string(frontmatter, "updatedAt")?,
            tags,
            source,
            snippet: None,
            version: version_for(&bytes),
        },
        content: content.to_string(),
    })
}

fn extract_note_targets<'a>(
    content: &str,
    by_title: &HashMap<String, &'a NoteSummary>,
    by_ref: &HashMap<String, &'a NoteSummary>,
) -> Vec<(String, &'a NoteSummary)> {
    let mut targets = Vec::new();
    for segment in content.split("[[").skip(1) {
        let Some(end) = segment.find("]]") else {
            continue;
        };
        let title = segment[..end]
            .split('|')
            .next()
            .unwrap_or("")
            .trim()
            .to_lowercase();
        if let Some(target) = by_title.get(&title) {
            targets.push(("wikilink".into(), *target));
        }
    }
    for (index, _) in content.match_indices("zicode-note://") {
        let tail = &content[index + "zicode-note://".len()..];
        let reference: String = tail
            .chars()
            .take_while(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '/')
            })
            .collect();
        if let Some(target) = by_ref.get(&reference) {
            targets.push(("reference".into(), *target));
        }
    }
    targets
}

fn split_frontmatter(text: &str) -> Result<(&str, &str), NotesError> {
    let normalized = text.strip_prefix('\u{feff}').unwrap_or(text);
    let rest = normalized
        .strip_prefix("---\n")
        .ok_or_else(|| NotesError::new("note_corrupt", "Markdown frontmatter is missing"))?;
    let end = rest
        .find("\n---\n")
        .ok_or_else(|| NotesError::new("note_corrupt", "Markdown frontmatter is incomplete"))?;
    let content = rest[end + 5..]
        .strip_prefix('\n')
        .unwrap_or(&rest[end + 5..]);
    Ok((&rest[..end], content.strip_suffix('\n').unwrap_or(content)))
}

fn required_frontmatter_string(frontmatter: &str, key: &str) -> Result<String, NotesError> {
    optional_frontmatter_string(frontmatter, key)
        .ok_or_else(|| NotesError::new("note_corrupt", format!("Frontmatter is missing {key}")))
}

fn optional_frontmatter_string(frontmatter: &str, key: &str) -> Option<String> {
    let value = frontmatter_line(frontmatter, key)?;
    serde_json::from_str::<String>(value).ok()
}

fn frontmatter_line<'a>(frontmatter: &'a str, key: &str) -> Option<&'a str> {
    frontmatter.lines().find_map(|line| {
        let line = line.trim();
        let value = line.strip_prefix(key)?.strip_prefix(':')?;
        Some(value.trim())
    })
}

fn validate_opaque_id(value: &str) -> Result<String, NotesError> {
    Uuid::parse_str(value)
        .map(|id| id.to_string())
        .map_err(|_| NotesError::new("invalid_parameters", "Invalid Notes resource ID"))
}

fn validate_title(value: &str) -> Result<String, NotesError> {
    let title = value.trim();
    if title.is_empty() || title.chars().count() > MAX_TITLE_CHARS {
        return Err(NotesError::new(
            "invalid_parameters",
            "Title must contain 1 to 200 characters",
        ));
    }
    Ok(title.to_string())
}

fn validate_icon(value: Option<String>) -> Result<Option<String>, NotesError> {
    let Some(icon) = value else {
        return Ok(None);
    };
    let icon = icon.trim();
    if icon.is_empty() {
        return Ok(None);
    }
    if icon.chars().count() > MAX_ICON_CHARS || icon.chars().any(char::is_control) {
        return Err(NotesError::new(
            "invalid_parameters",
            "Icon must contain 1 to 8 visible characters",
        ));
    }
    Ok(Some(icon.to_string()))
}

fn title_from_file_name(file_name: &str) -> String {
    let title = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Imported note");
    title.chars().take(MAX_TITLE_CHARS).collect()
}

fn validate_attachment(
    file_name: &str,
    mime_type: &str,
) -> Result<(&'static str, &'static str, bool), NotesError> {
    if file_name.trim().is_empty()
        || file_name.chars().count() > 255
        || file_name.chars().any(char::is_control)
    {
        return Err(NotesError::new(
            "invalid_parameters",
            "Attachment filename is invalid",
        ));
    }
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let descriptor = match extension.as_str() {
        "png" => ("png", "image/png", true),
        "jpg" | "jpeg" => ("jpg", "image/jpeg", true),
        "gif" => ("gif", "image/gif", true),
        "webp" => ("webp", "image/webp", true),
        "pdf" => ("pdf", "application/pdf", false),
        "txt" => ("txt", "text/plain", false),
        "md" => ("md", "text/markdown", false),
        "csv" => ("csv", "text/csv", false),
        "json" => ("json", "application/json", false),
        _ => {
            return Err(NotesError::new(
                "invalid_parameters",
                "Attachment type is not allowed",
            ))
        }
    };
    let supplied = mime_type.trim().to_ascii_lowercase();
    if !supplied.is_empty()
        && supplied != "application/octet-stream"
        && supplied != descriptor.1
        && !(descriptor.0 == "md" && supplied == "text/plain")
        && !(descriptor.0 == "csv" && supplied == "application/vnd.ms-excel")
    {
        return Err(NotesError::new(
            "invalid_parameters",
            "Attachment MIME type does not match its extension",
        ));
    }
    Ok(descriptor)
}

fn validate_attachment_id(value: &str) -> Result<String, NotesError> {
    let (uuid, extension) = value
        .rsplit_once('.')
        .ok_or_else(|| NotesError::new("invalid_parameters", "Invalid attachment ID"))?;
    let uuid = Uuid::parse_str(uuid)
        .map_err(|_| NotesError::new("invalid_parameters", "Invalid attachment ID"))?;
    attachment_mime_from_extension(extension)?;
    let canonical = format!("{}.{}", uuid, extension.to_ascii_lowercase());
    if canonical != value {
        return Err(NotesError::new(
            "invalid_parameters",
            "Invalid attachment ID",
        ));
    }
    Ok(canonical)
}

fn attachment_mime_from_name(value: &str) -> Result<&'static str, NotesError> {
    let extension = Path::new(value)
        .extension()
        .and_then(|candidate| candidate.to_str())
        .unwrap_or_default();
    attachment_mime_from_extension(extension)
}

fn attachment_mime_from_extension(extension: &str) -> Result<&'static str, NotesError> {
    match extension {
        "png" => Ok("image/png"),
        "jpg" => Ok("image/jpeg"),
        "gif" => Ok("image/gif"),
        "webp" => Ok("image/webp"),
        "pdf" => Ok("application/pdf"),
        "txt" => Ok("text/plain"),
        "md" => Ok("text/markdown"),
        "csv" => Ok("text/csv"),
        "json" => Ok("application/json"),
        _ => Err(NotesError::new(
            "invalid_parameters",
            "Attachment type is not allowed",
        )),
    }
}

fn validate_content(value: &str) -> Result<(), NotesError> {
    if value.len() > MAX_NOTE_BYTES {
        return Err(NotesError::new(
            "payload_too_large",
            "Note exceeds the 1 MiB limit",
        ));
    }
    Ok(())
}

fn validate_source(source: &NoteSource) -> Result<(), NotesError> {
    let url = reqwest::Url::parse(&source.url)
        .map_err(|_| NotesError::new("invalid_parameters", "Note source URL is invalid"))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || source.url.chars().count() > 4096
    {
        return Err(NotesError::new(
            "invalid_parameters",
            "Note source must be an HTTP(S) URL without credentials",
        ));
    }
    if source.captured_at.chars().count() > 100
        || source.content_hash.chars().count() > 100
        || source
            .author
            .as_ref()
            .is_some_and(|value| value.chars().count() > 500)
        || source
            .published_at
            .as_ref()
            .is_some_and(|value| value.chars().count() > 100)
    {
        return Err(NotesError::new(
            "invalid_parameters",
            "Note source metadata exceeds its limits",
        ));
    }
    Ok(())
}

fn normalize_tags(tags: Vec<String>) -> Result<Vec<String>, NotesError> {
    if tags.len() > MAX_TAGS {
        return Err(NotesError::new(
            "invalid_parameters",
            "A note can have at most 20 tags",
        ));
    }
    let mut normalized = BTreeSet::new();
    for tag in tags {
        let tag = tag.trim();
        if tag.is_empty() || tag.chars().count() > MAX_TAG_CHARS {
            return Err(NotesError::new(
                "invalid_parameters",
                "Tags must contain 1 to 64 characters",
            ));
        }
        normalized.insert(tag.to_string());
    }
    Ok(normalized.into_iter().collect())
}

fn normalize_newlines(value: &str) -> String {
    value.replace("\r\n", "\n").replace('\r', "\n")
}

fn yaml_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into())
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

pub fn content_hash(content: &str) -> String {
    version_for(normalize_newlines(content).trim().as_bytes())
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn modified_at_iso(path: &Path) -> String {
    let modified = fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .and_then(|duration| {
            chrono::DateTime::from_timestamp(duration.as_secs() as i64, duration.subsec_nanos())
        });
    modified
        .map(|time| time.to_rfc3339_opts(SecondsFormat::Secs, true))
        .unwrap_or_else(now_iso)
}

fn modified_before_days(path: &Path, days: u64) -> bool {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.elapsed().ok())
        .is_some_and(|age| age.as_secs() >= days.saturating_mul(24 * 60 * 60))
}

fn atomic_json_write(path: &Path, value: &impl Serialize) -> Result<(), NotesError> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|_| NotesError::new("serialization_failed", "Cannot encode Notes metadata"))?;
    atomic_write(path, &bytes)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), NotesError> {
    let parent = path
        .parent()
        .ok_or_else(|| NotesError::new("storage_unavailable", "Invalid Notes storage path"))?;
    fs::create_dir_all(parent)
        .map_err(|_| NotesError::new("storage_unavailable", "Cannot create Notes directory"))?;
    let suffix = Uuid::new_v4().simple().to_string();
    let temporary = parent.join(format!(".write-{suffix}.tmp"));
    let backup = parent.join(format!(".write-{suffix}.bak"));
    fs::write(&temporary, bytes)
        .map_err(|_| NotesError::new("storage_unavailable", "Cannot write Notes data"))?;
    let had_previous = path.is_file();
    if had_previous {
        fs::rename(path, &backup)
            .map_err(|_| NotesError::new("storage_unavailable", "Cannot prepare Notes update"))?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if had_previous {
            let _ = fs::rename(&backup, path);
        }
        let _ = fs::remove_file(&temporary);
        return Err(NotesError::new(
            "storage_unavailable",
            format!("Cannot finish Notes update: {error}"),
        ));
    }
    if had_previous {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        compact_change_log, content_hash, now_iso, snippet_for, NoteChange, NoteSource,
        NotesVault, VaultExportBundle,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use uuid::Uuid;

    fn root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "zicode-notes-vault-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn extracts_a_readable_snippet_around_the_query() {
        let content = "A long note body with many words. ".repeat(4)
            + "The unique needle lives here in the middle of the text and is surrounded by other content. "
            + &"More trailing text after the match. ".repeat(4);
        let snippet = snippet_for(&content, "unique needle").unwrap();
        assert!(snippet.contains("unique needle"));
        assert!(snippet.starts_with('…'));
        assert!(snippet.ends_with('…'));
        assert_eq!(snippet_for("", "needle"), None);
        assert_eq!(snippet_for("body", ""), None);
    }

    #[test]
    fn creates_astro_compatible_vault_and_round_trips_markdown() {
        let root = root();
        let plugin_root = root.join("plugins");
        let vault = NotesVault::new(plugin_root).unwrap();
        let notebook = vault
            .create_notebook("Research", Some("🚀".into()), None)
            .unwrap();
        assert_eq!(notebook.icon.as_deref(), Some("🚀"));
        let note = vault
            .create_note(
                &notebook.id,
                "Roadmap",
                "# Roadmap\n\nCapability broker.",
                vec!["plugin".into(), "roadmap".into()],
                Some("⭐".into()),
                None,
            )
            .unwrap();
        assert_eq!(note.summary.icon.as_deref(), Some("⭐"));
        let round_trip = vault
            .get_note(&notebook.id, &note.summary.id)
            .expect("icon survives a Markdown round trip");
        assert_eq!(round_trip.summary.icon.as_deref(), Some("⭐"));
        let markdown = root
            .join("plugin-data/com.zicode.notes/vaults")
            .join(&notebook.id)
            .join("src/content/notes")
            .join(format!("{}.md", note.summary.id));
        assert!(markdown.is_file());
        let frontmatter = fs::read_to_string(&markdown).unwrap();
        assert!(frontmatter.contains("icon: \"⭐\""));
        assert!(markdown
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("content.config.ts")
            .is_file());
        let vault_root = markdown
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .parent()
            .unwrap();
        let package: serde_json::Value =
            serde_json::from_slice(&fs::read(vault_root.join("package.json")).unwrap()).unwrap();
        assert_eq!(package["scripts"]["build"], "astro build");
        assert!(vault_root.join("src/pages/index.astro").is_file());
        assert!(vault_root.join("src/pages/notes/[...id].astro").is_file());
        let text = fs::read_to_string(&markdown).unwrap();
        assert!(text.contains("title: \"Roadmap\""));
        assert!(text.contains("# Roadmap"));
        let loaded = vault.get_note(&notebook.id, &note.summary.id).unwrap();
        assert_eq!(loaded.content, "# Roadmap\n\nCapability broker.");
        assert_eq!(loaded.summary.tags, vec!["plugin", "roadmap"]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_reparenting_a_notebook_into_its_own_descendant() {
        let root = root();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let parent = vault.create_notebook("Parent", None, None).unwrap();
        let child = vault
            .create_notebook("Child", None, Some(parent.id.clone()))
            .unwrap();
        let grandchild = vault
            .create_notebook("Grandchild", None, Some(child.id.clone()))
            .unwrap();

        // Moving a notebook under its own descendant would create a cycle.
        let cycle = vault
            .update_notebook(&parent.id, None, None, Some(grandchild.id.clone()))
            .unwrap_err();
        assert_eq!(cycle.code, "invalid_parent");

        // Moving a notebook under itself is also rejected.
        let self_parent = vault
            .update_notebook(&child.id, None, None, Some(child.id.clone()))
            .unwrap_err();
        assert_eq!(self_parent.code, "invalid_parent");

        // Moving to an unrelated notebook still works.
        let sibling = vault.create_notebook("Sibling", None, None).unwrap();
        let updated = vault
            .update_notebook(&grandchild.id, None, None, Some(sibling.id.clone()))
            .unwrap();
        assert_eq!(updated.parent_id.as_deref(), Some(sibling.id.as_str()));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn exports_every_notebook_as_one_workspace_bundle() {
        let root = root();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let first = vault.create_notebook("Alpha", None, None).unwrap();
        vault
            .create_note(&first.id, "A1", "# A1", vec![], None, None)
            .unwrap();
        let second = vault.create_notebook("Beta", None, None).unwrap();
        vault
            .create_note(&second.id, "B1", "# B1", vec![], None, None)
            .unwrap();

        let exports = vault.export_all_notebooks().unwrap();
        let titles: Vec<String> = exports
            .iter()
            .map(|export| export.notebook.title.clone())
            .collect();
        assert_eq!(titles, vec!["Alpha", "Beta"]);
        assert_eq!(exports[0].notes.len(), 1);
        assert_eq!(exports[1].notes.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn restores_every_notebook_from_a_workspace_bundle() {
        let root = root();
        let source = NotesVault::new(root.join("source")).unwrap();
        let first = source.create_notebook("Alpha", None, None).unwrap();
        source
            .create_note(&first.id, "A1", "# A1", vec![], None, None)
            .unwrap();
        let second = source.create_notebook("Beta", None, None).unwrap();
        source
            .create_note(&second.id, "B1", "# B1", vec![], None, None)
            .unwrap();
        let exports = source.export_all_notebooks().unwrap();
        let bundle = VaultExportBundle {
            schema_version: 1,
            notebooks: exports,
        };

        let target = NotesVault::new(root.join("target")).unwrap();
        let imported = target.import_all_export(bundle).unwrap();
        let titles: Vec<String> = imported.iter().map(|n| n.title.clone()).collect();
        assert_eq!(titles, vec!["Alpha (Imported)", "Beta (Imported)"]);
        assert_eq!(imported[0].note_count, 1);
        assert_eq!(imported[1].note_count, 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "downloads the pinned Astro dependency"]
    fn publishes_a_notebook_as_a_static_astro_site() {
        let root = root();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let notebook = vault.create_notebook("Publish test", None, None).unwrap();
        vault
            .create_note(
                &notebook.id,
                "Hello",
                "# Built\n\nThis page was generated by Astro.",
                vec!["publish".into()],
                None,
                None,
            )
            .unwrap();

        let report = vault.publish_astro(&notebook.id).unwrap();

        assert_eq!(report.note_count, 1);
        assert!(vault
            .vault_root(&notebook.id)
            .unwrap()
            .join("dist/index.html")
            .is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn enforces_optimistic_versions_and_preserves_source_metadata() {
        let root = root();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let notebook = vault.create_notebook("Clips", None, None).unwrap();
        let original = vault
            .create_note(
                &notebook.id,
                "Example",
                "Captured body",
                vec!["clip".into()],
                None,
                Some(NoteSource {
                    url: "https://example.com/article".into(),
                    captured_at: "2026-07-31T00:00:00Z".into(),
                    content_hash: content_hash("Captured body"),
                    author: Some("Example Author".into()),
                    published_at: None,
                    site_name: None,
                    image: None,
                }),
            )
            .unwrap();
        let updated = vault
            .save_note(
                &notebook.id,
                &original.summary.id,
                "Example edited",
                "Captured body\n\nComment",
                vec!["clip".into()],
                None,
                &original.summary.version,
            )
            .unwrap();
        assert_eq!(
            updated.summary.source.unwrap().url,
            "https://example.com/article"
        );
        assert_eq!(
            vault
                .save_note(
                    &notebook.id,
                    &original.summary.id,
                    "Stale",
                    "Overwrite",
                    vec![],
                    None,
                    &original.summary.version,
                )
                .unwrap_err()
                .code,
            "version_conflict"
        );
        let duplicate = vault
            .find_source_duplicate(&content_hash("Captured body"))
            .unwrap()
            .unwrap();
        assert_eq!(duplicate.id, original.summary.id);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stores_safe_attachments_and_round_trips_readable_backups() {
        let root = root();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let notebook = vault.create_notebook("Portable", None, None).unwrap();
        let note = vault
            .create_note(
                &notebook.id,
                "With image",
                "Attachment below.",
                vec![],
                None,
                None,
            )
            .unwrap();
        let attachment = vault
            .store_attachment(
                &notebook.id,
                &note.summary.id,
                "diagram.png",
                "image/png",
                b"safe-png-test-bytes",
            )
            .unwrap();
        assert!(attachment.markdown.starts_with("![diagram.png]"));
        let (loaded, mime) = vault
            .read_attachment(&notebook.id, &note.summary.id, &attachment.id)
            .unwrap();
        assert_eq!(loaded, b"safe-png-test-bytes");
        assert_eq!(mime, "image/png");
        assert_eq!(
            vault
                .store_attachment(
                    &notebook.id,
                    &note.summary.id,
                    "payload.exe",
                    "application/octet-stream",
                    b"MZ"
                )
                .unwrap_err()
                .code,
            "invalid_parameters"
        );

        let backup = vault.export_notebook(&notebook.id).unwrap();
        assert_eq!(backup.notes.len(), 1);
        assert_eq!(backup.attachments.len(), 1);
        let imported = vault.import_export(backup).unwrap();
        assert_eq!(imported.note_count, 1);
        let imported_note = vault
            .get_note(&imported.id, &note.summary.id)
            .expect("backup preserves stable note IDs inside the new vault");
        assert_eq!(imported_note.content, "Attachment below.");
        let (imported_bytes, imported_mime) = vault
            .read_attachment(&imported.id, &note.summary.id, &attachment.id)
            .unwrap();
        assert_eq!(imported_bytes, b"safe-png-test-bytes");
        assert_eq!(imported_mime, "image/png");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn backups_include_trashed_notes_and_their_attachments() {
        let root = root();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let notebook = vault.create_notebook("Archive", None, None).unwrap();
        let note = vault
            .create_note(
                &notebook.id,
                "Retired",
                "Trash me later",
                vec![],
                None,
                None,
            )
            .unwrap();
        let attachment = vault
            .store_attachment(
                &notebook.id,
                &note.summary.id,
                "proof.txt",
                "text/plain",
                b"trash attachment",
            )
            .unwrap();
        vault
            .delete_note(&notebook.id, &note.summary.id, &note.summary.version)
            .unwrap();

        let backup = vault.export_notebook(&notebook.id).unwrap();
        assert!(backup.notes.is_empty());
        assert_eq!(backup.trashed_notes.len(), 1);
        assert_eq!(backup.trashed_notes[0].note.summary.title, "Retired");
        assert!(!backup.trashed_notes[0].deleted_at.is_empty());
        assert_eq!(backup.attachments.len(), 1);

        let imported = vault.import_export(backup).unwrap();
        let trash = vault.list_trash(Some(&imported.id)).unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].note.title, "Retired");
        let restored = vault.restore_note(&imported.id, &note.summary.id).unwrap();
        assert_eq!(restored.content, "Trash me later");
        let (bytes, mime) = vault
            .read_attachment(&imported.id, &note.summary.id, &attachment.id)
            .unwrap();
        assert_eq!(bytes, b"trash attachment");
        assert_eq!(mime, "text/plain");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn imports_markdown_and_rebuilds_an_index_with_corruption_diagnostics() {
        let root = root();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let notebook = vault.create_notebook("Recovery", None, None).unwrap();
        let imported = vault
            .import_markdown(
                &notebook.id,
                "outside-note.md",
                "---\ntitle: \"External note\"\ntags: [\"imported\"]\n---\n\nReadable body.",
            )
            .unwrap();
        assert_eq!(imported.summary.title, "External note");
        assert_eq!(imported.summary.tags, vec!["imported"]);

        let vault_root = root
            .join("plugin-data/com.zicode.notes/vaults")
            .join(&notebook.id);
        fs::write(
            vault_root.join("src/content/notes/broken.md"),
            "not frontmatter",
        )
        .unwrap();
        fs::create_dir_all(vault_root.join("public/attachments/orphan")).unwrap();
        let report = vault.rebuild_index(&notebook.id).unwrap();
        assert_eq!(report.valid_notes, 1);
        assert_eq!(report.invalid_files[0].file_name, "broken.md");
        assert_eq!(report.orphan_attachment_directories, vec!["orphan"]);
        let index = fs::read_to_string(vault_root.join(".zicode/index.json")).unwrap();
        assert!(index.contains("External note"));
        assert!(index.contains("broken.md"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn derives_links_backlinks_and_tag_similarity_from_readable_markdown() {
        let root = root();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let notebook = vault.create_notebook("Knowledge", None, None).unwrap();
        let target = vault
            .create_note(
                &notebook.id,
                "Architecture",
                "Host and runtime boundaries.",
                vec!["design".into(), "runtime".into()],
                None,
                None,
            )
            .unwrap();
        let source = vault
            .create_note(
                &notebook.id,
                "Decision",
                &format!(
                    "See [[Architecture]] and zicode-note://{}/{}.",
                    notebook.id, target.summary.id
                ),
                vec!["design".into(), "decision".into()],
                None,
                None,
            )
            .unwrap();
        vault
            .create_note(
                &notebook.id,
                "Architecture",
                "A conflicting architecture proposal.",
                vec![],
                None,
                None,
            )
            .unwrap();
        let snapshot = vault.knowledge().unwrap();
        assert_eq!(snapshot.links.len(), 2);
        assert!(snapshot
            .links
            .iter()
            .all(|link| link.from_note_id == source.summary.id));
        assert_eq!(snapshot.similar.len(), 1);
        assert_eq!(snapshot.similar[0].shared_tags, vec!["design"]);
        assert_eq!(snapshot.conflicts.len(), 1);
        assert_eq!(snapshot.conflicts[0].reason, "duplicate_title");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn emits_incremental_changes_and_delete_tombstones() {
        let root = root();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let notebook = vault.create_notebook("Sync", None, None).unwrap();
        let created = vault
            .create_note(&notebook.id, "Draft", "one", vec![], None, None)
            .unwrap();
        let first = vault.changes(None, 1).unwrap();
        assert_eq!(first.changes[0].operation, "created");
        let updated = vault
            .save_note(
                &notebook.id,
                &created.summary.id,
                "Draft",
                "two",
                vec![],
                None,
                &created.summary.version,
            )
            .unwrap();
        vault
            .delete_note(&notebook.id, &updated.summary.id, &updated.summary.version)
            .unwrap();
        let remainder = vault.changes(first.next_cursor.as_deref(), 10).unwrap();
        assert_eq!(
            remainder
                .changes
                .iter()
                .map(|change| change.operation.as_str())
                .collect::<Vec<_>>(),
            vec!["updated", "deleted"]
        );
        assert!(remainder.changes[1].version.is_none());
        assert!(!remainder.reset_required);
        assert!(
            vault
                .changes(Some("unknown-cursor"), 10)
                .unwrap()
                .reset_required
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn supports_nested_notebooks_and_moves_notes_between_them() {
        let root = root();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let parent = vault.create_notebook("Parent", None, None).unwrap();
        let child = vault
            .create_notebook("Child", Some("📂".into()), Some(parent.id.clone()))
            .unwrap();
        assert_eq!(child.parent_id.as_deref(), Some(parent.id.as_str()));
        let note = vault
            .create_note(&parent.id, "Draft", "body", vec![], None, None)
            .unwrap();
        let moved = vault
            .move_note(
                &parent.id,
                &note.summary.id,
                &child.id,
                &note.summary.version,
            )
            .unwrap();
        assert_eq!(moved.summary.notebook_id, child.id);
        assert!(vault.get_note(&child.id, &note.summary.id).is_ok());
        assert!(vault.get_note(&parent.id, &note.summary.id).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn scoped_vaults_isolate_workspaces_and_claim_legacy_notebooks_once() {
        let root = root();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let workspace_a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let workspace_b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        let scoped_a = vault.scoped(workspace_a).unwrap();
        let scoped_b = vault.scoped(workspace_b).unwrap();
        let notebook_a = scoped_a.create_notebook("Project A", None, None).unwrap();
        let notebook_b = scoped_b.create_notebook("Project B", None, None).unwrap();
        assert_eq!(notebook_a.workspace_id, workspace_a);
        assert_eq!(notebook_b.workspace_id, workspace_b);
        assert_eq!(
            scoped_a
                .list(None, None, None, false)
                .unwrap()
                .notebooks
                .len(),
            1
        );
        assert_eq!(
            scoped_b
                .list(None, None, None, false)
                .unwrap()
                .notebooks
                .len(),
            1
        );
        // Legacy bare vault dirs are claimed by the first scoped workspace.
        let legacy_root =
            std::env::temp_dir().join(format!("zicode-notes-legacy-{}", Uuid::new_v4()));
        let legacy = NotesVault::new(legacy_root.join("plugins")).unwrap();
        let legacy_id = Uuid::new_v4().to_string();
        fs::create_dir_all(
            legacy_root
                .join("plugin-data")
                .join("com.zicode.notes")
                .join("vaults")
                .join(&legacy_id),
        )
        .unwrap();
        let report = legacy.migrate_legacy(workspace_a).unwrap();
        assert_eq!(report.moved_notebooks, 1);
        assert!(legacy_root
            .join("plugin-data")
            .join("com.zicode.notes")
            .join("vaults")
            .join(workspace_a)
            .join(&legacy_id)
            .is_dir());
        let again = legacy.migrate_legacy(workspace_a).unwrap();
        assert!(again.skipped);
        let _ = fs::remove_dir_all(legacy_root);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn deletes_a_notebook_within_its_workspace_scope() {
        let root = root();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let workspace_a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let workspace_b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        let scoped_a = vault.scoped(workspace_a).unwrap();
        let scoped_b = vault.scoped(workspace_b).unwrap();
        let notebook_a = scoped_a.create_notebook("To delete", None, None).unwrap();
        let notebook_b = scoped_b.create_notebook("Keep me", None, None).unwrap();

        scoped_a.delete_notebook(&notebook_a.id).unwrap();

        assert_eq!(
            scoped_a
                .list(None, None, None, false)
                .unwrap()
                .notebooks
                .len(),
            0
        );
        assert_eq!(
            scoped_b
                .list(None, None, None, false)
                .unwrap()
                .notebooks
                .len(),
            1
        );
        assert!(scoped_a.get_note(&notebook_a.id, "x").is_err());
        assert_eq!(
            notebook_b.id,
            scoped_b.list(None, None, None, false).unwrap().notebooks[0].id
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn deleting_a_notebook_moves_notes_to_trash_and_restores_them() {
        let root = root();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let workspace_a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let scoped_a = vault.scoped(workspace_a).unwrap();
        let notebook = scoped_a.create_notebook("Trash me", None, None).unwrap();
        let note = scoped_a
            .create_note(&notebook.id, "Recoverable", "body", vec![], None, None)
            .unwrap();

        scoped_a.delete_notebook(&notebook.id).unwrap();

        // The notebook disappears from the active list but its note is in
        // the workspace trash, tagged with the notebook title.
        assert_eq!(
            scoped_a
                .list(None, None, None, false)
                .unwrap()
                .notebooks
                .len(),
            0
        );
        let trash = scoped_a.list_trash(None).unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].notebook_id, notebook.id);
        assert_eq!(trash[0].notebook_title.as_deref(), Some("Trash me"));
        assert_eq!(trash[0].note.id, note.summary.id);

        // Restoring the note brings the notebook back and makes it readable.
        let restored = scoped_a
            .restore_note(&notebook.id, &note.summary.id)
            .unwrap();
        assert_eq!(restored.summary.id, note.summary.id);
        assert_eq!(
            scoped_a
                .list(None, None, None, false)
                .unwrap()
                .notebooks
                .len(),
            1
        );
        assert!(scoped_a.get_note(&notebook.id, &note.summary.id).is_ok());

        // Delete again and empty the trash to purge permanently.
        scoped_a.delete_notebook(&notebook.id).unwrap();
        assert_eq!(scoped_a.empty_trash(None).unwrap(), 1);
        assert!(scoped_a.list_trash(None).unwrap().is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn deleting_a_parent_notebook_moves_descendants_to_trash() {
        let root = root();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let workspace_a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let scoped_a = vault.scoped(workspace_a).unwrap();
        let parent = scoped_a.create_notebook("Parent", None, None).unwrap();
        let child = scoped_a
            .create_notebook("Child", None, Some(parent.id.clone()))
            .unwrap();
        let parent_note = scoped_a
            .create_note(&parent.id, "P", "p", vec![], None, None)
            .unwrap();
        let child_note = scoped_a
            .create_note(&child.id, "C", "c", vec![], None, None)
            .unwrap();

        scoped_a.delete_notebook(&parent.id).unwrap();

        assert!(scoped_a
            .list(None, None, None, false)
            .unwrap()
            .notebooks
            .is_empty());
        let trash = scoped_a.list_trash(None).unwrap();
        assert_eq!(trash.len(), 2);
        assert!(trash
            .iter()
            .any(|entry| entry.note.id == parent_note.summary.id));
        assert!(trash
            .iter()
            .any(|entry| entry.note.id == child_note.summary.id));
        assert!(trash.iter().all(|entry| entry.notebook_title.is_some()));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn trash_round_trips_restore_and_purge() {
        let root = root();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let notebook = vault.create_notebook("Research", None, None).unwrap();
        let note = vault
            .create_note(
                &notebook.id,
                "Draft",
                "Recoverable body",
                vec![],
                Some("📝".into()),
                None,
            )
            .unwrap();

        vault
            .delete_note(&notebook.id, &note.summary.id, &note.summary.version)
            .unwrap();
        assert!(vault.get_note(&notebook.id, &note.summary.id).is_err());

        let trash = vault.list_trash(None).unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].notebook_id, notebook.id);
        assert_eq!(trash[0].note.id, note.summary.id);
        assert!(!trash[0].deleted_at.is_empty());

        // The note is no longer in the active index after trashing.
        assert_eq!(
            vault
                .delete_note(&notebook.id, &note.summary.id, "stale")
                .unwrap_err()
                .code,
            "note_not_found"
        );
        assert_eq!(vault.list_trash(None).unwrap().len(), 1);

        let restored = vault.restore_note(&notebook.id, &note.summary.id).unwrap();
        assert_eq!(restored.content, "Recoverable body");
        assert!(vault.list_trash(None).unwrap().is_empty());
        assert_eq!(
            vault
                .get_note(&notebook.id, &note.summary.id)
                .unwrap()
                .summary
                .id,
            note.summary.id
        );

        vault
            .delete_note(&notebook.id, &note.summary.id, &restored.summary.version)
            .unwrap();
        vault.purge_note(&notebook.id, &note.summary.id).unwrap();
        assert!(vault.list_trash(None).unwrap().is_empty());
        assert!(vault.purge_note(&notebook.id, &note.summary.id).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn trash_is_isolated_between_workspaces() {
        let root = root();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let workspace_a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let workspace_b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        let scoped_a = vault.scoped(workspace_a).unwrap();
        let scoped_b = vault.scoped(workspace_b).unwrap();
        let notebook_a = scoped_a.create_notebook("Project A", None, None).unwrap();
        let note = scoped_a
            .create_note(&notebook_a.id, "Secret", "Body", vec![], None, None)
            .unwrap();
        scoped_a
            .delete_note(&notebook_a.id, &note.summary.id, &note.summary.version)
            .unwrap();
        assert_eq!(scoped_a.list_trash(None).unwrap().len(), 1);
        assert!(scoped_b.list_trash(None).unwrap().is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn empty_trash_purges_every_trashed_note() {
        let root = root();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let notebook = vault.create_notebook("Research", None, None).unwrap();
        let first = vault
            .create_note(&notebook.id, "First", "Body one", vec![], None, None)
            .unwrap();
        let second = vault
            .create_note(&notebook.id, "Second", "Body two", vec![], None, None)
            .unwrap();
        vault
            .delete_note(&notebook.id, &first.summary.id, &first.summary.version)
            .unwrap();
        vault
            .delete_note(&notebook.id, &second.summary.id, &second.summary.version)
            .unwrap();
        assert_eq!(vault.list_trash(None).unwrap().len(), 2);

        assert_eq!(vault.empty_trash(None).unwrap(), 2);
        assert!(vault.list_trash(None).unwrap().is_empty());
        assert_eq!(
            vault
                .restore_note(&notebook.id, &first.summary.id)
                .unwrap_err()
                .code,
            "trash_empty"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn trash_purges_entries_older_than_retention() {
        let root = root();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let notebook = vault.create_notebook("Research", None, None).unwrap();
        let note = vault
            .create_note(&notebook.id, "Expired", "Old body", vec![], None, None)
            .unwrap();
        vault
            .delete_note(&notebook.id, &note.summary.id, &note.summary.version)
            .unwrap();

        // A zero-day retention purges everything on the next listing.
        assert!(vault.list_trash_with_retention(None, 0).unwrap().is_empty());
        assert!(vault.list_trash(None).unwrap().is_empty());
        assert!(vault.restore_note(&notebook.id, &note.summary.id).is_err());

        // A long retention keeps fresh entries.
        let fresh = vault
            .create_note(&notebook.id, "Fresh", "New body", vec![], None, None)
            .unwrap();
        vault
            .delete_note(&notebook.id, &fresh.summary.id, &fresh.summary.version)
            .unwrap();
        assert_eq!(vault.list_trash_with_retention(None, 365).unwrap().len(), 1);
        assert_eq!(vault.list_trash(None).unwrap().len(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn compacts_change_logs_without_blocking_future_writes() {
        let root = std::env::temp_dir().join(format!("zicode-change-compact-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("changes.jsonl");
        let records = (0..3)
            .map(|index| NoteChange {
                cursor: format!("cursor-{index}"),
                operation: "updated".to_string(),
                notebook_id: Uuid::new_v4().to_string(),
                note_id: Uuid::new_v4().to_string(),
                version: Some(format!("version-{index}")),
                changed_at: now_iso(),
            })
            .collect::<Vec<_>>();
        let contents = records
            .iter()
            .map(|record| serde_json::to_string(record).unwrap())
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&path, format!("{contents}\n")).unwrap();

        compact_change_log(&path, 1, 2).unwrap();

        let compacted = fs::read_to_string(&path).unwrap();
        assert!(!compacted.contains("cursor-0"));
        assert!(compacted.contains("cursor-1"));
        assert!(compacted.contains("cursor-2"));
        fs::remove_dir_all(root).unwrap();
    }
}
