use super::{
    crypto::digest,
    merge::merge,
    model::{validate_snapshot, ObjectRef},
    webdav::WebDav,
    Manifest, Snapshot, SyncError, SyncKey, SyncOutcome, MAX_INDEX_BYTES, MAX_OBJECT_BYTES,
    MAX_SNAPSHOT_BYTES,
};
use std::collections::BTreeMap;

pub struct SyncRepository {
    dav: WebDav,
    vault_id: String,
    key: SyncKey,
}

impl SyncRepository {
    pub async fn connect(
        endpoint: &str,
        username: String,
        password: String,
        vault_id: &str,
        key: SyncKey,
    ) -> Result<Self, SyncError> {
        Manifest::empty(vault_id)?;
        let dav = WebDav::connect(endpoint, username, password, vault_id).await?;
        Ok(Self {
            dav,
            vault_id: vault_id.to_owned(),
            key,
        })
    }

    /// The caller must journal and apply the returned snapshot with a checked
    /// local revision. This method never touches the live Notes vault or keys.
    pub async fn synchronize(
        &self,
        base: &Manifest,
        local: &Snapshot,
    ) -> Result<SyncOutcome, SyncError> {
        base.validate(&self.vault_id)?;
        validate_snapshot(local)?;
        let resource = self.dav.get("index.zns", MAX_INDEX_BYTES + 44).await?;
        let remote = match &resource {
            None if base.generation != 0 || !base.entries.is_empty() => {
                return Err(SyncError::RemoteReset)
            }
            None => Manifest::empty(&self.vault_id)?,
            Some(r) => {
                let bytes = self.key.open(&self.vault_id, "index", &r.bytes)?;
                let index: Manifest =
                    serde_json::from_slice(&bytes).map_err(|_| SyncError::InvalidData)?;
                index.validate(&self.vault_id)?;
                index
            }
        };
        let mut downloaded = Snapshot::new();
        let mut total = 0usize;
        let mut cache: BTreeMap<String, Vec<u8>> = BTreeMap::new();
        for (id, reference) in &remote.entries {
            let Some(reference) = reference else {
                continue;
            };
            let bytes = if let Some(bytes) = cache.get(&reference.object_hash) {
                bytes.clone()
            } else {
                let object = self
                    .dav
                    .get(
                        &format!("objects/{}", reference.object_hash),
                        MAX_OBJECT_BYTES + 44,
                    )
                    .await?
                    .ok_or(SyncError::InvalidData)?;
                if digest(&object.bytes) != reference.object_hash {
                    return Err(SyncError::InvalidData);
                }
                let bytes = self.key.open(&self.vault_id, "object", &object.bytes)?;
                cache.insert(reference.object_hash.clone(), bytes.clone());
                bytes
            };
            if digest(&bytes) != reference.content_hash {
                return Err(SyncError::InvalidData);
            }
            total = total.checked_add(bytes.len()).ok_or(SyncError::TooLarge)?;
            if total > MAX_SNAPSHOT_BYTES {
                return Err(SyncError::TooLarge);
            }
            downloaded.insert(id.clone(), bytes);
        }
        let merged = merge(base, local, &downloaded, &remote)?;
        if !merged.conflicts.is_empty() {
            return Ok(SyncOutcome::Conflicts(Box::new(super::PendingMerge {
                conflicts: merged.conflicts,
                automatic: merged.snapshot,
                head: remote,
            })));
        }
        let mut next = remote.clone();
        for id in merged.ids {
            match merged.snapshot.get(&id) {
                None => {
                    next.entries.insert(id, None);
                }
                Some(bytes) => {
                    let content_hash = digest(bytes);
                    if next
                        .entries
                        .get(&id)
                        .and_then(Option::as_ref)
                        .is_some_and(|r| r.content_hash == content_hash)
                    {
                        continue;
                    }
                    let sealed = self.key.seal(&self.vault_id, "object", bytes)?;
                    let object_hash = digest(&sealed);
                    // Immutable content first. Interrupted upload can never publish a dangling index.
                    self.dav
                        .create_object(&format!("objects/{object_hash}"), sealed)
                        .await?;
                    next.entries.insert(
                        id,
                        Some(ObjectRef {
                            content_hash,
                            object_hash,
                        }),
                    );
                }
            }
        }
        if next.entries != remote.entries {
            next.generation = remote
                .generation
                .checked_add(1)
                .ok_or(SyncError::InvalidData)?;
            let bytes = serde_json::to_vec(&next).map_err(|_| SyncError::InvalidData)?;
            if bytes.len() > MAX_INDEX_BYTES {
                return Err(SyncError::TooLarge);
            }
            let sealed = self.key.seal(&self.vault_id, "index", &bytes)?;
            self.dav
                .commit(sealed, resource.as_ref().map(|r| r.etag.as_str()))
                .await?;
        }
        Ok(SyncOutcome::Synced {
            manifest: next,
            snapshot: merged.snapshot,
        })
    }
}
