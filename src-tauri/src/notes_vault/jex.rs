use std::collections::BTreeMap;
use std::io::{self, Read};

const MAX_ARCHIVE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_MEMBERS: usize = 20_000;
const MAX_ITEM_BYTES: u64 = 2 * 1024 * 1024;
const MAX_RESOURCE_BYTES: u64 = 5 * 1024 * 1024;

// IDs in the original export identify notes, notebooks, tags, and resources.
// Archive paths are read as data. Nothing is extracted to the filesystem.
pub(super) struct JexArchive {
    pub items: BTreeMap<String, JexItem>,
    pub resources: BTreeMap<String, Vec<u8>>,
    pub skipped: Vec<String>,
}

pub(super) struct JexItem {
    pub kind: JexKind,
    pub title: String,
    pub body: String,
    pub properties: BTreeMap<String, String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum JexKind {
    Note,
    Notebook,
    Resource,
    Tag,
    NoteTag,
}

pub(super) fn read_jex(reader: impl Read) -> io::Result<JexArchive> {
    let mut archive = tar::Archive::new(reader.take(MAX_ARCHIVE_BYTES + 1));
    let mut result = JexArchive {
        items: BTreeMap::new(),
        resources: BTreeMap::new(),
        skipped: Vec::new(),
    };
    let mut total = 0u64;
    for (index, entry) in archive.entries()?.enumerate() {
        let mut entry = entry?;
        if index >= MAX_MEMBERS {
            return Err(invalid("Too many Joplin archive members"));
        }
        let raw = entry.path_bytes();
        let path = std::str::from_utf8(&raw)
            .map_err(|_| invalid("Joplin archive member name is not UTF-8"))?
            .trim_start_matches("./");
        let entry_type = entry.header().entry_type();
        if entry_type.is_dir() {
            if path.is_empty() || path.trim_end_matches('/') == "resources" {
                continue;
            }
            return Err(invalid("Unexpected Joplin archive directory"));
        }
        if !entry_type.is_file() {
            return Err(invalid("Joplin archive contains a special file"));
        }
        let path = path.to_owned();
        let (file, resource) = match path.strip_prefix("resources/") {
            Some(name) => (name, true),
            None => (path.as_str(), false),
        };
        if file.is_empty()
            || file == "."
            || file == ".."
            || file.contains(['/', '\\', ':'])
            || file.chars().any(char::is_control)
        {
            return Err(invalid("Joplin archive member path is invalid"));
        }
        let size = entry.size();
        total = total.saturating_add(size);
        if total > MAX_ARCHIVE_BYTES {
            return Err(invalid("Joplin archive exceeds the import limit"));
        }
        let limit = if resource {
            MAX_RESOURCE_BYTES
        } else {
            MAX_ITEM_BYTES
        };
        if size > limit {
            // Let the preview disclose the missing member. The decoder remains
            // bounded by the maximum archive size while the next entry is read.
            result.skipped.push(path);
            continue;
        }
        let mut bytes = Vec::with_capacity(size as usize);
        entry.read_to_end(&mut bytes)?;
        if bytes.len() as u64 != size {
            return Err(invalid("Joplin archive member is incomplete"));
        }
        if resource {
            if result.resources.insert(file.to_owned(), bytes).is_some() {
                return Err(invalid("Duplicate Joplin resource"));
            }
        } else if let Some(stem) = file.strip_suffix(".md").filter(|stem| valid_id(stem)) {
            let source = String::from_utf8(bytes)
                .map_err(|_| invalid("Joplin item content is not UTF-8"))?;
            if let Some(item) = parse_item(&source, stem)? {
                if result
                    .items
                    .insert(stem.to_ascii_lowercase(), item)
                    .is_some()
                {
                    return Err(invalid("Duplicate Joplin item"));
                }
            } else {
                result.skipped.push(path);
            }
        } else {
            result.skipped.push(path);
        }
    }
    Ok(result)
}

fn parse_item(source: &str, stem: &str) -> io::Result<Option<JexItem>> {
    let source = source.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let source = source.trim_end_matches('\n');
    // Joplin's RAW items append a contiguous property block after the last blank
    // line. A body line with a colon or a fake "type_" stays part of the body.
    let boundary = source
        .match_indices('\n')
        .rev()
        .find(|(index, _)| {
            source[..*index]
                .rsplit('\n')
                .next()
                .is_some_and(|line| line.trim().is_empty())
        })
        .map_or(0, |(index, _)| index + 1);
    let mut properties = BTreeMap::new();
    for line in source[boundary..].lines() {
        let (key, value) = line
            .split_once(':')
            .ok_or_else(|| invalid("Joplin item property is invalid"))?;
        let key = key.trim();
        if key.is_empty()
            || properties
                .insert(key.to_owned(), value.trim().to_owned())
                .is_some()
        {
            return Err(invalid("Joplin item property is invalid or duplicated"));
        }
    }
    if !properties
        .get("id")
        .is_some_and(|id| id.eq_ignore_ascii_case(stem))
    {
        return Err(invalid("Joplin item ID does not match its entry"));
    }
    let kind = match properties.get("type_").map(String::as_str) {
        Some("1") => JexKind::Note,
        Some("2") => JexKind::Notebook,
        Some("4") => JexKind::Resource,
        Some("5") => JexKind::Tag,
        Some("6") => JexKind::NoteTag,
        Some(_) => return Ok(None),
        None => return Err(invalid("Joplin item type is missing")),
    };
    if properties
        .get("encryption_applied")
        .is_some_and(|v| v == "1")
        || properties.get("is_locked").is_some_and(|v| v == "1")
    {
        return Ok(None);
    }
    // Drop exactly the blank separator line. The preceding newline can be
    // significant Markdown spacing.
    let display = source[..boundary]
        .strip_suffix("\n\n")
        .unwrap_or(&source[..boundary]);
    let (title, remainder) = display.split_once('\n').unwrap_or((display, ""));
    let body = remainder.strip_prefix('\n').unwrap_or(remainder);
    Ok(Some(JexItem {
        kind,
        title: title.to_owned(),
        body: if kind == JexKind::Note {
            body.to_owned()
        } else {
            String::new()
        },
        properties,
    }))
}

fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOTE: &str = "c1111111111111111111111111111111";
    const BOOK: &str = "c2222222222222222222222222222222";
    const IMAGE: &str = "c3333333333333333333333333333333";

