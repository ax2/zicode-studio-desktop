//! Keep pin flags outside the legacy session JSON so older builds can still open it.
use super::{SavedTab, Session};
use rusqlite::{params, Connection};
use std::collections::HashSet;

pub(super) const LIMIT: usize = 4;

pub(super) fn restore(
    db: &Connection,
    owner: &str,
    session: &mut Session,
) -> Result<HashSet<String>, String> {
    let mut query = db
        .prepare("SELECT tab FROM browser_pinned_tabs WHERE owner=?1")
        .map_err(|err| err.to_string())?;
    let ids = query
        .query_map([owner], |row| row.get::<_, String>(0))
        .map_err(|err| err.to_string())?
        .collect::<Result<HashSet<_>, _>>()
        .map_err(|err| err.to_string())?;
    let mut available = LIMIT;
    for tab in &mut session.tabs {
        tab.pinned = available > 0 && ids.contains(&tab.id);
        if tab.pinned {
            available -= 1;
        }
    }
    for entry in &mut session.closed_tabs {
        entry.tab.pinned = ids.contains(&entry.tab.id);
    }
    Ok(ids)
}

pub(super) fn persist(
    db: &Connection,
    owner: &str,
    session: &Session,
    previous: &HashSet<String>,
) -> Result<String, String> {
    let current: HashSet<_> = session.tabs.iter()
        .chain(session.closed_tabs.iter().map(|entry| &entry.tab))
        .filter(|tab| tab.pinned)
        .map(|tab| tab.id.as_str())
        .collect();
    if current.len() != previous.len() || !previous.iter().all(|id| current.contains(id.as_str())) {
        db.execute("DELETE FROM browser_pinned_tabs WHERE owner=?1", [owner])
            .map_err(|err| err.to_string())?;
        let mut insert = db
            .prepare("INSERT INTO browser_pinned_tabs(owner,tab) VALUES(?1,?2)")
            .map_err(|err| err.to_string())?;
        for id in &current {
            insert.execute(params![owner, id]).map_err(|err| err.to_string())?;
        }
    }
    if current.is_empty() {
        return serde_json::to_string(session).map_err(|err| err.to_string());
    }
    let mut durable = session.clone();
    for tab in &mut durable.tabs {
        tab.pinned = false;
    }
    for entry in &mut durable.closed_tabs {
        entry.tab.pinned = false;
    }
    serde_json::to_string(&durable).map_err(|err| err.to_string())
}

pub(super) fn is_unpinned(pinned: &bool) -> bool {
    !pinned
}

pub(super) fn validate(tabs: &[SavedTab]) -> Result<(), String> {
    if tabs.iter().filter(|tab| tab.pinned).count() > LIMIT {
        return Err("Pin up to four tabs".into());
    }
    Ok(())
}
