//! Workspace-owned bookmarks; website content has no access to this store.
use super::Store;
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Folder {
    pub id: String,
    pub title: String,
    pub parent_id: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bookmark {
    pub id: String,
    pub title: String,
    pub url: String,
    pub folder_id: Option<String>,
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
fn validate(library: &Library) -> Result<(), String> {
    let mut ids = HashSet::new();
    if library.folders.len() > 1000 {
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
        let url = reqwest::Url::parse(&bookmark.url).map_err(|_| "Invalid bookmark URL")?;
        if bookmark.url.len() > 16384
            || !matches!(url.scheme(), "https" | "http")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("Unsupported or credential-bearing bookmark URL".into());
        }
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
        let current = current
            .map(|(rev, payload)| decode(rev, &payload))
            .transpose()?
            .unwrap_or_default();
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
        let next = Library {
            revision,
            folders,
            bookmarks,
        };
        validate(&next)?;
        let payload = serde_json::to_string(&next).map_err(|e| e.to_string())?;
        if payload.len() > 4 * 1024 * 1024 {
            return Err("Bookmarks exceed storage limit".into());
        }
        tx.execute("INSERT INTO browser_bookmarks(owner,revision,payload) VALUES(?1,?2,?3) ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision,payload=excluded.payload",params![owner,revision,payload]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(next)
    }
}
#[cfg(test)]
#[path = "bookmarks_tests.rs"]
mod tests;
