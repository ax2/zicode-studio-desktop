//! Notes-aware conflict choices. Copy identities are notebook scoped, so note
//! Markdown and its attachment URLs can be preserved byte for byte.
mod copies;
mod preview;
use super::*;
use crate::notes_sync::{ConflictChoice, PendingMerge, Snapshot, SyncError};
pub(crate) use preview::{detail, list, Detail, List};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Choice {
    Local,
    Remote,
    Both,
}
#[derive(Clone, Copy, Deserialize, Serialize)]
pub(crate) enum CopyLocale {
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "en")]
    En,
}
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Side {
    Local,
    Remote,
}

pub(crate) struct Resolved {
    pub records: Snapshot,
    pub copied_notes: usize,
    pub copied_notebooks: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Applied {
    pub state: &'static str,
    pub copied_notes: usize,
    pub copied_notebooks: usize,
    pub pending_upload: bool,
}
fn failure<T>(_: T) -> SyncError {
    SyncError::InvalidData
}

struct Key<'a> {
    kind: &'a str,
    book: &'a str,
    note: Option<&'a str>,
}
fn key(id: &str) -> Result<Key<'_>, SyncError> {
    if id == order::KEY {
        return Ok(Key {
            kind: "order",
            book: "",
            note: None,
        });
    }
    let parts = id.split('/').collect::<Vec<_>>();
    if parts.len() < 2 {
        return Err(SyncError::InvalidData);
    }
    records::canonical_id(parts[1]).map_err(failure)?;
    match parts[0] {
        "book" if parts.len() == 2 => Ok(Key {
            kind: "book",
            book: parts[1],
            note: None,
        }),
        "note" if parts.len() == 3 => {
            records::canonical_id(parts[2]).map_err(failure)?;
            Ok(Key {
                kind: "note",
                book: parts[1],
                note: Some(parts[2]),
            })
        }
        "attachment" if parts.len() == 4 => {
            records::canonical_id(parts[2]).map_err(failure)?;
            validate_attachment_id(parts[3]).map_err(failure)?;
            Ok(Key {
                kind: "attachment",
                book: parts[1],
                note: Some(parts[2]),
            })
        }
        _ => Err(SyncError::InvalidData),
    }
}
fn deleted(kind: &str, bytes: Option<&[u8]>) -> Result<bool, SyncError> {
    let Some(bytes) = bytes else {
        return Ok(true);
    };
    match kind {
        "book" => Ok(decode::<Book>(bytes).map_err(failure)?.deleted),
        "note" => Ok(decode::<SavedNote>(bytes)
            .map_err(failure)?
            .deleted_at
            .is_some()),
        "attachment" | "order" => Ok(false),
        _ => Err(SyncError::InvalidData),
    }
}

fn allowed_choices(pending: &PendingMerge, id: &str) -> Result<Vec<Choice>, SyncError> {
    if id == order::KEY {
        return Ok(vec![Choice::Local, Choice::Remote]);
    }
    let parsed = key(id)?;
    let lifecycle = pending.conflicts.iter().any(|conflict| {
        let Ok(parent) = key(&conflict.id) else {
            return false;
        };
        parent.kind == "book"
            && parent.book == parsed.book
            && (conflict.local.is_none()
                || conflict.remote.is_none()
                || deleted("book", conflict.local.as_deref()).ok()
                    != deleted("book", conflict.remote.as_deref()).ok())
    });
    if lifecycle {
        return Ok(vec![Choice::Both]);
    }
    let conflict = pending
        .conflicts
        .iter()
        .find(|entry| entry.id == id)
        .ok_or(SyncError::InvalidData)?;
    let mut choices = vec![Choice::Local, Choice::Remote, Choice::Both];
    if parsed.kind == "note" {
        let book = pending.automatic_record(&format!("book/{}", parsed.book));
        let book_deleted = match book {
            Some(bytes) => decode::<Book>(bytes).map_err(failure)?.deleted,
            None => {
                let id = format!("book/{}", parsed.book);
                let candidate = pending.conflicts.iter().find(|entry| entry.id == id);
                match candidate {
                    Some(book) => {
                        deleted("book", book.local.as_deref())?
                            && deleted("book", book.remote.as_deref())?
                    }
                    None => true,
                }
            }
        };
        if book_deleted {
            let local_deleted = deleted("note", conflict.local.as_deref())?;
            let remote_deleted = deleted("note", conflict.remote.as_deref())?;
            choices.retain(|choice| match choice {
                Choice::Both => true,
                Choice::Local => local_deleted,
                Choice::Remote => remote_deleted,
            });
        }
    }
    Ok(choices)
}

