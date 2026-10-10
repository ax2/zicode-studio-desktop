use super::*;

impl NotesVault {
    pub(super) fn import_one_staged(
        &self,
        export: VaultExport,
    ) -> Result<NotebookDescriptor, NotesError> {
        if export.schema_version != VAULT_SCHEMA_VERSION {
            return Err(NotesError::new(
                "invalid_parameters",
                "Unsupported Notes backup schema version",
            ));
        }
        if export
            .notes
            .len()
            .saturating_add(export.trashed_notes.len())
            > MAX_NOTES
        {
            return Err(NotesError::new(
                "quota_exceeded",
                "Notes backup contains too many notes",
            ));
        }
        let imported_title = format!("{} (Imported)", export.notebook.title);
        validate_title(&imported_title)?;
        let mut note_ids = BTreeSet::new();
        let imported_note_count = export.notes.len();
        for document in &export.notes {
            validate_opaque_id(&document.summary.id)?;
            validate_title(&document.summary.title)?;
            validate_content(&document.content)?;
            normalize_tags(document.summary.tags.clone())?;
            if let Some(source) = &document.summary.source {
                validate_source(source)?;
            }
            if !note_ids.insert(document.summary.id.clone()) {
                return Err(NotesError::new(
                    "invalid_parameters",
                    "Notes backup contains duplicate note IDs",
                ));
            }
        }
        for trashed in &export.trashed_notes {
            let document = &trashed.note;
            validate_opaque_id(&document.summary.id)?;
            validate_title(&document.summary.title)?;
            validate_content(&document.content)?;
            normalize_tags(document.summary.tags.clone())?;
            if let Some(source) = &document.summary.source {
                validate_source(source)?;
            }
            if !note_ids.insert(document.summary.id.clone()) {
                return Err(NotesError::new(
                    "invalid_parameters",
                    "Notes backup contains duplicate note IDs",
                ));
            }
        }
        let mut total_attachment_bytes = 0usize;
        let mut attachment_ids = BTreeSet::new();
        let mut decoded_attachments = Vec::with_capacity(export.attachments.len());
        for attachment in export.attachments {
            if !note_ids.contains(&attachment.note_id) {
                return Err(NotesError::new(
                    "invalid_parameters",
                    "Backup attachment references a missing note",
                ));
            }
            let attachment_id = validate_attachment_id(&attachment.file_name)?;
            if !attachment_ids.insert((attachment.note_id.clone(), attachment_id.clone())) {
                return Err(NotesError::new(
                    "invalid_parameters",
                    "Notes backup contains duplicate attachments",
                ));
            }
            let expected_mime = attachment_mime_from_name(&attachment_id)?;
            if expected_mime != attachment.mime_type {
                return Err(NotesError::new(
                    "invalid_parameters",
                    "Backup attachment MIME type is invalid",
                ));
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(attachment.data_base64)
                .map_err(|_| {
                    NotesError::new(
                        "invalid_parameters",
                        "Backup attachment is not valid base64",
                    )
                })?;
            if bytes.is_empty() || bytes.len() > MAX_ATTACHMENT_BYTES {
                return Err(NotesError::new(
                    "payload_too_large",
                    "Backup attachment exceeds the 5 MiB per-file limit",
                ));
            }
            total_attachment_bytes = total_attachment_bytes.saturating_add(bytes.len());
            if total_attachment_bytes > MAX_EXPORT_ATTACHMENT_BYTES {
                return Err(NotesError::new(
                    "quota_exceeded",
                    "Backup attachments exceed the 50 MiB import limit",
                ));
            }
            decoded_attachments.push((attachment.note_id, attachment_id, bytes));
        }

        let notebook = self.create_notebook(&imported_title, export.notebook.icon.clone(), None)?;
        let import_result = (|| {
            for document in export.notes {
                let imported = NoteDocument {
                    summary: NoteSummary {
                        id: document.summary.id,
                        notebook_id: notebook.id.clone(),
                        title: document.summary.title,
                        icon: validate_icon(document.summary.icon)?,
                        created_at: document.summary.created_at,
                        updated_at: document.summary.updated_at,
                        tags: normalize_tags(document.summary.tags)?,
                        source: document.summary.source,
                        snippet: None,
                        version: String::new(),
                    },
                    content: normalize_newlines(&document.content),
                };
                self.write_note(&imported, None)?;
            }
            let trash_dir = self.vault_root(&notebook.id)?.join(".trash");
            fs::create_dir_all(&trash_dir).map_err(|_| {
                NotesError::new("storage_unavailable", "Cannot prepare the Notes trash")
            })?;
            for trashed in export.trashed_notes {
                let imported = NoteDocument {
                    summary: NoteSummary {
                        id: trashed.note.summary.id,
                        notebook_id: notebook.id.clone(),
                        title: trashed.note.summary.title,
                        icon: validate_icon(trashed.note.summary.icon)?,
                        created_at: trashed.note.summary.created_at,
                        updated_at: trashed.note.summary.updated_at,
                        tags: normalize_tags(trashed.note.summary.tags)?,
                        source: trashed.note.summary.source,
                        snippet: None,
                        version: String::new(),
                    },
                    content: normalize_newlines(&trashed.note.content),
                };
                let bytes = serialize_note(&imported)?;
                let path = trash_dir.join(format!("{}.md", imported.summary.id));
                atomic_write(&path, &bytes)?;
                let deleted_at = chrono::DateTime::parse_from_rfc3339(&trashed.deleted_at)
                    .map_err(|_| {
                        NotesError::new(
                            "invalid_parameters",
                            "Notes backup trash timestamp is invalid",
                        )
                    })?;
                trash_metadata::write(
                    &path,
                    if trashed.deletion_time_known {
                        deleted_at
                            .with_timezone(&Utc)
                            .to_rfc3339_opts(SecondsFormat::Secs, true)
                    } else {
                        now_iso()
                    },
                    trashed.deletion_time_known,
                )?;
            }
            for (note_id, attachment_id, bytes) in decoded_attachments {
                let path = self
                    .vault_root(&notebook.id)?
                    .join("public")
                    .join("attachments")
                    .join(validate_opaque_id(&note_id)?)
                    .join(attachment_id);
                atomic_write(&path, &bytes)?;
            }
            self.touch_notebook(&notebook.id)
        })();
        // The batch owner reclaims the complete private staging directory on error.
        import_result?;
        // Report the real note count (the freshly created descriptor starts
        // at zero until the imported documents are written).
        Ok(NotebookDescriptor {
            note_count: imported_note_count,
            ..notebook
        })
    }
}
