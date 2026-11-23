use super::folder_links::{self, Link, Targets};
use super::markdown_import;
use super::*;
use std::collections::BTreeMap;

pub(crate) const MAX_FOLDER_FILES: usize = 4096;
pub(crate) const MAX_FOLDER_BYTES: usize = 64 * 1024 * 1024;

struct Draft {
    id: String,
    notebook_id: String,
    note: markdown_import::MarkdownNote,
}

type Files = BTreeMap<String, bytes::Bytes>;

pub(crate) fn prepare(files: Files) -> Result<(VaultExportBundle, Vec<String>), NotesError> {
    if files.is_empty() || files.len() > MAX_FOLDER_FILES {
        return Err(invalid("The selected folder must contain 1 to 4,096 files"));
    }
    if files.values().map(bytes::Bytes::len).sum::<usize>() > MAX_FOLDER_BYTES {
        return Err(invalid("The selected folder exceeds 64 MiB"));
    }
    let mut root = None;
    let mut directory = BTreeMap::new();
    let mut names = BTreeSet::new();
    for (path, bytes) in files {
        let (folder, relative) = checked_path(&path)?;
        if root.as_deref().is_some_and(|previous| previous != folder) {
            return Err(invalid("Select one Markdown directory at a time"));
        }
        root.get_or_insert_with(|| folder.to_owned());
        if !names.insert(relative.to_lowercase()) {
            return Err(invalid(
                "The selected directory contains a case-insensitive path collision",
            ));
        }
        if !relative.split('/').any(|part| part.starts_with('.')) {
            directory.insert(relative.to_owned(), bytes);
        }
    }
    let mut drafts = BTreeMap::new();
    let mut notebooks = BTreeMap::new();
    let mut warnings = BTreeSet::new();
    let now = now_iso();
    let root = root.expect("validated directory contains files");
    for (path, bytes) in &directory {
        if !matches!(extension(path).as_str(), "md" | "markdown") {
            continue;
        }
        let draft = std::str::from_utf8(bytes)
            .map_err(|_| invalid("Markdown is not UTF-8"))
            .and_then(|text| markdown_import::parse(path, text))
            .and_then(|note| {
                validate_title(&note.title)?;
                Ok(note)
            });
        let note = match draft {
            Ok(note) => note,
            Err(error) => {
                warn(&mut warnings, format!("{path}: {}", error.message));
                continue;
            }
        };
        for warning in &note.warnings {
            warn(&mut warnings, format!("{path}: {warning}"));
        }
        let parent = path.rsplit_once('/').map_or("", |(parent, _)| parent);
        let notebook_id = ensure_notebook(&mut notebooks, &root, parent, &now)?;
        drafts.insert(
            path.clone(),
            Draft {
                id: Uuid::new_v4().to_string(),
                notebook_id,
                note,
            },
        );
    }
    if drafts.is_empty() {
        return Err(invalid(
            "The selected folder contains no importable Markdown notes",
        ));
    }

    let note_targets = Targets::new(drafts.keys().map(String::as_str));
    let assets = Targets::new(
        directory
            .keys()
            .filter(|path| !matches!(extension(path).as_str(), "md" | "markdown"))
            .map(String::as_str),
    );
    let mut attachment_bytes = 0usize;
    let mut referenced_assets = BTreeSet::new();

    for (path, draft) in &drafts {
        let parent = path.rsplit_once('/').map_or("", |(parent, _)| parent);
        let book = notebooks
            .get_mut(parent)
            .expect("notebook allocated before notes");
        if book.notes.len() >= MAX_NOTES {
            return Err(invalid(
                "An imported notebook contains more than 2,000 notes",
            ));
        }
        let mut copied = BTreeMap::<&str, String>::new();
        let content = folder_links::rewrite(&draft.note.content, |link| {
            if let Some(to) = note_targets.lookup(path, &link.target, link.wiki) {
                let destination = &drafts[to];
                if link.anchor.is_some() {
                    warn(
                        &mut warnings,
                        format!(
                            "{path}: link to {} opens the note without its section",
                            link.target
                        ),
                    );
                }
                let label = if link.label.trim().is_empty() {
                    &destination.note.title
                } else {
                    link.label
                };
                return Some(format!(
                    "[{}](zicode-note://{}/{})",
                    super::external_html::escape_text(label),
                    destination.notebook_id,
                    destination.id
                ));
            }
            let Some(asset) = assets.lookup(path, &link.target, link.wiki) else {
                warn(
                    &mut warnings,
                    format!("{path}: target not found or ambiguous: {}", link.target),
                );
                return None;
            };
            referenced_assets.insert(asset);
            let raw = &directory[asset];
            let ext = extension(asset);
            let ext = if ext == "jpeg" { "jpg" } else { &ext };
            let Ok(mime) = attachment_mime_from_extension(ext) else {
                warn(
                    &mut warnings,
                    format!("{path}: unsupported attachment: {asset}"),
                );
                return None;
            };
            let name = if let Some(name) = copied.get(asset) {
                name.clone()
            } else {
                if raw.is_empty()
                    || raw.len() > MAX_ATTACHMENT_BYTES
                    || attachment_bytes + raw.len() > MAX_EXPORT_ATTACHMENT_BYTES
                {
                    warn(
                        &mut warnings,
                        format!("{path}: attachment exceeds import limit: {asset}"),
                    );
                    return None;
                }
                let name = format!("{}.{ext}", Uuid::new_v4());
                book.attachments.push(VaultExportAttachment {
                    note_id: draft.id.clone(),
                    file_name: name.clone(),
                    mime_type: mime.to_owned(),
                    data_base64: base64::engine::general_purpose::STANDARD.encode(raw),
                });
                attachment_bytes += raw.len();
                copied.insert(asset, name.clone());
                name
            };
            Some(attachment_link(draft, link, asset, &name, mime))
        });
        validate_content(&content)?;
        book.notes.push(NoteDocument {
            summary: NoteSummary {
                id: draft.id.clone(),
                notebook_id: draft.notebook_id.clone(),
                title: draft.note.title.clone(),
                icon: None,
                created_at: draft.note.created_at.clone().unwrap_or_else(|| now.clone()),
                updated_at: draft
                    .note
                    .updated_at
                    .clone()
                    .or_else(|| draft.note.created_at.clone())
                    .unwrap_or_else(|| now.clone()),
                tags: draft.note.tags.clone(),
                source: None,
                snippet: None,
                version: String::new(),
            },
            content,
            previous_notebook_ids: Vec::new(),
        });
        book.notebook.note_count = book.notes.len();
    }
    let unreferenced = directory
        .keys()
        .filter(|path| {
            !matches!(extension(path).as_str(), "md" | "markdown")
                && !referenced_assets.contains(path.as_str())
        })
        .count();
    if unreferenced > 0 {
        warn(
            &mut warnings,
            format!("{unreferenced} unreferenced file(s) were skipped"),
        );
    }
    Ok((
        VaultExportBundle {
            schema_version: 1,
            notebooks: notebooks.into_values().collect(),
        },
        warnings.into_iter().collect(),
    ))
}

