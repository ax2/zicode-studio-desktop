use super::{
    crypto::digest,
    merge::merge,
    model::{validate_snapshot, ObjectRef},
    webdav::WebDav,
    Manifest, Snapshot, SyncError, SyncKey, SyncOutcome, MAX_INDEX_BYTES, MAX_OBJECT_BYTES,
    MAX_SNAPSHOT_BYTES,
};
use crate::notes_vault::{BaselineUpdate, NotesVault, Transfer};
use std::collections::BTreeMap;
use tokio::sync::OnceCell;
use tokio_util::sync::CancellationToken;

pub struct SyncRepository {
    dav: WebDav,
    vault_id: String,
    key: SyncKey,
    initialized: OnceCell<()>,
}

impl SyncRepository {
    /// Build a connection without sending requests. A saved-vault run consults
    /// its persisted retry deadline before establishing the WebDAV session.
    pub(crate) fn configured(
        endpoint: &str,
        username: String,
        password: String,
        vault_id: &str,
        key: SyncKey,
    ) -> Result<Self, SyncError> {
        Manifest::empty(vault_id)?;
        Ok(Self {
            dav: WebDav::new(endpoint, username, password, vault_id)?,
            vault_id: vault_id.to_owned(),
            key,
            initialized: OnceCell::new(),
        })
    }

    #[cfg(test)]
    pub async fn connect(
        endpoint: &str,
        username: String,
        password: String,
        vault_id: &str,
        key: SyncKey,
    ) -> Result<Self, SyncError> {
        let repository = Self::configured(endpoint, username, password, vault_id, key)?;
        repository.initialize().await?;
        Ok(repository)
    }

    async fn initialize(&self) -> Result<(), SyncError> {
        self.initialized
            .get_or_try_init(|| self.dav.initialize())
            .await?;
        Ok(())
    }

    #[cfg(test)]
    pub async fn synchronize(
        &self,
        base: &Manifest,
        local: &Snapshot,
    ) -> Result<SyncOutcome, SyncError> {
        self.synchronize_inner(base, local, None).await
    }

    /// Synchronize the saved projection of an explicitly selected workspace.
    /// Store encrypted upload objects before the first PUT; apply only after
    /// transport completes and the captured local revision still matches.
    pub(crate) async fn synchronize_saved(
        &self,
        vault: &NotesVault,
        cancel: &CancellationToken,
    ) -> Result<SyncOutcome, SyncError> {
        if cancel.is_cancelled() {
            return Err(SyncError::Cancelled);
        }
        let transfer = vault.lock_sync_transfer(&self.dav.scope())?;
        transfer.check_backoff()?;
        let local = vault.capture_sync().map_err(|_| SyncError::LocalStorage)?;
        let base = self.load_baseline(&transfer)?;
        transfer.retain_saved(&local.records)?;
        let run = async {
            self.initialize().await?;
            self.synchronize_inner(&base, &local.records, Some(&transfer))
                .await
        };
        let result = tokio::select! {
            biased;
            () = cancel.cancelled() => Err(SyncError::Cancelled),
            result = run => result,
        };
        let outcome = match result {
            Err(SyncError::RateLimited {
                retry_after_seconds,
            }) => {
                transfer.defer(retry_after_seconds)?;
                return Err(SyncError::RateLimited {
                    retry_after_seconds,
                });
            }
            other => other?,
        };
        if let SyncOutcome::Synced { manifest, snapshot } = &outcome {
            let applied = if *manifest == base {
                vault.apply_sync(&local.revision, snapshot)
            } else {
                let update = self.seal_baseline(&transfer, manifest)?;
                vault.apply_sync_baseline(&local.revision, snapshot, &update)
            };
            applied.map_err(|error| match error.code {
                "sync_local_changed" => SyncError::LocalChanged,
                _ => SyncError::LocalStorage,
            })?;
        }
        Ok(outcome)
    }

    fn load_baseline(&self, transfer: &Transfer) -> Result<Manifest, SyncError> {
        let Some(ciphertext) = transfer.baseline()? else {
            return Manifest::empty(&self.vault_id);
        };
        let bytes = self
            .key
            .open(&self.vault_id, &Self::baseline_kind(transfer), &ciphertext)?;
        let manifest: Manifest =
            serde_json::from_slice(&bytes).map_err(|_| SyncError::InvalidData)?;
        manifest.validate(&self.vault_id)?;
        Ok(manifest)
    }

    fn seal_baseline(
        &self,
        transfer: &Transfer,
        manifest: &Manifest,
    ) -> Result<BaselineUpdate, SyncError> {
        let bytes = serde_json::to_vec(manifest).map_err(|_| SyncError::InvalidData)?;
        if bytes.len() > MAX_INDEX_BYTES {
            return Err(SyncError::TooLarge);
        }
        let ciphertext = self
            .key
            .seal(&self.vault_id, &Self::baseline_kind(transfer), &bytes)?;
        Ok(BaselineUpdate::new(transfer, ciphertext))
    }

    fn baseline_kind(transfer: &Transfer) -> String {
        format!("baseline/{}", transfer.scope())
    }

    async fn synchronize_inner(
        &self,
        base: &Manifest,
        local: &Snapshot,
        transfer: Option<&Transfer>,
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
        validate_snapshot(&merged.snapshot)?;
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
                    let object_hash = self.upload_object(&content_hash, bytes, transfer).await?;
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

    async fn upload_object(
        &self,
        content_hash: &str,
        bytes: &[u8],
        transfer: Option<&Transfer>,
    ) -> Result<String, SyncError> {
        // Validate an existing spool file with the active key and exact saved bytes.
        // A wrong key or filesystem corruption never reaches the remote endpoint.
        if let Some(transfer) = transfer {
            if let Some(sealed) = transfer.get(content_hash)? {
                if self.key.open(&self.vault_id, "object", &sealed)? != bytes {
                    return Err(SyncError::InvalidData);
                }
                let object_hash = digest(&sealed);
                let path = format!("objects/{object_hash}");
                if let Some(existing) = self.dav.get(&path, sealed.len()).await? {
                    if existing.bytes != sealed {
                        return Err(SyncError::InvalidData);
                    }
                } else {
                    self.dav.create_object(&path, sealed).await?;
                }
                return Ok(object_hash);
            }
        }
        let sealed = self.key.seal(&self.vault_id, "object", bytes)?;
        let object_hash = digest(&sealed);
        if let Some(transfer) = transfer {
            transfer.put(content_hash, &sealed)?;
        }
        // Immutable content first. Interrupted upload cannot publish a dangling index.
        self.dav
            .create_object(&format!("objects/{object_hash}"), sealed)
            .await?;
        Ok(object_hash)
    }
}