pub(crate) fn resolve(
    pending: &PendingMerge,
    local: &Snapshot,
    choices: &BTreeMap<String, Choice>,
    locale: CopyLocale,
) -> Result<Resolved, SyncError> {
    if choices.len() != pending.conflicts.len() {
        return Err(SyncError::InvalidData);
    }
    let mut selected = BTreeMap::new();
    let mut book_lifecycle = BTreeMap::new();
    for conflict in &pending.conflicts {
        let parsed = key(&conflict.id)?;
        if parsed.kind != "book" {
            continue;
        }
        let choice = choices.get(&conflict.id).ok_or(SyncError::InvalidData)?;
        let local_deleted = deleted("book", conflict.local.as_deref())?;
        let remote_deleted = deleted("book", conflict.remote.as_deref())?;
        if local_deleted != remote_deleted || conflict.local.is_none() || conflict.remote.is_none()
        {
            if *choice != Choice::Both {
                return Err(SyncError::InvalidData);
            }
            let side = match choice {
                Choice::Local => Side::Local,
                Choice::Remote => Side::Remote,
                Choice::Both if conflict.remote.is_none() || (remote_deleted && !local_deleted) => {
                    Side::Remote
                }
                Choice::Both => Side::Local,
            };
            book_lifecycle.insert(parsed.book.to_owned(), side);
        }
    }
    let mut copies = Vec::new();
    for conflict in &pending.conflicts {
        let choice = choices.get(&conflict.id).ok_or(SyncError::InvalidData)?;
        let parsed = key(&conflict.id)?;
        if !allowed_choices(pending, &conflict.id)?.contains(choice) {
            return Err(SyncError::InvalidData);
        }
        let parent_choice = (parsed.kind != "book")
            .then(|| book_lifecycle.get(parsed.book))
            .flatten()
            .copied();
        if parent_choice.is_some() && *choice != Choice::Both {
            return Err(SyncError::InvalidData);
        }
        let core = match choice {
            Choice::Local => ConflictChoice::Local,
            Choice::Remote => ConflictChoice::Remote,
            Choice::Both => {
                let local_deleted = deleted(parsed.kind, conflict.local.as_deref())?;
                let remote_deleted = deleted(parsed.kind, conflict.remote.as_deref())?;
                // Preserve a deletion at its original identity, and recover the
                // edited version under a fresh notebook identity. Two live
                // versions keep local at the original and copy remote.
                let (primary, copy) = match parent_choice {
                    Some(Side::Local) => (ConflictChoice::Local, Side::Remote),
                    Some(Side::Remote) => (ConflictChoice::Remote, Side::Local),
                    None if conflict.remote.is_none() || (remote_deleted && !local_deleted) => {
                        (ConflictChoice::Remote, Side::Local)
                    }
                    None => (ConflictChoice::Local, Side::Remote),
                };
                if match copy {
                    Side::Local => conflict.local.is_some(),
                    Side::Remote => conflict.remote.is_some(),
                } {
                    copies.push((copy, parsed.book.to_owned(), parsed.note.map(str::to_owned)));
                }
                primary
            }
        };
        selected.insert(conflict.id.clone(), core);
    }
    let (_, mut resolved) = pending.resolve(&selected)?;
    // Deleting/restoring a notebook selects a complete valid lifecycle, not
    // an impossible mixture of a deleted notebook with active child files.
    // Contradictory child choices were rejected above; Both keeps the other
    // version in its separate recovery notebook.
    for (book, side) in book_lifecycle {
        resolved.retain(|id, _| key(id).map_or(true, |parsed| parsed.book != book));
        let source = match side {
            Side::Local => local,
            Side::Remote => &pending.remote_snapshot,
        };
        for (id, bytes) in source {
            if key(id)?.book == book {
                resolved.insert(id.clone(), bytes.clone());
            }
        }
    }
    // If an attachment's original note was removed by a non-conflicting
    // deletion, keep selected file versions accessible in recovery notes.
    // Merely retaining an orphan file would not be a usable resolution.
    for conflict in &pending.conflicts {
        let parsed = key(&conflict.id)?;
        if parsed.kind != "attachment" {
            continue;
        }
        let note = parsed.note.ok_or(SyncError::InvalidData)?;
        if resolved.contains_key(&format!("note/{}/{note}", parsed.book)) {
            continue;
        }
        let choice = choices.get(&conflict.id).ok_or(SyncError::InvalidData)?;
        for (side, exists) in [
            (Side::Local, conflict.local.is_some()),
            (Side::Remote, conflict.remote.is_some()),
        ] {
            if exists
                && (*choice == Choice::Both
                    || (*choice == Choice::Local && side == Side::Local)
                    || (*choice == Choice::Remote && side == Side::Remote))
            {
                copies.push((side, parsed.book.to_owned(), Some(note.to_owned())));
            }
        }
    }
    let stats = copies::apply(
        &mut resolved,
        local,
        &pending.remote_snapshot,
        &copies,
        locale,
    )?;
    Ok(Resolved {
        records: resolved,
        copied_notes: stats.0,
        copied_notebooks: stats.1,
    })
}
