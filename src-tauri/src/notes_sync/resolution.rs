use super::{model::validate_snapshot, Manifest, Snapshot, SyncError};
use std::collections::BTreeMap;

#[derive(Clone, Copy)]
pub enum ConflictChoice {
    Local,
    Remote,
}

pub struct PendingMerge {
    pub conflicts: Vec<super::Conflict>,
    pub(super) automatic: Snapshot,
    pub(super) head: Manifest,
}

impl PendingMerge {
    /// Every conflict needs an explicit decision. The caller may edit the
    /// resolved snapshot before another synchronize; a newly changed remote
    /// still goes through normal three-way merge and conditional commit.
    pub fn resolve(
        &self,
        choices: &BTreeMap<String, ConflictChoice>,
    ) -> Result<(Manifest, Snapshot), SyncError> {
        if choices.len() != self.conflicts.len()
            || self.conflicts.iter().any(|c| !choices.contains_key(&c.id))
        {
            return Err(SyncError::InvalidData);
        }
        let mut snapshot = self.automatic.clone();
        for conflict in &self.conflicts {
            let bytes = match choices.get(&conflict.id).ok_or(SyncError::InvalidData)? {
                ConflictChoice::Local => &conflict.local,
                ConflictChoice::Remote => &conflict.remote,
            };
            match bytes {
                Some(bytes) => {
                    snapshot.insert(conflict.id.clone(), bytes.clone());
                }
                None => {
                    snapshot.remove(&conflict.id);
                }
            }
        }
        validate_snapshot(&snapshot)?;
        Ok((self.head.clone(), snapshot))
    }
}
