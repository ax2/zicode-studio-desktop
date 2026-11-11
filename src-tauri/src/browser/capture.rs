//! Explicit trusted-chrome read. Text remains untrusted; no model call or eval API.
use serde::{Deserialize, Serialize};
#[cfg(windows)]
use tauri::Manager;
use tauri::WebviewWindow;
#[cfg(windows)]
pub(super) const SCRIPT: &str = include_str!("capture.js");
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageText {
    pub title: String,
    pub url: String,
    pub text: String,
    pub selection: String,
    pub truncated: bool,
    pub links: Vec<PageLink>,
    pub links_truncated: bool,
    pub tables: Vec<PageTable>,
    pub tables_truncated: bool,
    pub metadata: PageMetadata,
    pub images: Vec<PageImage>,
    pub images_truncated: bool,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageMetadata {
    pub language: String,
    pub description: String,
    pub canonical_url: Option<String>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PageImage {
    pub alt: String,
    pub width: u32,
    pub height: u32,
    pub url: Option<String>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageTable {
    pub caption: String,
    pub first_row_header: bool,
    pub rows: Vec<Vec<String>>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PageLink {
    pub label: String,
    pub url: String,
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
fn is_web_url(value: &str) -> bool {
    value.len() <= 1024
        && reqwest::Url::parse(value).is_ok_and(|url| {
            matches!(url.scheme(), "http" | "https")
                && url.host().is_some()
                && url.username().is_empty()
                && url.password().is_none()
        })
}
#[cfg(windows)]
pub(super) fn decode(raw: &str, native_url: &str) -> Result<PageText, String> {
    if raw.len() > 480_000 {
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
    if page.links.len() > 20
        || page.links.iter().any(|link| {
            link.label.chars().count() > 120
                || !is_web_url(&link.url)
        })
    {
        return Err("Invalid browser links response".into());
    }
    let mut table_chars = 0;
    if page.tables.len() > 4
        || page.tables.iter().any(|table| {
            let columns = table.rows.first().map_or(0, Vec::len);
            let caption = table.caption.chars().count();
            table_chars += caption;
            !(1..=8).contains(&columns)
                || table.rows.len() > 16
                || caption > 120
                || table.rows.iter().any(|row| {
                    row.len() != columns
                        || row.iter().any(|cell| {
                            let chars = cell.chars().count();
                            table_chars += chars;
                            chars > 120
                        })
                })
        })
        || table_chars > 3600
    {
        return Err("Invalid browser tables response".into());
    }
    if page.metadata.language.chars().count() > 64
        || page.metadata.description.chars().count() > 400
        || page.metadata.canonical_url.as_deref().is_some_and(|url| !is_web_url(url))
        || page.images.len() > 12
        || page.images.iter().any(|image| {
            image.alt.chars().count() > 160
                || !(1..=100_000).contains(&image.width)
                || !(1..=100_000).contains(&image.height)
                || image.url.as_deref().is_some_and(|url| !is_web_url(url))
        })
    {
        return Err("Invalid browser image or page metadata response".into());
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
        let page = serde_json::json!({"title":"Page","url":"https://example.com/","text":"Body","selection":"Body","truncated":false,"links":[],"linksTruncated":false,"tables":[],"tablesTruncated":false,"metadata":{"language":"","description":"","canonicalUrl":null},"images":[],"imagesTruncated":false});
        assert!(decode(&page.to_string(), "https://example.com/").is_ok());
        assert!(decode(&page.to_string(), "https://example.org/").is_err());
        let mut bad = page.clone();
        bad["text"] = serde_json::Value::String("a".repeat(48001));
        assert!(decode(&bad.to_string(), "https://example.com/").is_err());
        let mut bad = page.clone();
        bad["links"] = serde_json::json!([{"label":"Source","url":"https://example.com/reference"}]);
        assert!(decode(&bad.to_string(), "https://example.com/").is_ok());
        for unsafe_url in ["javascript:alert(1)", "https://user:secret@example.com/"] {
            bad["links"][0]["url"] = serde_json::json!(unsafe_url);
            assert!(decode(&bad.to_string(), "https://example.com/").is_err());
        }
        bad["links"] = serde_json::json!(vec![serde_json::json!({"label":"","url":"https://example.com/"}); 21]);
        assert!(decode(&bad.to_string(), "https://example.com/").is_err());
        let mut bad = page.clone();
        bad["tables"] = serde_json::json!([{"caption":"Inventory","firstRowHeader":true,"rows":[["Item","Count"],["Pens","3"]]}]);
        assert!(decode(&bad.to_string(), "https://example.com/").is_ok());
        bad["tables"][0]["rows"][1] = serde_json::json!(["Pens"]);
        assert!(decode(&bad.to_string(), "https://example.com/").is_err());
        let mut bad = page.clone();
        bad["images"] = serde_json::json!([{"alt":"diagram","width":20,"height":10,"url":null}]);
        assert!(decode(&bad.to_string(), "https://example.com/").is_ok());
        bad["images"][0]["url"] = serde_json::json!("data:image/png;base64,a");
        assert!(decode(&bad.to_string(), "https://example.com/").is_err());
        bad["metadata"]["canonicalUrl"] = serde_json::json!("https://user:secret@example.com/");
        assert!(decode(&bad.to_string(), "https://example.com/").is_err());
        let mut bad = page;
        bad["tool"] = serde_json::json!("native.execute");
        assert!(decode(&bad.to_string(), "https://example.com/").is_err());
    }
}
