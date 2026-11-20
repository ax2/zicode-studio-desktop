use super::*;
use std::collections::BTreeSet;

struct Copier<'a> {
    desired: &'a mut Snapshot,
    local: &'a Snapshot,
    remote: &'a Snapshot,
    books: BTreeMap<(Side, String), String>,
    notes: BTreeSet<(Side, String, String)>,
    locale: CopyLocale,
}
impl Copier<'_> {
    fn source(&self, side: Side) -> &Snapshot {
        match side {
            Side::Local => self.local,
            Side::Remote => self.remote,
        }
    }
    fn notebook(&mut self, side: Side, book: &str) -> Result<String, SyncError> {
        let scope = (side, book.to_owned());
        if let Some(id) = self.books.get(&scope) {
            return Ok(id.clone());
        }
        let bytes = self
            .source(side)
            .get(&format!("book/{book}"))
            .ok_or(SyncError::InvalidData)?;
        let mut metadata: Book = decode(bytes).map_err(failure)?;
        records::validate_book(&metadata).map_err(failure)?;
        let id = (0..8)
            .map(|_| Uuid::new_v4().to_string())
            .find(|candidate| {
                !self
                    .desired
                    .keys()
                    .any(|id| key(id).is_ok_and(|parsed| parsed.book == candidate))
            })
            .ok_or(SyncError::InvalidData)?;
        let suffix = match (self.locale, side) {
            (CopyLocale::ZhCn, Side::Local) => " · 本地冲突副本",
            (CopyLocale::ZhCn, Side::Remote) => " · 云端冲突副本",
            (CopyLocale::En, Side::Local) => " · Local conflict copy",
            (CopyLocale::En, Side::Remote) => " · Cloud conflict copy",
        };
        metadata.title = metadata
            .title
            .chars()
            .take(MAX_TITLE_CHARS.saturating_sub(suffix.chars().count()))
            .collect::<String>()
            + suffix;
        metadata.id = id.clone();
        metadata.deleted = false;
        metadata.parent_id = None;
        metadata.created_at = now_iso();
        self.desired
            .insert(format!("book/{id}"), encode(&metadata).map_err(failure)?);
        self.books.insert(scope, id.clone());
        Ok(id)
    }
    fn note(&mut self, side: Side, book: &str, note: &str) -> Result<(), SyncError> {
        if !self.notes.insert((side, book.to_owned(), note.to_owned())) {
            return Ok(());
        }
        let destination = self.notebook(side, book)?;
        let key = format!("note/{book}/{note}");
        let bytes = if let Some(bytes) = self.source(side).get(&key) {
            let _: SavedNote = decode(bytes).map_err(failure)?;
            // Preserve Markdown, note IDs, attachment URLs and trash state.
            // The new active notebook exposes a retained deleted version in
            // its own Trash, without silently restoring unrelated notes.
            bytes.clone()
        } else {
            // Existing projections retain orphan attachments. Give a preserved
            // orphan an accessible note rather than silently dropping its bytes.
            let title = match self.locale {
                CopyLocale::ZhCn => "保留的附件",
                CopyLocale::En => "Preserved attachments",
            };
            let prefix = format!("attachment/{book}/{note}/");
            let links = self
                .source(side)
                .keys()
                .filter_map(|id| id.strip_prefix(&prefix))
                .map(|name| format!("[{name}](/attachments/{note}/{name})"))
                .collect::<Vec<_>>();
            if links.is_empty() {
                return Err(SyncError::InvalidData);
            }
            let document = NoteDocument {
                summary: NoteSummary {
                    id: note.to_owned(),
                    notebook_id: destination.clone(),
                    title: title.to_owned(),
                    icon: None,
                    created_at: now_iso(),
                    updated_at: now_iso(),
                    tags: Vec::new(),
                    source: None,
                    snippet: None,
                    version: String::new(),
                },
                content: links.join("\n\n"),
                previous_notebook_ids: Vec::new(),
            };
            let saved = SavedNote {
                markdown: String::from_utf8(serialize_note(&document).map_err(failure)?)
                    .map_err(failure)?,
                deleted_at: None,
                deletion_time_known: false,
            };
            encode(&saved).map_err(failure)?
        };
        self.desired
            .insert(format!("note/{destination}/{note}"), bytes);
        let prefix = format!("attachment/{book}/{note}/");
        let attachments = self
            .source(side)
            .iter()
            .filter_map(|(id, bytes)| {
                id.strip_prefix(&prefix)
                    .map(|name| (name.to_owned(), bytes.clone()))
            })
            .collect::<Vec<_>>();
        for (name, bytes) in attachments {
            validate_attachment_id(&name).map_err(failure)?;
            self.desired
                .insert(format!("attachment/{destination}/{note}/{name}"), bytes);
        }
        Ok(())
    }
    fn whole_book(&mut self, side: Side, book: &str) -> Result<(), SyncError> {
        self.notebook(side, book)?;
        let notes = self
            .source(side)
            .keys()
            .filter_map(|id| {
                let parsed = key(id).ok()?;
                (parsed.book == book)
                    .then_some(parsed.note)
                    .flatten()
                    .map(str::to_owned)
            })
            .collect::<BTreeSet<_>>();
        for note in notes {
            self.note(side, book, &note)?;
        }
        Ok(())
    }
}

pub(super) fn apply(
    desired: &mut Snapshot,
    local: &Snapshot,
    remote: &Snapshot,
    requests: &[(Side, String, Option<String>)],
    locale: CopyLocale,
) -> Result<(usize, usize), SyncError> {
    let mut copier = Copier {
        desired,
        local,
        remote,
        books: BTreeMap::new(),
        notes: BTreeSet::new(),
        locale,
    };
    // Whole-notebook requests and note requests share a namespace and dedupe,
    // so two related conflicts can never overwrite each other's copies.
    for (side, book, note) in requests {
        match note {
            Some(note) => copier.note(*side, book, note)?,
            None => copier.whole_book(*side, book)?,
        }
    }
    crate::notes_sync::validate_snapshot(copier.desired)?;
    Ok((copier.notes.len(), copier.books.len()))
}
