//! Local reading mode returns bounded text blocks. The trusted shell renders text only.
use super::capture::Capture;
use serde::{Deserialize, Serialize};
use tauri::WebviewWindow;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Article {
    pub title: String,
    pub url: String,
    pub blocks: Vec<Block>,
    pub truncated: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Block {
    kind: BlockKind,
    text: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum BlockKind {
    H1,
    H2,
    H3,
    H4,
    H5,
    H6,
    Paragraph,
    Bullet,
    Ordered,
    Quote,
    Code,
}

#[cfg(windows)]
fn decode(raw: &str, url: &str) -> Result<Article, String> {
    if raw.len() > 440_000 {
        return Err("Browser capture exceeded its size limit".into());
    }
    let article: Article = serde_json::from_str(raw).map_err(|_| "Invalid browser content response")?;
    if article.url != url
        || article.title.chars().count() > 512
        || article.blocks.len() > 400
        || article.blocks.iter().map(|block| block.text.chars().count()).sum::<usize>() > 64_000
    {
        return Err("Browser page changed or exceeded capture limits".into());
    }
    Ok(article)
}

#[tauri::command]
pub(crate) async fn browser_read_article(
    window: WebviewWindow,
    tab: String,
    expected_url: String,
) -> Result<Capture<Article>, String> {
    crate::require_workspace_window(&window)?;
    #[cfg(windows)]
    {
        if !(expected_url.starts_with("https://") || expected_url.starts_with("http://")) {
            return Err("This browser action is not available yet".into());
        }
        super::capture::run(window, tab, expected_url, include_str!("reader.js"), decode).await
    }
    #[cfg(not(windows))]
    {
        let _ = (tab, expected_url);
        Err("Integrated browser is currently available on Windows".into())
    }
}
