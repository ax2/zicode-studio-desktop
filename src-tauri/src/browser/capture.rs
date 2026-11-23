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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_truncated: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection_truncated: Option<bool>,
    pub links: Vec<PageLink>,
    pub links_truncated: bool,
    pub tables: Vec<PageTable>,
    pub tables_truncated: bool,
    pub metadata: PageMetadata,
    pub images: Vec<PageImage>,
    pub images_truncated: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub frames: Vec<PageFrame>,
    #[serde(default)]
    pub frames_omitted: bool,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageFrame {
    pub title: String,
    pub url: Option<String>,
    pub text: String,
    pub text_truncated: bool,
    pub selection: String,
    pub selection_truncated: bool,
    pub tables: Vec<PageTable>,
    pub tables_truncated: bool,
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
pub struct Capture<T> {
    pub tab: String,
    pub document_revision: String,
    pub captured_at: String,
    pub source_trust: &'static str,
    pub page: T,
}
#[cfg(windows)]
fn checked_web_url(value: &str) -> Option<reqwest::Url> {
    if value.len() > 1024 {
        return None;
    }
    let url = reqwest::Url::parse(value).ok()?;
    (matches!(url.scheme(), "http" | "https")
        && url.host().is_some()
        && url.username().is_empty()
        && url.password().is_none())
    .then_some(url)
}
#[cfg(windows)]
pub(super) fn is_web_url(value: &str) -> bool {
    checked_web_url(value).is_some()
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
        || page
            .links
            .iter()
            .any(|link| link.label.chars().count() > 120 || !is_web_url(&link.url))
    {
        return Err("Invalid browser links response".into());
    }
    let mut body_chars = page.text.chars().count();
    let mut selection_chars = page.selection.chars().count();
    let origin = reqwest::Url::parse(native_url).ok().map(|url| url.origin());
    if page.frames.len() > 6
        || page.frames.iter().any(|frame| {
            let frame_chars = frame.text.chars().count();
            body_chars += frame_chars;
            selection_chars += frame.selection.chars().count();
            frame.title.chars().count() > 512
                || frame_chars > 8000
                || frame.url.as_deref().is_some_and(|value| {
                    checked_web_url(value).is_none_or(|url| origin.as_ref() != Some(&url.origin()))
                })
        })
        || body_chars > 48000
        || selection_chars > 8192
    {
        return Err("Invalid browser frames response".into());
    }
    let mut tables = page
        .tables
        .iter()
        .chain(page.frames.iter().flat_map(|frame| &frame.tables));
    let mut table_chars = 0;
    if tables.clone().count() > 4
        || tables.any(|table| {
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
        || page
            .metadata
            .canonical_url
            .as_deref()
            .is_some_and(|url| !is_web_url(url))
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
) -> Result<Capture<PageText>, String> {
    crate::require_workspace_window(&window)?;
    #[cfg(windows)]
    {
        run(window, tab, expected_url, None, SCRIPT, decode).await
    }
    #[cfg(not(windows))]
    {
        let _ = (tab, expected_url);
        Err("Integrated browser is currently available on Windows".into())
    }
}
#[cfg(windows)]
pub(super) async fn run<T: Send + 'static>(
    window: WebviewWindow,
    tab: String,
    expected_url: String,
    expected_revision: Option<String>,
    script: impl Into<std::borrow::Cow<'static, str>>,
    decode: fn(&str, &str) -> Result<T, String>,
) -> Result<Capture<T>, String> {
    let script = script.into();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let app = window.app_handle().clone();
    app.run_on_main_thread(move || {
        // Initial and completion checks are both bound to the actual window.
        super::runtime::capture(
            &window,
            tab,
            expected_url,
            expected_revision,
            &script,
            decode,
            tx,
        );
    })
    .map_err(|error| error.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(10), rx)
        .await
        .map_err(|_| "Browser capture timed out")?
        .map_err(|_| "Browser capture stopped")?
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
        bad["links"] =
            serde_json::json!([{"label":"Source","url":"https://example.com/reference"}]);
        assert!(decode(&bad.to_string(), "https://example.com/").is_ok());
        for unsafe_url in ["javascript:alert(1)", "https://user:secret@example.com/"] {
            bad["links"][0]["url"] = serde_json::json!(unsafe_url);
            assert!(decode(&bad.to_string(), "https://example.com/").is_err());
        }
        bad["links"] = serde_json::json!(vec![
            serde_json::json!({"label":"","url":"https://example.com/"});
            21
        ]);
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
    #[test]
    fn bounds_embedded_content_and_checks_its_source_against_the_native_origin() {
        let url = "https://example.com/";
        let table = serde_json::json!({"caption":"Inventory","firstRowHeader":true,"rows":[["Item"],["Pens"]]});
        let mut page = serde_json::json!({
            "title":"Page","url":url,"text":"Body","selection":"Part","truncated":false,
            "links":[],"linksTruncated":false,"tables":[table.clone()],"tablesTruncated":false,
            "metadata":{"language":"","description":"","canonicalUrl":null},
            "images":[],"imagesTruncated":false,
            "frames":[{
                "title":"Embedded","url":"https://example.com/inner","text":"Frame body","textTruncated":false,
                "selection":"Frame selection","selectionTruncated":false,"tables":[table.clone()],"tablesTruncated":false
            }],
            "framesOmitted":true
        });
        let valid = |value: &serde_json::Value| decode(&value.to_string(), url).is_ok();
        assert!(valid(&page));
        for rejected in [
            "https://example.org/inner",
            "http://example.com/inner",
            "https://example.com:444/",
            "https://user:password@example.com/",
            "about:srcdoc",
        ] {
            page["frames"][0]["url"] = serde_json::json!(rejected);
            assert!(!valid(&page), "{rejected}");
        }
        page["frames"][0]["url"] = serde_json::Value::Null;
        assert!(valid(&page));

        let mut oversized = page.clone();
        oversized["text"] = serde_json::json!("a".repeat(48000));
        assert!(!valid(&oversized));
        let mut oversized = page.clone();
        oversized["selection"] = serde_json::json!("a".repeat(8192));
        assert!(!valid(&oversized));
        let mut oversized = page.clone();
        oversized["frames"][0]["text"] = serde_json::json!("a".repeat(8001));
        assert!(!valid(&oversized));
        let mut oversized = page.clone();
        oversized["frames"][0]["tables"] =
            serde_json::json!([table.clone(), table.clone(), table.clone(), table]);
        assert!(!valid(&oversized));
        let repeated = page["frames"][0].clone();
        page["frames"] = serde_json::json!(vec![repeated; 7]);
        assert!(!valid(&page));
    }
}
