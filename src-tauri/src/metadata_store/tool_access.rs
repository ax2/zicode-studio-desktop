//! Local UI metadata only. Atomic per-operation mutations preserve other windows' changes.
use super::MetadataStore;
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

const MAX_FAVORITES: usize = 512;
const MAX_RECENT: usize = 40;
const MAX_BYTES: usize = 256 * 1024;
const MAX_SAFE_REVISION: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecentEntry {
    pub id: String,
    pub used_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolAccess {
    pub schema_version: u32,
    pub revision: u64,
    pub favorites: Vec<String>,
    pub recent: Vec<RecentEntry>,
}

impl Default for ToolAccess {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            favorites: vec![],
            recent: vec![],
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Mutation {
    FavoriteSet { id: String, enabled: bool },
    RecentRecord { id: String },
    RecentClear,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 256 && id.trim() == id && !id.chars().any(char::is_control)
}

fn scope_key(scene: &str, workspace: &str) -> Result<String, String> {
    if !valid_id(scene) || !valid_id(workspace) {
        return Err("tool_access_invalid_scope".into());
    }
    Ok(format!(
        "tool-access.v1:{}",
        serde_json::to_string(&(scene, workspace)).map_err(|_| "tool_access_invalid_scope")?
    ))
}

fn decode(raw: Option<String>) -> Result<ToolAccess, String> {
    let Some(raw) = raw else {
        return Ok(ToolAccess::default());
    };
    if raw.len() > MAX_BYTES {
        return Err("tool_access_corrupt".into());
    }
    let state: ToolAccess = serde_json::from_str(&raw).map_err(|_| "tool_access_corrupt")?;
    let mut ids = std::collections::HashSet::new();
    if state.schema_version != 1
        || state.revision > MAX_SAFE_REVISION
        || state.favorites.len() > MAX_FAVORITES
        || state.recent.len() > MAX_RECENT
        || state
            .favorites
            .iter()
            .any(|id| !valid_id(id) || !ids.insert(id))
    {
        return Err("tool_access_corrupt".into());
    }
    ids.clear();
    if state.recent.iter().any(|entry| {
        !valid_id(&entry.id)
            || entry.used_at == 0
            || entry.used_at > MAX_SAFE_REVISION
            || !ids.insert(&entry.id)
    }) {
        return Err("tool_access_corrupt".into());
    }
    Ok(state)
}

fn read(connection: &rusqlite::Connection, key: &str) -> Result<ToolAccess, String> {
    let raw: Option<String> = connection.query_row(
        "SELECT CASE WHEN length(CAST(value_json AS BLOB)) <= ?2 THEN value_json ELSE NULL END FROM preferences WHERE key = ?1",
        params![key, MAX_BYTES], |row| row.get::<_, Option<String>>(0),
    ).optional().map_err(|_| "tool_access_storage_unavailable")?
        .map(|raw| raw.ok_or("tool_access_corrupt")).transpose()?;
    decode(raw)
}

impl MetadataStore {
    pub fn read_tool_access(&self, scene: &str, workspace: &str) -> Result<ToolAccess, String> {
        read(&self.connection, &scope_key(scene, workspace)?)
    }

    pub fn mutate_tool_access(
        &mut self,
        scene: &str,
        workspace: &str,
        mutation: Mutation,
    ) -> Result<ToolAccess, String> {
        let key = scope_key(scene, workspace)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "tool_access_storage_unavailable")?;
        let mut state = read(&transaction, &key)?;
        match mutation {
            Mutation::FavoriteSet { id, enabled } => {
                if !valid_id(&id) {
                    return Err("tool_access_invalid_id".into());
                }
                if enabled && !state.favorites.contains(&id) {
                    if state.favorites.len() >= MAX_FAVORITES {
                        return Err("tool_access_favorites_full".into());
                    }
                    state.favorites.push(id);
                } else if !enabled {
                    state.favorites.retain(|entry| entry != &id);
                }
            }
            Mutation::RecentRecord { id } => {
                if !valid_id(&id) {
                    return Err("tool_access_invalid_id".into());
                }
                let used_at = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|_| "tool_access_clock_unavailable")?
                    .as_millis() as u64;
                state.recent.retain(|entry| entry.id != id);
                state.recent.insert(0, RecentEntry { id, used_at });
                state.recent.truncate(MAX_RECENT);
            }
            Mutation::RecentClear => state.recent.clear(),
        }
        state.revision = state
            .revision
            .checked_add(1)
            .filter(|revision| *revision <= MAX_SAFE_REVISION)
            .ok_or("tool_access_revision_exhausted")?;
        let raw = serde_json::to_string(&state).map_err(|_| "tool_access_corrupt")?;
        transaction.execute("INSERT INTO preferences(key,value_json) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json", params![key, raw]).map_err(|_| "tool_access_storage_unavailable")?;
        transaction
            .commit()
            .map_err(|_| "tool_access_storage_unavailable")?;
        Ok(state)
    }
}

#[cfg(test)]
mod tests;
