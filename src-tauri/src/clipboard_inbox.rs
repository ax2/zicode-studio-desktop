//! Clipboard inbox: a workspace-scoped capture list for quick text and URL notes.
//!
//! Storage is a single JSON file per workspace, so the host HTTP layer and the
//! capability broker stay consistent without sharing in-memory state.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use uuid::Uuid;

const MAX_ITEMS: usize = 500;
const MAX_TEXT_CHARS: usize = 200_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardItem {
    pub id: String,
    pub text: String,
    pub kind: String,
    pub source: String,
    pub created_at: String,
}

fn inbox_path(workspace_root: &Path) -> PathBuf {
    workspace_root
        .join(".zicode")
        .join("clipboard")
        .join("inbox.json")
}

fn kind_of(text: &str) -> &'static str {
    let trimmed = text.trim_start();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        "url"
    } else {
        "text"
    }
}

fn read_items(workspace_root: &Path) -> Vec<ClipboardItem> {
    std::fs::read(inbox_path(workspace_root))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Vec<ClipboardItem>>(&bytes).ok())
        .unwrap_or_default()
}

fn write_items(workspace_root: &Path, items: &[ClipboardItem]) -> Result<(), String> {
    let path = inbox_path(workspace_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create clipboard directory: {error}"))?;
    }
    let bytes = serde_json::to_vec_pretty(items)
        .map_err(|error| format!("Cannot serialize clipboard inbox: {error}"))?;
    std::fs::write(&path, bytes).map_err(|error| format!("Cannot save clipboard inbox: {error}"))
}

pub fn add(workspace_root: &Path, text: &str, source: &str) -> Result<ClipboardItem, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("Clipboard text is empty".to_string());
    }
    if trimmed.chars().count() > MAX_TEXT_CHARS {
        return Err(format!(
            "Clipboard text exceeds the {MAX_TEXT_CHARS} character limit"
        ));
    }
    let item = ClipboardItem {
        id: Uuid::new_v4().simple().to_string(),
        text: trimmed.to_string(),
        kind: kind_of(trimmed).to_string(),
        source: source.trim().to_string(),
        created_at: Utc::now().to_rfc3339(),
    };
    let mut items = read_items(workspace_root);
    items.insert(0, item.clone());
    items.truncate(MAX_ITEMS);
    write_items(workspace_root, &items)?;
    Ok(item)
}

pub fn list(workspace_root: &Path) -> Vec<ClipboardItem> {
    read_items(workspace_root)
}

pub fn remove(workspace_root: &Path, id: &str) -> Result<bool, String> {
    let mut items = read_items(workspace_root);
    let before = items.len();
    items.retain(|item| item.id != id);
    let removed = items.len() < before;
    write_items(workspace_root, &items)?;
    Ok(removed)
}

pub fn clear(workspace_root: &Path) -> Result<usize, String> {
    let removed = read_items(workspace_root).len();
    write_items(workspace_root, &[])?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root() -> PathBuf {
        std::env::temp_dir().join(format!("clipboard-inbox-test-{}", Uuid::new_v4().simple()))
    }

    #[test]
    fn adds_lists_and_removes_items() {
        let root = tmp_root();
        let item = add(&root, "  https://example.com/roadmap  ", "clipboard").unwrap();
        assert_eq!(item.kind, "url");
        assert_eq!(item.text, "https://example.com/roadmap");
        assert_eq!(list(&root).len(), 1);
        assert!(remove(&root, &item.id).unwrap());
        assert!(list(&root).is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rejects_empty_text_and_persists_to_disk() {
        let root = tmp_root();
        assert!(add(&root, "   ", "manual").is_err());
        add(&root, "hello", "manual").unwrap();
        assert_eq!(list(&root).len(), 1);
        assert_eq!(list(&root)[0].text, "hello");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn clear_removes_every_item() {
        let root = tmp_root();
        add(&root, "one", "manual").unwrap();
        add(&root, "two", "manual").unwrap();
        assert_eq!(clear(&root).unwrap(), 2);
        assert!(list(&root).is_empty());
        std::fs::remove_dir_all(&root).ok();
    }
}
