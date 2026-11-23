use super::external_html;
use super::*;
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(rename = "en-export")]
struct Export {
    #[serde(rename = "note", default)]
    notes: Vec<EvernoteNote>,
}

#[derive(Deserialize)]
struct EvernoteNote {
    #[serde(default)]
    title: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    created: String,
    #[serde(default)]
    updated: String,
    #[serde(rename = "tag", default)]
    tags: Vec<String>,
    #[serde(rename = "resource", default)]
    resources: Vec<Resource>,
}

#[derive(Deserialize)]
struct Resource {
    mime: String,
    data: EncodedResource,
    #[serde(rename = "resource-attributes")]
    attributes: Option<ResourceAttributes>,
}

#[derive(Deserialize)]
struct ResourceAttributes {
    #[serde(rename = "file-name")]
    name: Option<String>,
}

#[derive(Deserialize)]
struct EncodedResource {
    #[serde(rename = "@encoding")]
    encoding: Option<String>,
    #[serde(rename = "$text", default)]
    text: String,
}

pub(crate) fn prepare(
    file_name: &str,
    bytes: &[u8],
) -> Result<(VaultExportBundle, Vec<String>), NotesError> {
    validate_root(bytes)?;
    let export: Export = quick_xml::de::from_reader(bytes).map_err(|_| invalid_enex())?;
    if export.notes.is_empty() || export.notes.len() > MAX_NOTES {
        return Err(NotesError::new(
            "invalid_parameters",
            "ENEX must contain between 1 and 2,000 notes",
        ));
    }
    let now = now_iso();
    let stem = title_from_file_name(file_name);
    let mut book = super::jex_import::notebook(Uuid::new_v4().to_string(), &stem, None, &now);
    let mut warnings = Vec::new();
    let mut total_attachment_bytes = 0usize;

    for (index, entry) in export.notes.into_iter().enumerate() {
        if entry.content.len() > 4 * MAX_NOTE_BYTES {
            return Err(NotesError::new(
                "payload_too_large",
                format!("Note {}: ENEX content exceeds the import limit", index + 1),
            ));
        }
        let title = if entry.title.trim().is_empty() {
            "Untitled".into()
        } else {
            entry.title
        };
        let id = Uuid::new_v4().to_string();
        let mut attachments = BTreeMap::new();
        for resource in entry.resources {
            match decode_resource(resource, &id, &mut total_attachment_bytes) {
                Some((hash, media, attachment)) => {
                    attachments.entry(hash).or_insert(media);
                    book.attachments.push(attachment);
                }
                None => warnings.push(format!(
                    "Note {}: unsupported or oversized attachment",
                    index + 1
                )),
            }
        }

        let mut referenced = BTreeSet::new();
        let converted = external_html::convert(&entry.content, |hash| {
            let hash = hash.to_ascii_lowercase();
            let media = attachments.get(&hash)?;
            referenced.insert(hash);
            Some(external_html::Media {
                label: media.label.clone(),
                destination: media.destination.clone(),
                image: media.image,
            })
        });
        let mut content = converted.markdown;
        for (hash, media) in attachments {
            if !referenced.contains(&hash) {
                content.push_str(&format!(
                    "\n\n[{}]({})",
                    external_html::escape_text(&media.label),
                    media.destination
                ));
            }
        }
        warnings.extend(
            converted
                .warnings
                .into_iter()
                .map(|warning| format!("Note {}: {warning}", index + 1)),
        );
        validate_content(&content)?;
        let created_at = enex_date(&entry.created).unwrap_or_else(|| now.clone());
        let updated_at = enex_date(&entry.updated).unwrap_or_else(|| created_at.clone());
        if (!entry.created.is_empty() && enex_date(&entry.created).is_none())
            || (!entry.updated.is_empty() && enex_date(&entry.updated).is_none())
        {
            warnings.push(format!("Note {}: invalid Evernote date", index + 1));
        }
        book.notes.push(NoteDocument {
            summary: NoteSummary {
                id,
                notebook_id: book.notebook.id.clone(),
                title,
                icon: None,
                created_at,
                updated_at,
                tags: normalize_tags(entry.tags)?,
                source: None,
                snippet: None,
                version: String::new(),
            },
            content,
            previous_notebook_ids: Vec::new(),
        });
    }
    book.notebook.note_count = book.notes.len();
    warnings.sort_unstable();
    warnings.dedup();
    Ok((
        VaultExportBundle {
            schema_version: 1,
            notebooks: vec![book],
        },
        warnings,
    ))
}

fn validate_root(bytes: &[u8]) -> Result<(), NotesError> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_reader(bytes);
    reader.config_mut().trim_text(true);
    loop {
        match reader.read_event().map_err(|_| invalid_enex())? {
            Event::Start(element) | Event::Empty(element)
                if element.name().as_ref() == b"en-export" =>
            {
                return Ok(())
            }
            Event::Decl(_) | Event::Comment(_) | Event::DocType(_) => {}
            Event::Text(text) if text.is_empty() => {}
            _ => return Err(invalid_enex()),
        }
    }
}

