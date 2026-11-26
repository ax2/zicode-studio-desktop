//! Workspace-owned bookmarks; website content has no access to this store.
use super::Store;
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub(crate) const MAX_FOLDERS: usize = 1000;
pub(crate) const MAX_PAYLOAD_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Folder {
    pub id: String,
    pub title: String,
    pub parent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<u32>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bookmark {
    pub id: String,
    pub title: String,
    pub url: String,
    pub folder_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<u32>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub shortcut: bool,
}
#[derive(Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Library {
    pub revision: i64,
    pub folders: Vec<Folder>,
    pub bookmarks: Vec<Bookmark>,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    List,
    Save {
        #[serde(rename = "expectedRevision")]
        expected_revision: i64,
        folders: Vec<Folder>,
        bookmarks: Vec<Bookmark>,
    },
}
pub(crate) fn validate_url(value: &str) -> Result<(), &'static str> {
    let url = reqwest::Url::parse(value).map_err(|_| "Invalid bookmark URL")?;
    if value.len() > 16384
        || !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Unsupported or credential-bearing bookmark URL");
    }
    Ok(())
}

fn validate(library: &Library) -> Result<(), String> {
    let mut ids = HashSet::new();
    if library.folders.len() > MAX_FOLDERS {
        return Err("Too many bookmark folders".into());
    }
    for (id, title, limit) in library
        .folders
        .iter()
        .map(|f| (&f.id, &f.title, 256))
        .chain(library.bookmarks.iter().map(|b| (&b.id, &b.title, 4096)))
    {
        if uuid::Uuid::parse_str(id).is_err()
            || !ids.insert(id.as_str())
            || title.trim().is_empty()
            || title.len() > limit
        {
            return Err("Invalid bookmark identity or title".into());
        }
    }
    let parents: HashMap<_, _> = library
        .folders
        .iter()
        .map(|f| (f.id.as_str(), f.parent_id.as_deref()))
        .collect();
    for folder in &library.folders {
        let mut seen = HashSet::new();
        let mut cursor = Some(folder.id.as_str());
        while let Some(id) = cursor {
            if !seen.insert(id) {
                return Err("Bookmark folders cannot contain a cycle".into());
            }
            cursor = *parents
                .get(id)
                .ok_or("Bookmark parent folder is unavailable")?;
        }
    }
    for bookmark in &library.bookmarks {
        if bookmark
            .folder_id
            .as_deref()
            .is_some_and(|id| !parents.contains_key(id))
        {
            return Err("Bookmark folder is unavailable".into());
        }
        validate_url(&bookmark.url)?;
    }
    Ok(())
}
fn decode(revision: i64, payload: &str) -> Result<Library, String> {
    let library: Library = serde_json::from_str(payload)
        .map_err(|_| "Bookmark data is damaged; existing data retained")?;
    if revision != library.revision {
        return Err("Bookmark revision mismatch".into());
    }
    validate(&library)?;
    Ok(library)
}
// Keep the workspace IPC position separate from the legacy bookmark JSON on disk.
#[derive(Serialize, Deserialize)]
struct Placement {
    id: String,
    parent: Option<String>,
}

fn entries(library: &mut Library) -> impl Iterator<Item = (&str, Option<&str>, &mut Option<u32>)> {
    library
        .folders
        .iter_mut()
        .map(|folder| {
            (
                folder.id.as_str(),
                folder.parent_id.as_deref(),
                &mut folder.position,
            )
        })
        .chain(library.bookmarks.iter_mut().map(|link| {
            (
                link.id.as_str(),
                link.folder_id.as_deref(),
                &mut link.position,
            )
        }))
}

fn take_order(library: &mut Library) -> Option<Vec<Placement>> {
    let mut positioned = entries(library)
        .map(|(id, parent, position)| (id, parent, position.take()))
        .collect::<Vec<_>>();
    if positioned.iter().all(|(_, _, position)| position.is_none()) {
        return None;
    }
    positioned.sort_by_key(|(_, _, position)| *position);
    Some(
        positioned
            .into_iter()
            .map(|(id, parent, _)| Placement {
                id: id.to_owned(),
                parent: parent.map(str::to_owned),
            })
            .collect(),
    )
}

fn apply_order(library: &mut Library, order: &[Placement]) {
    let placements: HashMap<_, _> = order
        .iter()
        .enumerate()
        .map(|(position, entry)| {
            (
                entry.id.as_str(),
                (entry.parent.as_deref(), position as u32),
            )
        })
        .collect();
    let mut tail = order.len() as u32;
    for (id, parent, position) in entries(library) {
        *position = Some(match placements.get(id) {
            Some(&(saved_parent, index)) if saved_parent == parent => index,
            // Older builds can add or move entries. Append them after retained siblings.
            _ => {
                let index = tail;
                tail += 1;
                index
            }
        });
    }
}

impl Store {
    pub fn bookmarks(&mut self, owner: &str, request: Request) -> Result<Library, String> {
        let tx = self
            .0
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let current: Option<(i64, String)> = tx
            .query_row(
                "SELECT revision,payload FROM browser_bookmarks WHERE owner=?1",
                [owner],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let mut current = current
            .map(|(rev, payload)| decode(rev, &payload))
            .transpose()?
            .unwrap_or_default();
        if let Some(order) = tx
            .query_row(
                "SELECT payload FROM browser_bookmark_order WHERE owner=?1",
                [owner],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|err| err.to_string())?
            .and_then(|payload| serde_json::from_str::<Vec<Placement>>(&payload).ok())
        {
            apply_order(&mut current, &order);
        }
        let Request::Save {
            expected_revision,
            folders,
            bookmarks,
        } = request
        else {
            return Ok(current);
        };
        if current.revision != expected_revision {
            return Err("Bookmarks changed; reload before saving".into());
        }
        let revision = expected_revision
            .checked_add(1)
            .filter(|_| expected_revision >= 0)
            .ok_or("Invalid bookmark revision")?;
        let mut next = Library {
            revision,
            folders,
            bookmarks,
        };
        validate(&next)?;
        let order = take_order(&mut next);
        let payload = serde_json::to_string(&next).map_err(|e| e.to_string())?;
        if payload.len() > MAX_PAYLOAD_BYTES {
            return Err("Bookmarks exceed storage limit".into());
        }
        tx.execute("INSERT INTO browser_bookmarks(owner,revision,payload) VALUES(?1,?2,?3) ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision,payload=excluded.payload",params![owner,revision,payload]).map_err(|e|e.to_string())?;
        if let Some(order) = order {
            let payload = serde_json::to_string(&order).map_err(|err| err.to_string())?;
            tx.execute("INSERT INTO browser_bookmark_order(owner,payload) VALUES(?1,?2) ON CONFLICT(owner) DO UPDATE SET payload=excluded.payload",
                params![owner, payload]).map_err(|err| err.to_string())?;
            apply_order(&mut next, &order);
        } else {
            tx.execute("DELETE FROM browser_bookmark_order WHERE owner=?1", [owner])
                .map_err(|err| err.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(next)
    }
}
#[cfg(test)]
#[path = "bookmarks_tests.rs"]
mod tests;
