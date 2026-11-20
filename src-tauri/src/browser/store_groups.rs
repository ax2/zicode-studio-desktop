use super::{SavedTab, Session};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TabGroup {
    pub id: String,
    pub name: String,
}

type Membership = HashMap<String, TabGroup>;

pub(super) fn create(db: &Connection) -> Result<(), String> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS browser_tab_groups (owner TEXT NOT NULL, tab TEXT NOT NULL, group_id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(owner,tab));").map_err(|e| e.to_string())
}

pub(super) fn validate(tabs: &[SavedTab]) -> Result<(), String> {
    let mut names = HashMap::new();
    for tab in tabs {
        let Some(group) = &tab.group else { continue };
        if tab.pinned
            || uuid::Uuid::parse_str(&group.id)
                .ok()
                .is_none_or(|id| id.to_string() != group.id)
            || group.name.trim() != group.name
            || group.name.is_empty()
            || group.name.chars().count() > 64
            || group.name.chars().any(char::is_control)
            || names
                .insert(&group.id, &group.name)
                .is_some_and(|name| name != &group.name)
        {
            return Err("Invalid browser tab group".into());
        }
    }
    Ok(())
}

pub(super) fn restore(
    db: &Connection,
    owner: &str,
    session: &mut Session,
) -> Result<Membership, String> {
    let mut query = db
        .prepare("SELECT tab,group_id,name FROM browser_tab_groups WHERE owner=?1")
        .map_err(|e| e.to_string())?;
    let saved = query
        .query_map([owner], |r| {
            Ok((
                r.get(0)?,
                TabGroup {
                    id: r.get(1)?,
                    name: r.get(2)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Membership, _>>()
        .map_err(|e| e.to_string())?;
    for tab in session
        .tabs
        .iter_mut()
        .chain(session.closed_tabs.iter_mut().map(|entry| &mut entry.tab))
    {
        if !tab.pinned {
            tab.group = saved.get(&tab.id).cloned();
        }
    }
    Ok(saved)
}

// Preserve group identity for recently closed tabs. Keeping membership outside
// the legacy session payload also lets older installations read the same session.
pub(super) fn persist(
    db: &Connection,
    owner: &str,
    session: &mut Session,
    previous: Membership,
) -> Result<Session, String> {
    let names: HashMap<_, _> = session
        .tabs
        .iter()
        .filter_map(|tab| tab.group.as_ref())
        .map(|g| (&g.id, &g.name))
        .collect();
    for entry in &mut session.closed_tabs {
        if let Some(group) = &mut entry.tab.group {
            if let Some(name) = names.get(&group.id) {
                group.name = (*name).clone();
            }
        }
    }
    let mut legacy = session.clone();
    let mut current = Membership::new();
    for tab in legacy
        .tabs
        .iter_mut()
        .chain(legacy.closed_tabs.iter_mut().map(|entry| &mut entry.tab))
    {
        if let Some(group) = tab.group.take() {
            current.insert(tab.id.clone(), group);
        }
    }
    if current != previous {
        db.execute("DELETE FROM browser_tab_groups WHERE owner=?1", [owner])
            .map_err(|e| e.to_string())?;
        let mut insert = db
            .prepare("INSERT INTO browser_tab_groups(owner,tab,group_id,name) VALUES(?1,?2,?3,?4)")
            .map_err(|e| e.to_string())?;
        for (tab, group) in current {
            insert
                .execute(params![owner, tab, group.id, group.name])
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(legacy)
}
