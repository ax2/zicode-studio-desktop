//! Trusted workspace-window download requests; destinations never come from webpages.
use super::{runtime, Request};
use serde_json::{json, Value};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

async fn live(window: WebviewWindow, request: Request) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    window.app_handle().clone().run_on_main_thread(move || {
        let result = crate::require_workspace_window(&window).and_then(|_| runtime::execute(&window,None,request));
        let _ = tx.send(result);
    }).map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "Browser UI thread stopped")?
}
fn matches_query(entry: &Value, query: Option<&str>) -> bool {
    query.is_none_or(|query| {
        ["name", "url"].iter().any(|field| {
            entry[*field].as_str().is_some_and(|value| value.to_ascii_lowercase().contains(query))
        })
    })
}

pub async fn list(window: WebviewWindow, before: Option<i64>, query: Option<String>) -> Result<Value, String> {
    let query = query.as_deref().map(str::trim).filter(|query| !query.is_empty());
    if query.is_some_and(|query| query.len() > 1024 || query.chars().count() > 256) {
        return Err("Download search is too long".into());
    }
    let query = query.map(str::to_ascii_lowercase);
    let live = live(window.clone(), Request::DownloadLive).await?;
    let mut page = super::download_journal::list(window.label().into(), before, query.clone()).await?;
    let entries = page["entries"].as_array_mut().ok_or("Invalid download history")?;
    let current = live.as_array().ok_or("Invalid live downloads")?;
    for saved in entries.iter_mut() {
        if let Some(now) = current.iter().find(|v| v["id"] == saved["id"]) { *saved = now.clone(); }
        else if matches!(saved["state"].as_str(), Some("waiting" | "downloading")) {
            saved["state"] = json!("interrupted"); saved["error"] = json!("Studio closed before this download finished");
        }
    }
    entries.retain(|entry| matches_query(entry, query.as_deref()));
    if before.is_none() {
        for now in current {
            if matches!(now["state"].as_str(), Some("waiting" | "downloading"))
                && matches_query(now, query.as_deref())
                && !entries.iter().any(|saved| saved["id"] == now["id"])
            {
                entries.insert(0, now.clone());
            }
        }
    }
    page["directory"] = json!(window.app_handle().path().download_dir().map_err(|e| e.to_string())?);
    Ok(page)
}
fn ensure_removable(current: &Value, id: &str) -> Result<(), String> {
    let entries = current.as_array().ok_or("Invalid live downloads")?;
    if entries.iter().any(|entry| entry["id"] == id && !matches!(entry["state"].as_str(), Some("completed" | "cancelled" | "failed" | "interrupted"))) {
        return Err("Finish or cancel this download before removing it".into());
    }
    Ok(())
}
pub async fn remove(window: WebviewWindow, id: String) -> Result<Value, String> {
    let current = live(window.clone(), Request::DownloadLive).await?;
    ensure_removable(&current, &id)?;
    super::download_journal::remove(window.label().into(), id).await?;
    Ok(Value::Null)
}

pub async fn choose(window: WebviewWindow, id: String) -> Result<Value, String> {
    let name = live(window.clone(),Request::DownloadName { id: id.clone() }).await?;
    let name = name.as_str().ok_or("Invalid download filename")?.to_owned();
    let app = window.app_handle().clone();
    let directory = app.path().download_dir().map_err(|e| e.to_string())?;
    let picked = tauri::async_runtime::spawn_blocking(move || app.dialog().file().set_directory(directory).set_file_name(name).blocking_save_file())
        .await.map_err(|_| "Download file picker unavailable")?;
    let Some(picked) = picked else { return Ok(Value::Null); };
    let path = picked.into_path().map_err(|_| "Invalid download destination")?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    window.app_handle().clone().run_on_main_thread(move || {
        let result = crate::require_workspace_window(&window).and_then(|_| runtime::save_download(&window,&id,&path));
        let _ = tx.send(result);
    }).map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "Browser UI thread stopped")??;
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn removal_requires_a_terminal_or_previous_session_download() {
        for state in ["waiting", "downloading", "unknown"] {
            assert!(ensure_removable(&json!([{"id":"one","state":state}]), "one").is_err());
        }
        for state in ["completed", "cancelled", "failed", "interrupted"] {
            assert!(ensure_removable(&json!([{"id":"one","state":state}]), "one").is_ok());
        }
        assert!(ensure_removable(&json!([]), "previous-session").is_ok());
        assert!(ensure_removable(&Value::Null, "one").is_err());
    }
}
