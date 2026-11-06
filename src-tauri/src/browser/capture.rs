//! Explicit trusted-chrome read. Text remains untrusted; no model call or eval API.
use serde::{Deserialize, Serialize};
#[cfg(windows)]
use tauri::Manager;
use tauri::WebviewWindow;
#[cfg(windows)]
pub(super) const SCRIPT: &str = include_str!("capture.js");
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PageText {
    pub title: String,
    pub url: String,
    pub text: String,
    pub selection: String,
    pub truncated: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    pub tab: String,
    pub document_revision: String,
    pub captured_at: String,
    pub source_trust: &'static str,
    pub page: PageText,
}
#[cfg(windows)]
pub(super) fn decode(raw: &str, native_url: &str) -> Result<PageText, String> {
    if raw.len() > 400_000 {
        return Err("Browser capture exceeded its size limit".into());
    }
    let page: PageText =
        serde_json::from_str(raw).map_err(|_| "Invalid browser content response")?;
    if page.url != native_url
        || page.title.chars().count() > 512
        || page.text.chars().count() > 48000
        || page.selection.chars().count() > 8192
    {
        return Err("Browser page changed or exceeded capture limits".into());
    }
    Ok(page)
}
#[tauri::command]
pub(crate) async fn browser_capture_page(
    window: WebviewWindow,
    tab: String,
    expected_url: String,
) -> Result<Capture, String> {
    crate::require_workspace_window(&window)?;
    #[cfg(windows)]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let app = window.app_handle().clone();
        app.run_on_main_thread(move || {
            // Initial and completion checks are both bound to the actual window.
            super::runtime::capture(&window, tab, expected_url, tx);
        })
        .map_err(|e| e.to_string())?;
        tokio::time::timeout(std::time::Duration::from_secs(10), rx)
            .await
            .map_err(|_| "Browser capture timed out")?
            .map_err(|_| "Browser capture stopped")?
    }
    #[cfg(not(windows))]
    {
        let _ = (tab, expected_url);
        Err("Integrated browser is currently available on Windows".into())
    }
}
#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn rejects_changed_source_unknown_fields_and_oversized_text() {
        let page = serde_json::json!({"title":"Page","url":"https://example.com/","text":"Body","selection":"Body","truncated":false});
        assert!(decode(&page.to_string(), "https://example.com/").is_ok());
        assert!(decode(&page.to_string(), "https://example.org/").is_err());
        let mut bad = page.clone();
        bad["text"] = serde_json::Value::String("a".repeat(48001));
        assert!(decode(&bad.to_string(), "https://example.com/").is_err());
        let mut bad = page;
        bad["tool"] = serde_json::json!("native.execute");
        assert!(decode(&bad.to_string(), "https://example.com/").is_err());
    }
}
