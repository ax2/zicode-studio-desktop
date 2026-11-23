use super::jex::{self, JexItem, JexKind};
use super::*;
use std::collections::BTreeMap;

const UNFILED_ID: &str = "00000000-0000-0000-0000-000000000000";

/// Convert source IDs into Studio's archival model so the existing import
/// transaction can assign new notebook IDs and rewrite cross-notebook links.
pub(crate) fn prepare(
    reader: impl std::io::Read,
) -> Result<(VaultExportBundle, Vec<String>), NotesError> {
    let archive = jex::read_jex(reader)
        .map_err(|error| NotesError::new("invalid_parameters", error.to_string()))?;
    let mut issues = archive.skipped;
    let mut books = BTreeMap::new();
    let mut note_books = BTreeMap::new();
    let now = now_iso();

    for (id, item) in &archive.items {
        if item.kind != JexKind::Notebook {
            continue;
        }
        let parent = property(item, "parent_id");
        let parent_id = if parent.is_empty() {
            None
        } else if archive
            .items
            .get(&parent.to_ascii_lowercase())
            .is_some_and(|item| item.kind == JexKind::Notebook)
        {
            Some(studio_id(parent)?)
        } else {
            issues.push(format!("{id}: parent notebook {parent} is missing"));
            None
        };
        let book_id = studio_id(id)?;
        books.insert(
            book_id.clone(),
            notebook(book_id, &item.title, parent_id, &now),
        );
    }

    for (id, item) in &archive.items {
        if item.kind != JexKind::Note {
            continue;
        }
        let parent = property(item, "parent_id");
        let book_id = Uuid::parse_str(parent)
            .ok()
            .map(|id| id.to_string())
            .filter(|id| books.contains_key(id))
            .unwrap_or_else(|| UNFILED_ID.to_owned());
        if book_id == UNFILED_ID && !parent.is_empty() {
            issues.push(format!("{id}: source notebook {parent} is missing"));
        }
        note_books.insert(id.clone(), book_id);
    }
    if note_books.values().any(|id| id == UNFILED_ID) {
        books
            .entry(UNFILED_ID.to_owned())
            .or_insert_with(|| notebook(UNFILED_ID.to_owned(), "Joplin", None, &now));
    }

    let mut tags = BTreeMap::<String, Vec<String>>::new();
    for (id, item) in &archive.items {
        if item.kind != JexKind::NoteTag {
            continue;
        }
        let note = property(item, "note_id").to_ascii_lowercase();
        let tag = archive
            .items
            .get(&property(item, "tag_id").to_ascii_lowercase());
        match tag {
            Some(tag) if tag.kind == JexKind::Tag && note_books.contains_key(&note) => {
                tags.entry(note).or_default().push(tag.title.clone());
            }
            _ => issues.push(format!("{id}: tag assignment has a missing target")),
        }
    }

    let mut resource_by_id = BTreeMap::new();
    for (name, bytes) in &archive.resources {
        let id = name.split_once('.').map_or(name.as_str(), |(stem, _)| stem);
        let normalized = id.to_ascii_lowercase();
        if resource_by_id.insert(normalized, (name, bytes)).is_some() {
            return Err(NotesError::new(
                "invalid_parameters",
                "Duplicate Joplin resource ID",
            ));
        }
    }
    let mut total_attachment_bytes = 0usize;
    for (id, book_id) in &note_books {
        let item = &archive.items[id];
        let note_id = studio_id(id)?;
        let book = books
            .get_mut(book_id)
            .expect("Joplin notebook mapped before importing notes");
        let mut attachment_names = BTreeSet::new();
        let content = rewrite_targets(&item.body, |target| {
            if let Some(destination) = note_books.get(target) {
                return Some(format!(
                    "zicode-note://{destination}/{}",
                    studio_id(target).ok()?
                ));
            }
            let Some((name, bytes)) = resource_by_id.get(target) else {
                issues.push(format!("{id}: linked item {target} is missing"));
                return None;
            };
            let exported = archive
                .items
                .get(target)
                .filter(|item| item.kind == JexKind::Resource);
            let ext = Path::new(name)
                .extension()
                .and_then(|value| value.to_str())
                .filter(|ext| !ext.is_empty())
                .unwrap_or_else(|| exported.map_or("", |item| property(item, "file_extension")))
                .to_ascii_lowercase();
            let ext = if ext == "jpeg" { "jpg" } else { ext.as_str() };
            let Ok(mime) = attachment_mime_from_extension(ext) else {
                issues.push(format!("{id}: attachment {target} has unsupported type"));
                return None;
            };
            if bytes.is_empty() {
                issues.push(format!("{id}: attachment {target} is empty"));
                return None;
            }
            let file_name = format!("{}.{ext}", studio_id(target).ok()?);
            if !attachment_names.contains(&file_name) {
                if total_attachment_bytes + bytes.len() > MAX_EXPORT_ATTACHMENT_BYTES {
                    issues.push(format!(
                        "{id}: attachment {target} exceeds the import budget"
                    ));
                    return None;
                }
                total_attachment_bytes += bytes.len();
                attachment_names.insert(file_name.clone());
                book.attachments.push(VaultExportAttachment {
                    note_id: note_id.clone(),
                    file_name: file_name.clone(),
                    mime_type: mime.to_owned(),
                    data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
                });
            }
            Some(format!("/attachments/{note_id}/{file_name}"))
        });
        validate_content(&content)?;
        let created_at = timestamp(item, "user_created_time", "created_time", &now);
        let updated_at = timestamp(item, "user_updated_time", "updated_time", &created_at);
        book.notes.push(NoteDocument {
            summary: NoteSummary {
                id: note_id,
                notebook_id: book_id.clone(),
                title: if item.title.trim().is_empty() {
                    "Untitled".to_owned()
                } else {
                    item.title.clone()
                },
                icon: None,
                created_at,
                updated_at,
                tags: tags.remove(id).unwrap_or_default(),
                source: None,
                snippet: None,
                version: String::new(),
            },
            content,
            previous_notebook_ids: Vec::new(),
        });
        book.notebook.note_count = book.notes.len();
    }
    if books.is_empty() {
        return Err(NotesError::new(
            "invalid_parameters",
            "Joplin archive contains no importable notes or notebooks",
        ));
    }
    issues.sort_unstable();
    issues.dedup();
    Ok((
        VaultExportBundle {
            schema_version: 1,
            notebooks: books.into_values().collect(),
        },
        issues,
    ))
}

