//! Owner-bound selection read for explicit local browser actions.
use super::capture::Capture;
use serde::{Deserialize, Serialize};
use tauri::WebviewWindow;

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SelectedText {
    url: String,
    text: String,
    truncated: bool,
}

#[cfg(windows)]
fn decode(raw: &str, url: &str) -> Result<SelectedText, String> {
    if raw.len() > 96_000 {
        return Err("Browser capture exceeded its size limit".into());
    }
    let selection: SelectedText = serde_json::from_str(raw).map_err(|_| "Invalid browser content response")?;
    if selection.url != url || selection.text.encode_utf16().count() > 8192
        || (selection.truncated && !selection.text.is_empty())
    {
        return Err("Browser page changed or exceeded capture limits".into());
    }
    Ok(selection)
}

#[tauri::command]
pub(crate) async fn browser_read_selection(
    window: WebviewWindow,
    tab: String,
    expected_url: String,
) -> Result<Capture<SelectedText>, String> {
    crate::require_workspace_window(&window)?;
    #[cfg(windows)]
    {
        if !(expected_url.starts_with("https://") || expected_url.starts_with("http://")) {
            return Err("This browser action is not available yet".into());
        }
        super::capture::run(window, tab, expected_url, include_str!("selection.js"), decode).await
    }
    #[cfg(not(windows))]
    {
        let _ = (tab, expected_url);
        Err("Integrated browser is currently available on Windows".into())
    }
}
