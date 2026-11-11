//! File choices stay in the native picker. Webpages never receive file paths.
use super::bookmark_html;
use crate::browser_store::{bookmarks, Store};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{io::{Read, Write}, path::Path};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request { Import, Export { #[serde(rename = "expectedRevision")] expected_revision: i64 } }
fn read(path: &Path) -> Result<bookmark_html::Imported, String> {
    let file = std::fs::File::open(path).map_err(|_| "Could not read bookmark file")?;
    let metadata = file.metadata().map_err(|_| "Could not read bookmark file")?;
    if !metadata.is_file() || metadata.len() > bookmark_html::MAX_FILE_BYTES as u64 { return Err("Bookmark file is too large".into()); }
    let mut bytes = vec![];
    file.take(bookmark_html::MAX_FILE_BYTES as u64 + 1).read_to_end(&mut bytes).map_err(|_| "Could not read bookmark file")?;
    if bytes.len() > bookmark_html::MAX_FILE_BYTES { return Err("Bookmark file is too large".into()); }
    let text = String::from_utf8(bytes).map_err(|_| "Choose a UTF-8 bookmarks HTML file")?;
    bookmark_html::parse(&text)
}
fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if !path.extension().and_then(|e|e.to_str()).is_some_and(|e|e.eq_ignore_ascii_case("html") || e.eq_ignore_ascii_case("htm")) { return Err("Choose an HTML filename".into()); }
    if path.exists() && (!path.is_file() || path.is_symlink()) { return Err("Choose a regular HTML file".into()); }
    let parent = path.parent().ok_or("Invalid bookmark destination")?;
    let temporary = parent.join(format!(".zicode-bookmarks-{}.tmp", uuid::Uuid::new_v4()));
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|_| "Could not save bookmark file")?;
    let result = (|| {
        file.write_all(bytes).and_then(|_|file.sync_all()).map_err(|_| "Could not save bookmark file")?;
        drop(file);
        std::fs::rename(&temporary,path).map_err(|_| "Could not save bookmark file".to_owned())
    })();
    if result.is_err() { let _ = std::fs::remove_file(&temporary); }
    result
}
#[tauri::command]
pub(crate) async fn browser_bookmark_file(window: WebviewWindow, request: Request) -> Result<Option<Value>, String> {
    crate::require_workspace_window(&window)?;
    let app = window.app_handle().clone();
    match request {
        Request::Import => {
            let picked = tauri::async_runtime::spawn_blocking(move || app.dialog().file().add_filter("Bookmarks HTML", &["html","htm"]).blocking_pick_file()).await.map_err(|_| "Bookmark file picker unavailable")?;
            let Some(picked) = picked else { return Ok(None); };
            crate::require_workspace_window(&window)?;
            let path = picked.into_path().map_err(|_| "Invalid bookmark file")?;
            tauri::async_runtime::spawn_blocking(move || read(&path).and_then(|v|serde_json::to_value(v).map_err(|e|e.to_string())).map(Some)).await.map_err(|_| "Bookmark import worker stopped")?
        }
        Request::Export { expected_revision } => {
            let root = crate::app_paths::data_root()?.join("browser"); let owner = window.label().to_owned();
            let (html, folders, bookmarks) = tauri::async_runtime::spawn_blocking(move || {
                let library = Store::open(&root)?.bookmarks(&owner, bookmarks::Request::List)?;
                if library.revision != expected_revision { return Err("Bookmarks changed; reload before saving".to_owned()); }
                Ok((bookmark_html::export(&library), library.folders.len(), library.bookmarks.len()))
            }).await.map_err(|_| "Bookmark export worker stopped")??;
            let picked = tauri::async_runtime::spawn_blocking(move || app.dialog().file().set_file_name("bookmarks.html").add_filter("Bookmarks HTML", &["html","htm"]).blocking_save_file()).await.map_err(|_| "Bookmark file picker unavailable")?;
            let Some(picked) = picked else { return Ok(None); };
            crate::require_workspace_window(&window)?;
            let path = picked.into_path().map_err(|_| "Invalid bookmark destination")?;
            tauri::async_runtime::spawn_blocking(move || { write(&path,html.as_bytes())?; Ok(Some(json!({"name":path.file_name().and_then(|n|n.to_str()).unwrap_or("bookmarks.html"),"bytes":html.len(),"folders":folders,"bookmarks":bookmarks}))) }).await.map_err(|_| "Bookmark export worker stopped")?
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saves_utf8_replaces_whole_file_and_rejects_unsafe_destinations() {
        let root = std::env::temp_dir().join(format!("bookmark-export-{}", uuid::Uuid::new_v4())); std::fs::create_dir(&root).unwrap();
        let path = root.join("书签.html");write(&path,b"old").unwrap();write(&path,"中文完整内容".as_bytes()).unwrap();assert_eq!(std::fs::read_to_string(&path).unwrap(),"中文完整内容");
        let folder = root.join("folder.html"); std::fs::create_dir(&folder).unwrap();assert!(write(&folder,b"no").is_err());assert!(write(&root.join("file.exe"),b"no").is_err());assert!(!root.join("file.exe").exists());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(),2);
    }
}