fn notebook(id: String, title: &str, parent_id: Option<String>, now: &str) -> VaultExport {
    VaultExport {
        schema_version: VAULT_SCHEMA_VERSION,
        exported_at: now.to_owned(),
        notebook: NotebookDescriptor {
            id,
            workspace_id: String::new(),
            title: if title.trim().is_empty() {
                "Joplin".to_owned()
            } else {
                title.to_owned()
            },
            icon: None,
            parent_id,
            created_at: now.to_owned(),
            updated_at: now.to_owned(),
            note_count: 0,
        },
        notes: Vec::new(),
        trashed_notes: Vec::new(),
        attachments: Vec::new(),
    }
}

fn property<'a>(item: &'a JexItem, key: &str) -> &'a str {
    item.properties.get(key).map_or("", String::as_str)
}

fn timestamp(item: &JexItem, preferred: &str, fallback: &str, default: &str) -> String {
    [preferred, fallback]
        .into_iter()
        .find_map(|key| chrono::DateTime::parse_from_rfc3339(property(item, key)).ok())
        .map_or_else(|| default.to_owned(), |time| time.to_utc().to_rfc3339())
}

fn studio_id(source: &str) -> Result<String, NotesError> {
    Uuid::parse_str(source)
        .map(|id| id.to_string())
        .map_err(|_| NotesError::new("invalid_parameters", "Invalid Joplin item ID"))
}

