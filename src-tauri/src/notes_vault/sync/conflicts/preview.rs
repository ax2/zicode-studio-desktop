use super::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Version {
    pub exists: bool,
    pub deleted: bool,
    pub title: Option<String>,
    pub byte_length: usize,
    pub sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Detail {
    pub id: String,
    pub kind: String,
    pub notebook_title: String,
    pub allowed_choices: Vec<Choice>,
    pub local: Version,
    pub remote: Version,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct List {
    pub total: usize,
    pub next_cursor: Option<usize>,
    pub rows: Vec<Detail>,
}
fn version(kind: &str, bytes: Option<&[u8]>, full: bool) -> Result<Version, SyncError> {
    let mut result = Version {
        exists: bytes.is_some(),
        deleted: deleted(kind, bytes)?,
        title: None,
        byte_length: bytes.map_or(0, <[u8]>::len),
        sha256: bytes.map(crate::notes_sync::digest),
        text: None,
        properties: None,
    };
    let Some(bytes) = bytes else {
        return Ok(result);
    };
    match kind {
        "note" => {
            let saved: SavedNote = decode(bytes).map_err(failure)?;
            if saved.markdown.len() > MAX_NOTE_BYTES {
                return Err(SyncError::TooLarge);
            }
            let (frontmatter, body) = split_frontmatter(&saved.markdown).map_err(failure)?;
            let title = required_frontmatter_string(frontmatter, "title").map_err(failure)?;
            validate_title(&title).map_err(failure)?;
            result.title = Some(title);
            if full {
                result.text = Some(body.to_owned());
                result.properties = Some(frontmatter.to_owned());
            }
        }
        "book" => {
            let book: Book = decode(bytes).map_err(failure)?;
            records::validate_book(&book).map_err(failure)?;
            result.title = Some(book.title.clone());
            if full {
                result.text = Some(serde_json::to_string_pretty(&book).map_err(failure)?);
            }
        }
        "attachment" => {}
        _ => return Err(SyncError::InvalidData),
    }
    Ok(result)
}
fn row(
    pending: &PendingMerge,
    local: &Snapshot,
    id: &str,
    full: bool,
) -> Result<Detail, SyncError> {
    let conflict = pending
        .conflicts
        .iter()
        .find(|entry| entry.id == id)
        .ok_or(SyncError::InvalidData)?;
    let parsed = key(id)?;
    let book_key = format!("book/{}", parsed.book);
    let book = local
        .get(&book_key)
        .or_else(|| pending.remote_snapshot.get(&book_key))
        .ok_or(SyncError::InvalidData)?;
    let book: Book = decode(book).map_err(failure)?;
    records::validate_book(&book).map_err(failure)?;
    Ok(Detail {
        id: id.to_owned(),
        kind: parsed.kind.to_owned(),
        notebook_title: book.title,
        allowed_choices: allowed_choices(pending, id)?,
        local: version(parsed.kind, conflict.local.as_deref(), full)?,
        remote: version(parsed.kind, conflict.remote.as_deref(), full)?,
    })
}
pub(crate) fn list(
    pending: &PendingMerge,
    local: &Snapshot,
    cursor: usize,
) -> Result<List, SyncError> {
    if cursor > pending.conflicts.len() {
        return Err(SyncError::InvalidData);
    }
    let end = cursor.saturating_add(50).min(pending.conflicts.len());
    Ok(List {
        total: pending.conflicts.len(),
        next_cursor: (end < pending.conflicts.len()).then_some(end),
        rows: pending.conflicts[cursor..end]
            .iter()
            .map(|entry| row(pending, local, &entry.id, false))
            .collect::<Result<_, _>>()?,
    })
}
pub(crate) fn detail(
    pending: &PendingMerge,
    local: &Snapshot,
    id: &str,
) -> Result<Detail, SyncError> {
    row(pending, local, id, true)
}