    fn tar(entries: &[(&str, &[u8], tar::EntryType)]) -> Vec<u8> {
        let mut archive = tar::Builder::new(Vec::new());
        for (path, contents, kind) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(contents.len() as u64);
            header.set_mode(0o644);
            header.set_entry_type(*kind);
            header.set_cksum();
            archive.append_data(&mut header, path, *contents).unwrap();
        }
        archive.into_inner().unwrap()
    }

    #[test]
    fn reads_chinese_note_and_resource_without_extraction() {
        let note = format!(
            "中文标题\r\n\r\n第一段\r\n\r\ntype_: 保留在正文\r\n![图](:/{IMAGE})\r\n\r\nid: {NOTE}\r\nparent_id: {BOOK}\r\nupdated_time: 2026-11-23T05:06:00.000Z\r\ntype_: 1\r\n"
        );
        let book = format!("项目笔记\n\nid: {BOOK}\ntype_: 2");
        let bytes = tar(&[
            (
                &format!("{NOTE}.md"),
                note.as_bytes(),
                tar::EntryType::Regular,
            ),
            (
                &format!("{BOOK}.md"),
                book.as_bytes(),
                tar::EntryType::Regular,
            ),
            (
                &format!("resources/{IMAGE}.png"),
                b"fixture-image",
                tar::EntryType::Regular,
            ),
        ]);
        let jex = read_jex(bytes.as_slice()).unwrap();
        assert_eq!(jex.items[NOTE].kind, JexKind::Note);
        assert_eq!(jex.items[NOTE].title, "中文标题");
        assert!(jex.items[NOTE].body.contains("type_: 保留在正文"));
        assert!(jex.items[NOTE].body.contains(&format!("(:/{IMAGE})")));
        assert_eq!(jex.items[NOTE].properties["parent_id"], BOOK);
        assert_eq!(
            jex.items[NOTE].properties["updated_time"],
            "2026-11-23T05:06:00.000Z"
        );
        assert_eq!(jex.items[BOOK].kind, JexKind::Notebook);
        assert_eq!(jex.resources[&format!("{IMAGE}.png")], b"fixture-image");
        assert!(jex.skipped.is_empty());
    }

    #[test]
    fn rejects_special_paths_duplicate_entries_and_mismatched_id() {
        let file = format!("{NOTE}.md");
        let good = format!("标题\n\n正文\n\nid: {NOTE}\ntype_: 1");
        let wrong = format!("标题\n\n正文\n\nid: {BOOK}\ntype_: 1");
        for bytes in [
            tar(&[("resources/x", b"", tar::EntryType::Symlink)]),
            tar(&[("resources/sub/x", b"", tar::EntryType::Regular)]),
            tar(&[(&file, wrong.as_bytes(), tar::EntryType::Regular)]),
            tar(&[
                (&file, good.as_bytes(), tar::EntryType::Regular),
                (&file, good.as_bytes(), tar::EntryType::Regular),
            ]),
        ] {
            assert!(read_jex(bytes.as_slice()).is_err());
        }
    }

    #[test]
    fn reports_locked_and_unsupported_items() {
        let locked = format!("标题\n\n密文\n\nid: {NOTE}\nis_locked: 1\ntype_: 1");
        let unsupported = format!("id: {BOOK}\ntype_: 13");
        let bytes = tar(&[
            (
                &format!("{NOTE}.md"),
                locked.as_bytes(),
                tar::EntryType::Regular,
            ),
            (
                &format!("{BOOK}.md"),
                unsupported.as_bytes(),
                tar::EntryType::Regular,
            ),
        ]);
        let jex = read_jex(bytes.as_slice()).unwrap();
        assert!(jex.items.is_empty());
        assert_eq!(jex.skipped.len(), 2);
    }
}