fn rewrite_targets(body: &str, mut replacement: impl FnMut(&str) -> Option<String>) -> String {
    let mut result = String::with_capacity(body.len());
    let mut cursor = 0;
    // Only rewrite the inline Markdown destinations produced by Joplin.
    for (index, _) in body.match_indices("](:/") {
        let start = index + 2;
        let id_start = start + 2;
        let Some(raw) = body.get(id_start..id_start + 32) else {
            continue;
        };
        if !raw.bytes().all(|byte| byte.is_ascii_hexdigit())
            || body.as_bytes().get(id_start + 32) != Some(&b')')
        {
            continue;
        }
        if let Some(target) = replacement(&raw.to_ascii_lowercase()) {
            result.push_str(&body[cursor..start]);
            result.push_str(&target);
            cursor = id_start + 32;
        }
    }
    result.push_str(&body[cursor..]);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_jex_into_new_notebooks_and_resolves_original_links() {
        let book = Uuid::from_u128(1).simple().to_string();
        let child = Uuid::from_u128(2).simple().to_string();
        let note = Uuid::from_u128(3).simple().to_string();
        let linked = Uuid::from_u128(4).simple().to_string();
        let tag = Uuid::from_u128(5).simple().to_string();
        let tag_link = Uuid::from_u128(6).simple().to_string();
        let image = Uuid::from_u128(7).simple().to_string();
        let mut archive = tar::Builder::new(Vec::new());
        let mut add = |name: String, body: &str| {
            let mut header = tar::Header::new_ustar();
            header.set_size(body.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            archive
                .append_data(&mut header, name, body.as_bytes())
                .unwrap();
        };
        for (id, item) in [
            (&book, format!("父笔记本\n\nid: {book}\ntype_: 2")),
            (&child, format!("子笔记本\n\nid: {child}\nparent_id: {book}\ntype_: 2")),
            (&note, format!("导入笔记\n\n[互链](:/{linked})\n[附件](:/{image})\n\nid: {note}\nparent_id: {book}\nuser_created_time: 2026-01-02T03:04:05Z\ntype_: 1")),
            (&linked, format!("目标笔记\n\n正文\n\nid: {linked}\nparent_id: {child}\ntype_: 1")),
            (&tag, format!("项目\n\nid: {tag}\ntype_: 5")),
            (&tag_link, format!("id: {tag_link}\nnote_id: {note}\ntag_id: {tag}\ntype_: 6")),
        ] {
            add(format!("{id}.md"), &item);
        }
        add(format!("resources/{image}.txt"), "独立附件");
        let bytes = archive.into_inner().unwrap();
        let (bundle, warnings) = prepare(bytes.as_slice()).unwrap();
        assert!(warnings.is_empty());
        let temp = tempfile::tempdir().unwrap();
        let vault = NotesVault::new(temp.path().join("plugins")).unwrap();
        let before = vault
            .create_notebook("父笔记本 (Imported)", None, None)
            .unwrap();
        let existing = vault
            .create_note(&before.id, "已有", "保持原样", Vec::new(), None, None)
            .unwrap();
        let books = vault.import_all_export(bundle).unwrap();
        let parent = books
            .iter()
            .find(|book| book.title == "父笔记本 (Imported)")
            .unwrap();
        let imported_child = books
            .iter()
            .find(|book| book.title == "子笔记本 (Imported)")
            .unwrap();
        assert_eq!(
            imported_child.parent_id.as_deref(),
            Some(parent.id.as_str())
        );
        let note = vault
            .get_note(&parent.id, &studio_id(&note).unwrap())
            .unwrap();
        assert_eq!(note.summary.tags, ["项目"]);
        assert_eq!(note.summary.created_at, "2026-01-02T03:04:05+00:00");
        assert!(note.content.contains(&format!(
            "zicode-note://{}/{}",
            imported_child.id,
            studio_id(&linked).unwrap()
        )));
        let name = format!("{}.txt", studio_id(&image).unwrap());
        assert_eq!(
            fs::read(
                vault
                    .vault_root(&parent.id)
                    .unwrap()
                    .join("public/attachments")
                    .join(&note.summary.id)
                    .join(name)
            )
            .unwrap(),
            "独立附件".as_bytes()
        );
        assert_eq!(
            vault
                .get_note(&before.id, &existing.summary.id)
                .unwrap()
                .content,
            "保持原样"
        );
    }
}
