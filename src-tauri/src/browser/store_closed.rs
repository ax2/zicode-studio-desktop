//! A bounded, owner-local undo history stored in the same session transaction.
use super::{SavedTab, Session};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
pub(super) const LIMIT: usize = 50;
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClosedTab {
    pub tab: SavedTab,
    pub index: usize,
}
pub(super) fn transition(previous: Session, tabs: &[SavedTab]) -> Vec<ClosedTab> {
    let live: HashSet<_> = tabs.iter().map(|tab| tab.id.as_str()).collect();
    let mut closed: Vec<_> = previous
        .closed_tabs
        .into_iter()
        .filter(|entry| !live.contains(entry.tab.id.as_str()))
        .collect();
    for (index, tab) in previous.tabs.into_iter().enumerate() {
        if !live.contains(tab.id.as_str()) {
            closed.push(ClosedTab { tab, index });
        }
    }
    if closed.len() > LIMIT {
        closed.drain(..closed.len() - LIMIT);
    }
    closed
}
pub(super) fn validate(session: &Session) -> Result<(), String> {
    if session.closed_tabs.len() > LIMIT {
        return Err("Too many recently closed browser tabs".into());
    }
    let mut ids: HashSet<_> = session.tabs.iter().map(|tab| tab.id.as_str()).collect();
    for entry in &session.closed_tabs {
        super::validate(std::slice::from_ref(&entry.tab), Some(&entry.tab.id))?;
        if !ids.insert(entry.tab.id.as_str()) {
            return Err("Duplicate closed browser tab identity".into());
        }
    }
    Ok(())
}
