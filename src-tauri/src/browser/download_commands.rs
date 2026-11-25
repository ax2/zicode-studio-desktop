//! Trusted workspace-window download requests; destinations never come from webpages.
use super::{engine::native_downloads::active, runtime, Request};
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
    merge_history(&mut page, &live, before, query.as_deref())?;
    page["directory"] = json!(window.app_handle().path().download_dir().map_err(|e| e.to_string())?);
    Ok(page)
}
fn merge_history(
    page: &mut Value,
    live: &Value,
    before: Option<i64>,
    query: Option<&str>,
) -> Result<(), String> {
    let entries = page["entries"].as_array_mut().ok_or("Invalid download history")?;
    let current = live.as_array().ok_or("Invalid live downloads")?;
    for saved in entries.iter_mut() {
        if let Some(now) = current.iter().find(|v| v["id"] == saved["id"]) { *saved = now.clone(); }
        else if saved["state"].as_str().is_some_and(active) {
            // This is an old operation with no live file or progress information.
            saved["state"] = json!("interrupted");
            saved["canResume"] = json!(false);
            saved["error"] = json!("Studio closed before this download finished");
            saved["received"] = Value::Null;
            saved["path"] = Value::Null;
            saved["partialPath"] = Value::Null;
        }
    }
    entries.retain(|entry| matches_query(entry, query));
    if before.is_none() {
        for now in current {
            if now["state"].as_str().is_some_and(active)
                && matches_query(now, query)
                && !entries.iter().any(|saved| saved["id"] == now["id"])
            {
                entries.insert(0, now.clone());
            }
        }
    }
    Ok(())
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
    fn history_hides_unverified_files_and_progress_after_an_active_operation_is_lost() {
        let mut page = json!({"entries": [
            {"id":"lost-waiting","state":"waiting","received":0},
            {"id":"lost-download","state":"downloading","path":"chosen.txt","partialPath":"placeholder.txt","received":0},
            {"id":"lost-pause","state":"paused","canResume":true,"partialPath":"old.txt","received":262144},
            {"id":"still-live","state":"downloading","received":0},
            {"id":"failed","state":"failed","received":4,"partialPath":"confirmed.txt"},
            {"id":"completed","state":"completed","received":12,"path":"finished.txt"}
        ]});
        let live = json!([
            {"id":"still-live","state":"paused","canResume":true,"received":262144,"partialPath":"live.txt"},
            {"id":"new","state":"waiting","received":0}
        ]);
        let original = page.clone();
        merge_history(&mut page, &live, None, None).unwrap();
        assert_eq!(page["entries"][0], live[1]);
        for row in &page["entries"].as_array().unwrap()[1..4] {
            assert_eq!(row["state"], "interrupted");
            assert_eq!(row["canResume"], false);
            assert_eq!(row["error"], "Studio closed before this download finished");
            assert!(row["received"].is_null());
            assert!(row["path"].is_null());
            assert!(row["partialPath"].is_null());
        }
        assert_eq!(page["entries"][4], live[0]);
        assert_eq!(page["entries"][5], original["entries"][4]);
        assert_eq!(page["entries"][6], original["entries"][5]);
    }

    #[test]
    fn removal_requires_a_terminal_or_previous_session_download() {
        for state in ["waiting", "downloading", "paused", "unknown"] {
            assert!(ensure_removable(&json!([{"id":"one","state":state}]), "one").is_err());
        }
        for state in ["completed", "cancelled", "failed", "interrupted"] {
            assert!(ensure_removable(&json!([{"id":"one","state":state}]), "one").is_ok());
        }
        assert!(ensure_removable(&json!([]), "previous-session").is_ok());
        assert!(ensure_removable(&Value::Null, "one").is_err());
    }
}
