//! Netscape bookmark HTML interchange. Parsing never executes or fetches content.
use crate::browser_store::bookmarks::{Bookmark, Folder, Library};
use ego_tree::iter::Edge;
use scraper::{ElementRef, Html, Selector};
use serde::Serialize;
pub const MAX_FILE_BYTES: usize = 32 * 1024 * 1024;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub folders: Vec<Folder>,
    pub bookmarks: Vec<Bookmark>,
    pub skipped: usize,
}
#[derive(Default)]
struct Level { parent: Option<String>, pending: Option<String> }
pub fn parse(input: &str) -> Result<Imported, String> {
    if input.len() > MAX_FILE_BYTES { return Err("Bookmark file is too large".into()); }
    let document = Html::parse_document(input.trim_start_matches('\u{feff}'));
    let selector = Selector::parse("dl").map_err(|_| "Bookmark parser unavailable")?;
    let root = document.select(&selector).next().ok_or("Choose a bookmarks HTML file")?;
    let mut result = Imported { folders: vec![], bookmarks: vec![], skipped: 0 };
    let mut stack: Vec<Level> = vec![];
    let mut nodes = 0;
    for edge in root.traverse() {
        let node = match edge { Edge::Open(node) => node, Edge::Close(node) => {
            if node.value().as_element().is_some_and(|e| e.name() == "dl") { stack.pop(); }
            continue;
        }};
        nodes += 1;
        if nodes > 200_000 { return Err("Bookmark file has too many entries".into()); }
        let Some(element) = ElementRef::wrap(node) else { continue; };
        let name = element.value().name();
        if name == "dl" {
            if stack.len() >= 64 { return Err("Bookmark folders are nested too deeply".into()); }
            let parent = stack.last_mut().and_then(|level| level.pending.take().or_else(|| level.parent.clone()));
            stack.push(Level { parent, pending: None }); continue;
        }
        let Some(level) = stack.last_mut() else { continue; };
        if name == "h3" {
            let title = element.text().collect::<String>();
            if title.trim().is_empty() || title.len() > 256 { return Err("Invalid bookmark folder name".into()); }
            if result.folders.len() >= 999 { return Err("Too many bookmark folders".into()); }
            let id = uuid::Uuid::new_v4().to_string();
            result.folders.push(Folder { id: id.clone(), title, parent_id: level.parent.clone() });
            level.pending = Some(id);
        } else if name == "a" {
            level.pending = None;
            let value = element.value().attr("href").unwrap_or("").trim();
            let parsed = reqwest::Url::parse(value);
            let valid = parsed.as_ref().is_ok_and(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some() && url.username().is_empty() && url.password().is_none());
            if !valid || value.len() > 16384 { result.skipped += 1; continue; }
            let title = element.text().collect::<String>();
            let title = if title.trim().is_empty() { value.into() } else { title };
            if title.len() > 4096 { return Err("Bookmark title is too long".into()); }
            result.bookmarks.push(Bookmark { id: uuid::Uuid::new_v4().to_string(), title, url: value.into(), folder_id: level.parent.clone() });
        }
    }
    if result.folders.is_empty() && result.bookmarks.is_empty() && result.skipped == 0 { return Err("No bookmarks found in this file".into()); }
    if serde_json::to_vec(&result).map_err(|e| e.to_string())?.len() > 4 * 1024 * 1024 { return Err("Bookmarks exceed storage limit".into()); }
    Ok(result)
}
fn escape(value: &str) -> String { value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;") }
pub fn export(library: &Library) -> String {
    enum Item<'a> { Level(Option<&'a str>), Folder(&'a Folder), Bookmark(&'a Bookmark), Close }
    let mut output = "<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n".to_owned();
    let mut work = vec![Item::Close, Item::Level(None)];
    while let Some(item) = work.pop() {
        match item {
            Item::Level(parent) => {
                for bookmark in library.bookmarks.iter().rev().filter(|b| b.folder_id.as_deref() == parent) { work.push(Item::Bookmark(bookmark)); }
                for folder in library.folders.iter().rev().filter(|f| f.parent_id.as_deref() == parent) { work.push(Item::Folder(folder)); }
            }
            Item::Folder(folder) => { output.push_str(&format!("<DT><H3>{}</H3>\n<DL><p>\n", escape(&folder.title))); work.push(Item::Close); work.push(Item::Level(Some(&folder.id))); }
            Item::Bookmark(bookmark) => output.push_str(&format!("<DT><A HREF=\"{}\">{}</A>\n", escape(&bookmark.url), escape(&bookmark.title))),
            Item::Close => output.push_str("</DL><p>\n"),
        }
    }
    output
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chrome_style_nested_and_empty_folders_round_trip_with_unicode_and_entities() {
        let input = r#"<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3 PERSONAL_TOOLBAR_FOLDER="true">收藏 &amp; 文档</H3><DL><p><DT><A HREF="https://example.org/?a=1&amp;b=2" ICON="ignored">标题 &lt;img&gt;</A><DT><H3>空文件夹</H3><DL><p></DL><p><DT><H3>子目录</H3><DL><p><DT><A HREF="https://example.com/">Nested</A></DL><p></DL><p><DT><A HREF="https://example.net/">Root</A></DL><p>"#;
        let parsed = parse(input).unwrap();
        assert_eq!(parsed.folders.len(), 3); assert_eq!(parsed.bookmarks.len(), 3);
        assert_eq!(parsed.folders[1].parent_id, Some(parsed.folders[0].id.clone()));
        assert_eq!(parsed.bookmarks[1].folder_id, Some(parsed.folders[2].id.clone()));
        assert_eq!(parsed.bookmarks[2].folder_id, None);
        let html = export(&Library { revision: 0, folders: parsed.folders, bookmarks: parsed.bookmarks });
        assert!(html.contains("&lt;img&gt;")); assert!(!html.contains("ICON="));
        let again = parse(&html).unwrap(); assert_eq!(again.folders.len(), 3);
        assert_eq!(again.bookmarks.iter().map(|b|b.title.as_str()).collect::<Vec<_>>(), vec!["Nested", "标题 <img>", "Root"]);
        assert_eq!(again.bookmarks[1].url, "https://example.org/?a=1&b=2");
    }
    #[test]
    fn unsupported_links_are_counted_without_execution_or_fetching() {
        let parsed = parse(r#"<DL><DT><A HREF="javascript:alert(1)">bad</A><DT><A HREF="file:///C:/secret">bad</A><DT><A HREF="https://user:secret@example.org/">bad</A><DT><A HREF="https://example.org/">ok</A></DL>"#).unwrap();
        assert_eq!(parsed.skipped, 3); assert_eq!(parsed.bookmarks.len(), 1);
        assert!(parse("<html><p>Not bookmarks</p></html>").is_err());
        assert!(parse(&format!("<DL><DT><H3>{}</H3></DL>", "中".repeat(86))).is_err());
    }
}