fn attachment_link(draft: &Draft, link: Link<'_>, path: &str, name: &str, mime: &str) -> String {
    let label = if link.label.is_empty() {
        path.rsplit('/').next().unwrap_or(path)
    } else {
        link.label
    };
    let marker = if link.image && mime.starts_with("image/") {
        "!"
    } else {
        ""
    };
    format!(
        "{marker}[{}](/attachments/{}/{name})",
        super::external_html::escape_text(label),
        draft.id
    )
}

fn checked_path(path: &str) -> Result<(&str, &str), NotesError> {
    if path.len() > 1024
        || path.contains(['\\', ':'])
        || path.chars().any(char::is_control)
        || path.split('/').any(|part| matches!(part, "" | "." | ".."))
        || path.split('/').count() > 32
    {
        return Err(invalid("Invalid relative path in the selected directory"));
    }
    path.split_once('/')
        .ok_or_else(|| invalid("Expected the selected directory name"))
}

fn extension(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn ensure_notebook(
    notebooks: &mut BTreeMap<String, VaultExport>,
    root: &str,
    parent: &str,
    now: &str,
) -> Result<String, NotesError> {
    if let Some(notebook) = notebooks.get(parent) {
        return Ok(notebook.notebook.id.clone());
    }
    let (name, parent_id) = if parent.is_empty() {
        (root, None)
    } else {
        let (upper, name) = parent.rsplit_once('/').unwrap_or(("", parent));
        (name, Some(ensure_notebook(notebooks, root, upper, now)?))
    };
    if notebooks.len() >= MAX_NOTEBOOKS {
        return Err(invalid(
            "The selected directory contains more than 200 notebooks",
        ));
    }
    validate_title(&format!("{name} (Imported)"))?;
    let id = Uuid::new_v4().to_string();
    notebooks.insert(
        parent.to_owned(),
        super::jex_import::notebook(id.clone(), name, parent_id, now),
    );
    Ok(id)
}

fn warn(warnings: &mut BTreeSet<String>, message: String) {
    if warnings.len() < 500 {
        warnings.insert(message);
    } else {
        warnings.insert("The remaining import warnings were omitted".into());
    }
}

fn invalid(message: &'static str) -> NotesError {
    NotesError::new("invalid_parameters", message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files(values: &[(&str, &str)]) -> Files {
        values
            .iter()
            .map(|(path, content)| {
                (
                    path.to_string(),
                    bytes::Bytes::copy_from_slice(content.as_bytes()),
                )
            })
            .collect()
    }

    #[test]
    fn restores_folder_hierarchy_and_rewrites_obsidian_links_and_assets() {
        let source = files(&[
            (
                "资料/入口.md",
                "---\ntags: [索引]\n---\n[[专题/目标|查看目标]] ![[pic.png|插图]]\n",
            ),
            (
                "资料/专题/目标.md",
                "[返回](../入口.md)\n\n![配图](<../资源/pic.png>)\n\n```\n[[入口]]\n```\n",
            ),
            ("资料/资源/pic.png", "synthetic image"),
            ("资料/.obsidian/config.json", "do not import"),
        ]);
        let (bundle, warnings) = prepare(source).unwrap();
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(bundle.notebooks.len(), 2);
        let profile = tempfile::tempdir().unwrap();
        let vault = NotesVault::new(profile.path().to_path_buf()).unwrap();
        let saved = vault.import_all_export(bundle).unwrap();
        let root = saved
            .iter()
            .find(|book| book.title == "资料 (Imported)")
            .unwrap();
        let nested = saved
            .iter()
            .find(|book| book.title == "专题 (Imported)")
            .unwrap();
        assert_eq!(nested.parent_id.as_deref(), Some(root.id.as_str()));
        let entry = vault.export_notebook(&root.id).unwrap();
        let child = vault.export_notebook(&nested.id).unwrap();
        assert_eq!(entry.notes[0].summary.tags, ["索引"]);
        assert!(entry.notes[0].content.contains(&format!(
            "[查看目标](zicode-note://{}/{})",
            nested.id, child.notes[0].summary.id
        )));
        assert!(child.notes[0].content.contains(&format!(
            "[返回](zicode-note://{}/{})",
            root.id, entry.notes[0].summary.id
        )));
        assert!(child.notes[0].content.contains("[[入口]]"));
        assert!(child.notes[0].content.contains("![配图](/attachments/"));
        assert_eq!(
            entry.attachments[0].data_base64,
            base64::engine::general_purpose::STANDARD.encode("synthetic image")
        );
    }

    #[test]
    fn rejects_escaping_and_duplicate_upload_paths_and_discloses_ambiguous_links() {
        assert!(prepare(files(&[("目录/../outside.md", "escape")])).is_err());
        assert!(prepare(files(&[("目录/A.md", "one"), ("目录/a.md", "two")])).is_err());
        let (bundle, warnings) = prepare(files(&[
            ("目录/首页.md", "[[重复]]"),
            ("目录/甲/重复.md", "one"),
            ("目录/乙/重复.md", "two"),
        ]))
        .unwrap();
        assert_eq!(bundle.notebooks[0].notes[0].content, "[[重复]]");
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("ambiguous"));
    }
}
