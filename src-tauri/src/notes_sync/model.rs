use super::{crypto::valid_digest, MAX_OBJECT_BYTES, MAX_RECORDS, MAX_SNAPSHOT_BYTES};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub type Snapshot = BTreeMap<String, Vec<u8>>;

#[derive(Debug, PartialEq, Eq)]
pub enum SyncError {
    InvalidConfig,
    InvalidKey,
    InvalidData,
    TooLarge,
    Decryption,
    Network,
    Authentication,
    RateLimited { retry_after_seconds: u64 },
    RemoteChanged,
    RemoteReset,
    UnsupportedServer,
    Http(u16),
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ObjectRef {
    pub content_hash: String,
    pub object_hash: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub schema: u32,
    pub vault_id: String,
    pub generation: u64,
    // None is a retained tombstone. Never prune it just because a client is offline.
    pub(super) entries: BTreeMap<String, Option<ObjectRef>>,
}

impl Manifest {
    pub fn empty(vault_id: &str) -> Result<Self, SyncError> {
        let id = uuid::Uuid::parse_str(vault_id).map_err(|_| SyncError::InvalidConfig)?;
        if id.to_string() != vault_id {
            return Err(SyncError::InvalidConfig);
        }
        Ok(Self {
            schema: 1,
            vault_id: vault_id.to_owned(),
            generation: 0,
            entries: BTreeMap::new(),
        })
    }

    pub(super) fn validate(&self, vault_id: &str) -> Result<(), SyncError> {
        if self.schema != 1 || self.vault_id != vault_id || self.entries.len() > MAX_RECORDS {
            return Err(SyncError::InvalidData);
        }
        for (id, reference) in &self.entries {
            validate_id(id)?;
            if reference
                .as_ref()
                .is_some_and(|r| !valid_digest(&r.content_hash) || !valid_digest(&r.object_hash))
            {
                return Err(SyncError::InvalidData);
            }
        }
        Ok(())
    }
}

// Conflict payloads stay in the caller's memory, never in error messages/logs.
pub struct Conflict {
    pub id: String,
    pub local: Option<Vec<u8>>,
    pub remote: Option<Vec<u8>>,
}

pub enum SyncOutcome {
    Synced {
        manifest: Manifest,
        snapshot: Snapshot,
    },
    Conflicts(Box<super::PendingMerge>),
}

fn validate_id(id: &str) -> Result<(), SyncError> {
    if id.is_empty()
        || id.len() > 192
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.:/".contains(&b))
    {
        return Err(SyncError::InvalidData);
    }
    // Record identifiers are opaque JSON keys, never filesystem/URL paths.
    Ok(())
}

pub(super) fn validate_snapshot(snapshot: &Snapshot) -> Result<(), SyncError> {
    if snapshot.len() > MAX_RECORDS {
        return Err(SyncError::TooLarge);
    }
    let mut total = 0usize;
    for (id, bytes) in snapshot {
        validate_id(id)?;
        total = total.checked_add(bytes.len()).ok_or(SyncError::TooLarge)?;
        if bytes.len() > MAX_OBJECT_BYTES || total > MAX_SNAPSHOT_BYTES {
            return Err(SyncError::TooLarge);
        }
    }
    Ok(())
}
