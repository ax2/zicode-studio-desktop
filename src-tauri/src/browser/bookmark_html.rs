//! Netscape bookmark HTML interchange. Parsing never executes or fetches content.
use crate::browser_store::bookmarks::{self, Bookmark, Folder, Library};
use ego_tree::iter::Edge;
use scraper::{ElementRef, Html, Selector};
use serde::Serialize;
use std::collections::HashMap;
pub const MAX_FILE_BYTES: usize = 32 * 1024 * 1024;
const MAX_LINKS: usize = 50_000;
const DOCTYPE: &str = "<!DOCTYPE NETSCAPE-Bookmark-file-1>";
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub folders: Vec<Folder>,
    pub bookmarks: Vec<Bookmark>,
    pub skipped: usize,
}
#[derive(Default)]
struct Level {
    parent: Option<String>,
    pending: Option<String>,
    position: u32,
}
impl Level {
    fn next_position(&mut self) -> u32 {
        let position = self.position;
        self.position += 1;
        position
    }
}
pub fn parse(input: &str) -> Result<Imported, String> {
    if input.len() > MAX_FILE_BYTES {
        return Err("Bookmark file is too large".into());
    }
    let input = input.trim_start_matches('\u{feff}');
    let document = Html::parse_document(input);
    let selector = Selector::parse("dl").map_err(|_| "Bookmark parser unavailable")?;
    let root = document
        .select(&selector)
        .next()
        .ok_or("Choose a bookmarks HTML file")?;
    let mut result = Imported {
        folders: vec![],
        bookmarks: vec![],
        skipped: 0,
    };
    let mut stack: Vec<Level> = vec![];
    let mut nodes = 0;
    for edge in root.traverse() {
        let node = match edge {
            Edge::Open(node) => node,
            Edge::Close(node) => {
                if node.value().as_element().is_some_and(|e| e.name() == "dl") {
                    stack.pop();
                }
                continue;
            }
        };
        nodes += 1;
        if nodes > 200_000 {
            return Err("Bookmark file has too many entries".into());
        }
        let Some(element) = ElementRef::wrap(node) else {
            continue;
        };
        let name = element.value().name();
        if name == "dl" {
            if stack.len() >= 64 {
                return Err("Bookmark folders are nested too deeply".into());
            }
            let parent = stack
                .last_mut()
                .and_then(|level| level.pending.take().or_else(|| level.parent.clone()));
            stack.push(Level {
                parent,
                ..Level::default()
            });
            continue;
        }
        let Some(level) = stack.last_mut() else {
            continue;
        };
        if name == "h3" {
            let title = element.text().collect::<String>();
            if title.trim().is_empty() || title.len() > 256 {
                return Err("Invalid bookmark folder name".into());
            }
            if result.folders.len() >= bookmarks::MAX_FOLDERS - 1 {
                return Err("Too many bookmark folders".into());
            }
            let id = uuid::Uuid::new_v4().to_string();
            result.folders.push(Folder {
                id: id.clone(),
                title,
                parent_id: level.parent.clone(),
                position: Some(level.next_position()),
            });
            level.pending = Some(id);
        } else if name == "a" {
            level.pending = None;
            let value = element.value().attr("href").unwrap_or("").trim();
            if result.bookmarks.len() + result.skipped >= MAX_LINKS {
                return Err("Bookmark file has too many links".into());
            }
            if bookmarks::validate_url(value).is_err() {
                result.skipped += 1;
                continue;
            }
            let title = element.text().collect::<String>();
            let title = if title.trim().is_empty() {
                value.into()
            } else {
                title
            };
            if title.len() > 4096 {
                return Err("Bookmark title is too long".into());
            }
            result.bookmarks.push(Bookmark {
                id: uuid::Uuid::new_v4().to_string(),
                title,
                url: value.into(),
                folder_id: level.parent.clone(),
                position: Some(level.next_position()),
                shortcut: false,
            });
        }
    }
    if result.folders.is_empty()
        && result.bookmarks.is_empty()
        && result.skipped == 0
        && !input
            .trim_start()
            .get(..DOCTYPE.len())
            .is_some_and(|header| header.eq_ignore_ascii_case(DOCTYPE))
    {
        return Err("No bookmarks found in this file".into());
    }
    if serde_json::to_vec(&result)
        .map_err(|e| e.to_string())?
        .len()
        > bookmarks::MAX_PAYLOAD_BYTES
    {
        return Err("Bookmarks exceed storage limit".into());
    }
    Ok(result)
}
fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
pub fn export(library: &Library) -> String {
    enum Entry<'a> {
        Folder(&'a Folder),
        Bookmark(&'a Bookmark),
        Close,
    }
    let mut children: HashMap<Option<&str>, Vec<Entry<'_>>> = HashMap::new();
    for folder in &library.folders {
        children
            .entry(folder.parent_id.as_deref())
            .or_default()
            .push(Entry::Folder(folder));
    }
    for bookmark in &library.bookmarks {
        children
            .entry(bookmark.folder_id.as_deref())
            .or_default()
            .push(Entry::Bookmark(bookmark));
    }
    for entries in children.values_mut() {
        // Old JSON stores directories and links separately and has no mixed position.
        entries.sort_by_key(|entry| match entry {
            Entry::Folder(folder) => folder.position,
            Entry::Bookmark(bookmark) => bookmark.position,
            Entry::Close => None,
        });
    }
    let mut output = format!("{DOCTYPE}\n<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n");
    let mut work = vec![Entry::Close];
    if let Some(entries) = children.remove(&None) {
        work.extend(entries.into_iter().rev());
    }
    while let Some(entry) = work.pop() {
        match entry {
            Entry::Folder(folder) => {
                output.push_str(&format!(
                    "<DT><H3>{}</H3>\n<DL><p>\n",
                    escape(&folder.title)
                ));
                work.push(Entry::Close);
                if let Some(entries) = children.remove(&Some(folder.id.as_str())) {
                    work.extend(entries.into_iter().rev());
                }
            }
            Entry::Bookmark(bookmark) => output.push_str(&format!(
                "<DT><A HREF=\"{}\">{}</A>\n",
                escape(&bookmark.url),
                escape(&bookmark.title),
            )),
            Entry::Close => output.push_str("</DL><p>\n"),
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
        assert_eq!(parsed.folders.len(), 3);
        assert_eq!(parsed.bookmarks.len(), 3);
        assert_eq!(
            parsed.folders[1].parent_id,
            Some(parsed.folders[0].id.clone())
        );
        assert_eq!(
            parsed.bookmarks[1].folder_id,
            Some(parsed.folders[2].id.clone())
        );
        assert_eq!(parsed.bookmarks[2].folder_id, None);
        let html = export(&Library {
            revision: 0,
            folders: parsed.folders,
            bookmarks: parsed.bookmarks,
        });
        assert!(html.contains("&lt;img&gt;"));
        assert!(!html.contains("ICON="));
        let again = parse(&html).unwrap();
        assert_eq!(again.folders.len(), 3);
        assert_eq!(
            again
                .bookmarks
                .iter()
                .map(|b| b.title.as_str())
                .collect::<Vec<_>>(),
            vec!["标题 <img>", "Nested", "Root"]
        );
        assert_eq!(again.bookmarks[0].url, "https://example.org/?a=1&b=2");
    }
    #[test]
    fn unsupported_links_are_counted_without_execution_or_fetching() {
        let parsed = parse(r#"<DL><DT><A HREF="javascript:alert(1)">bad</A><DT><A HREF="file:///C:/secret">bad</A><DT><A HREF="https://user:secret@example.org/">bad</A><DT><A HREF="https://example.org/">ok</A></DL>"#).unwrap();
        assert_eq!(parsed.skipped, 3);
        assert_eq!(parsed.bookmarks.len(), 1);
        assert!(parse("<html><p>Not bookmarks</p></html>").is_err());
        assert!(parse(&format!("<DL><DT><H3>{}</H3></DL>", "中".repeat(86))).is_err());
    }

    #[test]
    fn stored_round_trip_keeps_old_rows_and_mixed_siblings_in_each_owner() {
        use crate::browser_store::{bookmarks::Request, Store};

        let first_file = format!(
            "{DOCTYPE}<DL><p><DT><A HREF=\"https://reference.test/\">首先</A>\
             <DT><H3>空文件夹</H3><DL><p></DL><p>\
             <DT><A HREF=\"https://REFERENCE.test\">重复</A>\
             <DT><A HREF=\"mailto:skip@example.test\">跳过</A></DL>"
        );
        let directory =
            std::env::temp_dir().join(format!("bookmark-html-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let source = directory.join("原件.html");
        let destination = directory.join("导出.html");
        std::fs::write(&source, &first_file).unwrap();

        let mut store = Store::open(&directory).unwrap();
        let previous = parse("<DL><DT><A HREF=\"https://legacy.test/\">原书签</A></DL>").unwrap();
        let mut old_link = previous.bookmarks.into_iter().next().unwrap();
        old_link.position = None;
        let old_library = store
            .bookmarks(
                "a",
                Request::Save {
                    expected_revision: 0,
                    folders: vec![],
                    bookmarks: vec![old_link.clone()],
                },
            )
            .unwrap();
        assert!(!serde_json::to_string(&old_library)
            .unwrap()
            .contains("\"position\""));

        let mut parsed = parse(&std::fs::read_to_string(&source).unwrap()).unwrap();
        assert_eq!(parsed.skipped, 1);
        assert_eq!(parsed.bookmarks.len(), 2);
        let folder = parsed.folders[0].id.clone();
        let mut new_link = parse("<DL><DT><A HREF=\"https://new.test/\">新增书签</A></DL>")
            .unwrap()
            .bookmarks
            .remove(0);
        new_link.position = Some(3);
        parsed.bookmarks.insert(0, old_link);
        parsed.bookmarks.push(new_link);
        let saved = store
            .bookmarks(
                "a",
                Request::Save {
                    expected_revision: old_library.revision,
                    folders: parsed.folders,
                    bookmarks: parsed.bookmarks,
                },
            )
            .unwrap();
        drop(store);

        let mut store = Store::open(&directory).unwrap();
        assert_eq!(store.bookmarks("a", Request::List).unwrap(), saved);
        assert_eq!(
            store.bookmarks("b", Request::List).unwrap(),
            Library::default()
        );
        let first_export = export(&saved);
        for [earlier, later] in [
            ["原书签", "首先"],
            ["首先", "空文件夹"],
            ["空文件夹", "重复"],
            ["重复", "新增书签"],
        ] {
            assert!(first_export.find(earlier).unwrap() < first_export.find(later).unwrap());
        }
        std::fs::write(&destination, &first_export).unwrap();
        let mut second = parse(&std::fs::read_to_string(&destination).unwrap()).unwrap();
        assert_eq!(second.bookmarks.len(), 4);
        assert_eq!(second.folders[0].title, "空文件夹");
        assert_eq!(second.folders[0].parent_id, None);
        let mut target = parse("<DL><DT><H3>归档</H3></DL>")
            .unwrap()
            .folders
            .remove(0);
        target.position = Some(5);
        let moved = &mut second.folders[0];
        moved.parent_id = Some(target.id.clone());
        moved.position = Some(0);
        second.folders.push(target);
        let imported = store
            .bookmarks(
                "b",
                Request::Save {
                    expected_revision: 0,
                    folders: second.folders,
                    bookmarks: second.bookmarks,
                },
            )
            .unwrap();
        assert_ne!(imported.folders[0].id, folder);
        let next_export = export(&imported);
        assert!(next_export.find("归档").unwrap() < next_export.find("空文件夹").unwrap());

        let bad_file = directory.join("损坏.html");
        std::fs::write(&bad_file, "<html><p>Not bookmarks</p></html>").unwrap();
        assert!(parse(&std::fs::read_to_string(&bad_file).unwrap()).is_err());
        assert!(store
            .bookmarks(
                "a",
                Request::Save {
                    expected_revision: 1,
                    folders: vec![],
                    bookmarks: vec![],
                }
            )
            .is_err());
        assert_eq!(store.bookmarks("a", Request::List).unwrap(), saved);
        assert_eq!(store.bookmarks("b", Request::List).unwrap(), imported);
        assert_eq!(std::fs::read(&source).unwrap(), first_file.as_bytes());
        drop(store);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn empty_exports_and_per_file_bounds() {
        let empty = parse(&export(&Library::default())).unwrap();
        assert!(empty.folders.is_empty() && empty.bookmarks.is_empty());
        assert!(parse("<DL></DL>").is_err());
        assert_eq!(
            parse(&" ".repeat(MAX_FILE_BYTES + 1)).err().unwrap(),
            "Bookmark file is too large"
        );
        let folders = format!(
            "<DL>{}</DL>",
            "<DT><H3>Empty</H3><DL></DL>".repeat(bookmarks::MAX_FOLDERS)
        );
        assert_eq!(parse(&folders).err().unwrap(), "Too many bookmark folders");
        let links = format!(
            "<DL>{}</DL>",
            "<DT><A HREF=\"mailto:x@example.test\">X</A>".repeat(MAX_LINKS + 1)
        );
        assert_eq!(
            parse(&links).err().unwrap(),
            "Bookmark file has too many links"
        );
    }
}
