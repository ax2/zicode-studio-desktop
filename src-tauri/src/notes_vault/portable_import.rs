use super::markdown_import::{self, MarkdownNote};
use super::*;
use std::borrow::Cow;

pub(crate) fn prepare(
    file_name: &str,
    bytes: &[u8],
) -> Result<(VaultExportBundle, Vec<String>), NotesError> {
    let extension = Path::new(file_name)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "jex" => super::jex_import::prepare(bytes),
        "enex" => super::enex::prepare(file_name, bytes),
        "html" | "htm" | "txt" | "md" | "markdown" => single(file_name, bytes, &extension),
        _ => Err(NotesError::new(
            "invalid_parameters",
            "Unsupported Notes import format",
        )),
    }
}

fn single(
    file_name: &str,
    bytes: &[u8],
    extension: &str,
) -> Result<(VaultExportBundle, Vec<String>), NotesError> {
    if bytes.is_empty() || bytes.len() > MAX_NOTE_BYTES {
        return Err(NotesError::new(
            "payload_too_large",
            "Note exceeds the 1 MiB limit",
        ));
    }
    let text = decode_text(bytes)?;
    let stem = title_from_file_name(file_name);
    let incoming = match extension {
        "html" | "htm" => {
            let converted = super::external_html::convert(&text, |_| None);
            MarkdownNote {
                title: converted.title.unwrap_or_else(|| stem.clone()),
                content: converted.markdown,
                tags: Vec::new(),
                created_at: None,
                updated_at: None,
                warnings: converted.warnings,
            }
        }
        "txt" => MarkdownNote {
            title: stem.clone(),
            content: super::external_html::escape_text(&normalize_newlines(&text)),
            tags: Vec::new(),
            created_at: None,
            updated_at: None,
            warnings: Vec::new(),
        },
        _ => markdown_import::parse(file_name, &text)?,
    };
    validate_title(&incoming.title)?;
    validate_content(&incoming.content)?;
    let time = now_iso();
    let mut book = super::jex_import::notebook(Uuid::new_v4().to_string(), &stem, None, &time);
    let created_at = incoming.created_at.unwrap_or(time);
    let updated_at = incoming.updated_at.unwrap_or_else(|| created_at.clone());
    book.notebook.note_count = 1;
    book.notes.push(NoteDocument {
        summary: NoteSummary {
            id: Uuid::new_v4().to_string(),
            notebook_id: book.notebook.id.clone(),
            title: incoming.title,
            icon: None,
            created_at,
            updated_at,
            tags: incoming.tags,
            source: None,
            snippet: None,
            version: String::new(),
        },
        content: incoming.content,
        previous_notebook_ids: Vec::new(),
    });
    Ok((
        VaultExportBundle {
            schema_version: 1,
            notebooks: vec![book],
        },
        incoming.warnings,
    ))
}

fn decode_text(bytes: &[u8]) -> Result<Cow<'_, str>, NotesError> {
    let utf16 = if let Some(rest) = bytes.strip_prefix(&[0xff, 0xfe]) {
        Some((rest, u16::from_le_bytes as fn([u8; 2]) -> u16))
    } else {
        bytes
            .strip_prefix(&[0xfe, 0xff])
            .map(|rest| (rest, u16::from_be_bytes as fn([u8; 2]) -> u16))
    };
    let invalid = || {
        NotesError::new(
            "invalid_parameters",
            "Text notes must be UTF-8 or BOM-marked UTF-16",
        )
    };
    if let Some((raw, convert)) = utf16 {
        let (units, remainder) = raw.as_chunks::<2>();
        if !remainder.is_empty() {
            return Err(invalid());
        }
        return char::decode_utf16(units.iter().copied().map(convert))
            .collect::<Result<String, _>>()
            .map(Cow::Owned)
            .map_err(|_| invalid());
    }
    std::str::from_utf8(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes))
        .map(Cow::Borrowed)
        .map_err(|_| invalid())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_plain_text_as_literal_note_content() {
        let (bundle, warnings) = prepare("待办.TXT", "第一行\r\n<img src=x>".as_bytes()).unwrap();
        let notebook = &bundle.notebooks[0];
        assert!(warnings.is_empty());
        assert_eq!(notebook.notebook.title, "待办");
        assert_eq!(notebook.notes[0].content, "第一行\n\\<img src=x\\>");
    }

    #[test]
    fn html_uses_its_title_and_does_not_keep_a_live_image() {
        let (bundle, warnings) = prepare(
            "笔记.html",
            b"<title>Saved page</title><p>Notes<img src=\"https://example.com/image.png\" alt=\"old image\"></p>",
        ).unwrap();
        let notebook = &bundle.notebooks[0];
        assert_eq!(notebook.notes[0].summary.title, "Saved page");
        assert_eq!(notebook.notes[0].content, "Notesold image");
        assert_eq!(warnings, ["Skipped image outside the import archive"]);
    }
}
