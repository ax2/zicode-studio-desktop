use super::{crypto::digest, Conflict, Manifest, Snapshot, SyncError, MAX_RECORDS};
use std::collections::BTreeSet;

pub(super) struct Merge {
    pub snapshot: Snapshot,
    pub conflicts: Vec<Conflict>,
    pub ids: BTreeSet<String>,
}

pub(super) fn merge(
    base: &Manifest,
    local: &Snapshot,
    remote: &Snapshot,
    head: &Manifest,
) -> Result<Merge, SyncError> {
    if head.generation < base.generation
        || base.entries.keys().any(|id| !head.entries.contains_key(id))
        || (head.generation == base.generation && head != base)
    {
        return Err(SyncError::RemoteReset);
    }
    let ids: BTreeSet<String> = base
        .entries
        .keys()
        .chain(local.keys())
        .chain(head.entries.keys())
        .cloned()
        .collect();
    if ids.len() > MAX_RECORDS {
        return Err(SyncError::TooLarge);
    }
    let mut snapshot = Snapshot::new();
    let mut conflicts = Vec::new();
    for id in &ids {
        let original = base
            .entries
            .get(id)
            .and_then(Option::as_ref)
            .map(|r| r.content_hash.as_str());
        let local_bytes = local.get(id);
        let remote_bytes = remote.get(id);
        let local_hash = local_bytes.map(|v| digest(v));
        let remote_hash = remote_bytes.map(|v| digest(v));
        if !base.entries.contains_key(id)
            && head.entries.get(id) == Some(&None)
            && local_bytes.is_some()
        {
            conflicts.push(Conflict {
                id: id.clone(),
                local: local_bytes.cloned(),
                remote: None,
            });
            continue;
        }
        let selected = if local_hash == remote_hash || remote_hash.as_deref() == original {
            local_bytes
        } else if local_hash.as_deref() == original {
            remote_bytes
        } else {
            conflicts.push(Conflict {
                id: id.clone(),
                local: local_bytes.cloned(),
                remote: remote_bytes.cloned(),
            });
            continue;
        };
        if let Some(bytes) = selected {
            snapshot.insert(id.clone(), bytes.clone());
        }
    }
    Ok(Merge {
        snapshot,
        conflicts,
        ids,
    })
}