fn decode_resource(
    resource: Resource,
    note_id: &str,
    total: &mut usize,
) -> Option<(String, external_html::Media, VaultExportAttachment)> {
    if !matches!(resource.data.encoding.as_deref(), None | Some("base64")) {
        return None;
    }
    let candidate = match resource.mime.as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "application/pdf" => "pdf",
        "text/plain" => "txt",
        "text/markdown" => "md",
        "text/csv" => "csv",
        "application/json" => "json",
        _ => return None,
    };
    let mime = attachment_mime_from_extension(candidate).ok()?;
    let data = resource.data.text;
    // ENEX exports put line breaks inside base64. Reject oversized entries
    // before decoding them and bound the aggregate retained byte count.
    let encoded: Vec<u8> = data
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .take(MAX_ATTACHMENT_BYTES.div_ceil(3) * 4 + 1)
        .collect();
    if encoded.len() > MAX_ATTACHMENT_BYTES.div_ceil(3) * 4 {
        return None;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&encoded)
        .ok()?;
    if bytes.is_empty()
        || bytes.len() > MAX_ATTACHMENT_BYTES
        || total.saturating_add(bytes.len()) > MAX_EXPORT_ATTACHMENT_BYTES
    {
        return None;
    }
    *total += bytes.len();
    let hash = format!("{:x}", md5::Md5::digest(&bytes));
    let file_name = format!("{}.{candidate}", Uuid::new_v4());
    let label = resource
        .attributes
        .and_then(|attrs| attrs.name)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| format!("Evernote attachment.{candidate}"));
    let media = external_html::Media {
        label: label.replace(['\r', '\n'], " "),
        destination: format!("/attachments/{note_id}/{file_name}"),
        image: mime.starts_with("image/"),
    };
    let attachment = VaultExportAttachment {
        note_id: note_id.to_owned(),
        file_name,
        mime_type: mime.into(),
        data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    };
    Some((hash, media, attachment))
}

fn enex_date(value: &str) -> Option<String> {
    chrono::NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%SZ")
        .ok()
        .map(|date| date.and_utc().to_rfc3339())
}

fn invalid_enex() -> NotesError {
    NotesError::new("invalid_parameters", "Invalid Evernote ENEX archive")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restores_evernote_note_dates_tags_and_attachment() {
        let data = b"attached text";
        let encoded = base64::engine::general_purpose::STANDARD.encode(data);
        let digest = format!("{:x}", md5::Md5::digest(data));
        let source = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE en-export SYSTEM "https://xml.evernote.com/pub/evernote-export4.dtd">
            <en-export><note><title>中文笔记</title>
            <content><![CDATA[<en-note><p>正文</p><en-media hash="{digest}" type="text/plain"/><p>附件后面的正文</p></en-note>]]></content>
            <created>20260405T123456Z</created><tag>任务</tag>
            <resource><data encoding="base64">{encoded}</data><mime>text/plain</mime>
            <resource-attributes><file-name>附件.txt</file-name></resource-attributes></resource>
            </note></en-export>"#
        );
        let (bundle, warnings) = prepare("Evernote", source.as_bytes()).unwrap();
        assert!(warnings.is_empty());
        let book = &bundle.notebooks[0];
        assert_eq!(book.notebook.title, "Evernote");
        let note = &book.notes[0];
        assert_eq!(note.summary.title, "中文笔记");
        assert_eq!(note.summary.created_at, "2026-04-05T12:34:56+00:00");
        assert_eq!(note.summary.tags, ["任务"]);
        assert!(note.content.contains("[附件.txt](/attachments/"));
        assert!(note.content.contains("附件后面的正文"));
        assert_eq!(book.attachments.len(), 1);
        assert_eq!(book.attachments[0].data_base64, encoded);
    }

    #[test]
    fn rejects_non_enex_xml_and_discloses_lost_content() {
        assert!(prepare("Other", b"<invalid/>").is_err());
        let source = br#"<en-export><note><title>Note</title><created>broken</created>
            <content><![CDATA[<en-note><img src="https://test.example/track"/>
            <en-crypt>secret</en-crypt><en-media type="image/png" hash="notfound"/></en-note>]]></content>
            </note></en-export>"#;
        let (bundle, warnings) = prepare("Evernote", source).unwrap();
        let content = &bundle.notebooks[0].notes[0].content;
        assert!(!content.contains("test.example"));
        assert!(!content.contains("secret"));
        assert_eq!(warnings.len(), 4);
    }

    #[test]
    #[ignore = "requires an Evernote ENEX sample provided in ZICODE_ENEX_TEST_FILE"]
    fn imports_a_real_format_evernote_sample() {
        let path = std::env::var_os("ZICODE_ENEX_TEST_FILE").expect("ENEX fixture path");
        let bytes = fs::read(path).expect("read ENEX fixture");
        let (bundle, warnings) = prepare("Imported sample.enex", &bytes).unwrap();
        assert!(warnings
            .iter()
            .any(|warning| warning.contains("unsupported"))); // The public fixture also contains an SVG.
        let book = &bundle.notebooks[0];
        assert_eq!(book.notes.len(), 1);
        assert_eq!(book.attachments.len(), 1);
        assert_eq!(book.notes[0].content.matches("](/attachments/").count(), 1);
        let temp = tempfile::tempdir().unwrap();
        let target = NotesVault::new(temp.path().join("plugin-data")).unwrap();
        let imported = target.import_all_export(bundle).unwrap();
        assert_eq!(imported.len(), 1);
        let persisted = target.export_notebook(&imported[0].id).unwrap();
        assert_eq!(persisted.attachments.len(), 1);
    }
}
