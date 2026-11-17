//! Workspace-local staging for encrypted objects. The lease covers a single
//! explicit synchronization attempt and never starts background work.
use super::{recovery_error, storage::Identity, NotesError, Storage};
use crate::notes_sync::{
    digest, valid_digest, Snapshot, SyncError, MAX_INDEX_BYTES, MAX_OBJECT_BYTES,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs::File,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const CIPHERTEXT_LIMIT: usize = MAX_OBJECT_BYTES + 44;
const BASELINE_LIMIT: usize = MAX_INDEX_BYTES + 44;
const BASELINE_FILE: &str = "baseline.zns";
const TRANSFER_LEASE: &str = "transfer.lock";

pub(crate) struct Transfer {
    store: Storage,
    root: PathBuf,
    scope: String,
    _lease: File,
    lease_identity: Identity,
}

impl super::NotesVault {
    pub(crate) fn scope_for_sync(&self, workspace_id: &str) -> Result<Self, SyncError> {
        // Taking an unscoped storage handle prevents a caller-held edit lock
        // from surviving the network phase outside this operation's control.
        if self.storage_guard.is_some() || self.workspace_id.is_some() {
            return Err(SyncError::LocalStorage);
        }
        self.scoped(workspace_id).map_err(|error| match error.code {
            "notes_storage_busy" => SyncError::Busy,
            _ => SyncError::LocalStorage,
        })
    }

    pub(crate) fn lock_sync_transfer(&self, scope: &str) -> Result<Transfer, SyncError> {
        if self.storage_guard.is_none() || self.workspace_id.is_none() || !valid_digest(scope) {
            return Err(SyncError::LocalStorage);
        }
        Transfer::open(&self.vaults_dir(), scope)
    }
}

impl Transfer {
    fn open(vault: &Path, scope: &str) -> Result<Self, SyncError> {
        let store = Storage::open(vault).map_err(storage_error)?;
        let root = Path::new(".sync-transfers").join(scope);
        store.mkdir(&root).map_err(storage_error)?;
        let (lease, lease_identity) = store.open_sync_lease(&root.join(TRANSFER_LEASE))?;
        let transfer = Self {
            store,
            root,
            scope: scope.to_owned(),
            _lease: lease,
            lease_identity,
        };
        // An interrupted temporary write was never visible as an object or deadline.
        transfer.remove_if_present(&transfer.root.join("pending"), CIPHERTEXT_LIMIT)?;
        Ok(transfer)
    }

    pub(crate) fn check_vault(&self, vault: &super::NotesVault) -> Result<(), SyncError> {
        let path = vault.vaults_dir();
        if vault.storage_guard.is_none() || path != self.store.root {
            return Err(SyncError::LocalChanged);
        }
        let current = Storage::open(&path).map_err(storage_error)?;
        if current.directory_identity().map_err(storage_error)?
            != self.store.directory_identity().map_err(storage_error)?
            || current
                .sync_lease_identity(&self.root.join(TRANSFER_LEASE))
                .map_err(storage_error)?
                .as_ref()
                != Some(&self.lease_identity)
        {
            return Err(SyncError::LocalChanged);
        }
        Ok(())
    }

    pub(crate) fn scope(&self) -> &str {
        &self.scope
    }

    pub(crate) fn baseline(&self) -> Result<Option<Vec<u8>>, SyncError> {
        let path = self.root.join(BASELINE_FILE);
        if self.store.exists(&path).map_err(storage_error)? {
            return self
                .store
                .read(&path, BASELINE_LIMIT)
                .map(Some)
                .map_err(storage_error);
        }
        Ok(None)
    }

    pub(crate) fn check_backoff(&self) -> Result<(), SyncError> {
        let path = self.root.join("retry-at");
        if !self.store.exists(&path).map_err(storage_error)? {
            return Ok(());
        }
        let bytes = self.store.read(&path, 8).map_err(storage_error)?;
        let time = u64::from_le_bytes(bytes.try_into().map_err(|_| SyncError::LocalStorage)?);
        let remaining = time.saturating_sub(now()?);
        if remaining != 0 {
            return Err(SyncError::RateLimited {
                retry_after_seconds: remaining,
            });
        }
        self.store
            .remove_bounded_file(&path, 8)
            .map_err(storage_error)
    }

    pub(crate) fn defer(&self, seconds: u64) -> Result<(), SyncError> {
        let time = now()?.checked_add(seconds).ok_or(SyncError::LocalStorage)?;
        self.publish(&self.root.join("retry-at"), &time.to_le_bytes())
    }

    pub(crate) fn retain_saved(&self, saved: &Snapshot) -> Result<(), SyncError> {
        let objects = self.root.join("objects");
        let wanted: BTreeSet<String> = saved.values().map(|bytes| digest(bytes)).collect();
        if !self.store.exists(&objects).map_err(storage_error)? {
            return Ok(());
        }
        for name in self.store.list(&objects).map_err(storage_error)? {
            if !valid_digest(&name) {
                return Err(SyncError::LocalStorage);
            }
            if !wanted.contains(&name) {
                self.remove_if_present(&objects.join(name), CIPHERTEXT_LIMIT)?;
            }
        }
        Ok(())
    }

    pub(crate) fn get(&self, content_hash: &str) -> Result<Option<Vec<u8>>, SyncError> {
        let path = self.object(content_hash)?;
        if !self.store.exists(&path).map_err(storage_error)? {
            return Ok(None);
        }
        self.store
            .read(&path, CIPHERTEXT_LIMIT)
            .map(Some)
            .map_err(storage_error)
    }

    pub(crate) fn put(&self, content_hash: &str, sealed: &[u8]) -> Result<(), SyncError> {
        if !(44..=CIPHERTEXT_LIMIT).contains(&sealed.len()) {
            return Err(SyncError::InvalidData);
        }
        self.publish(&self.object(content_hash)?, sealed)
    }

    fn object(&self, digest: &str) -> Result<PathBuf, SyncError> {
        if !valid_digest(digest) {
            return Err(SyncError::InvalidData);
        }
        Ok(self.root.join("objects").join(digest))
    }

    fn publish(&self, destination: &Path, bytes: &[u8]) -> Result<(), SyncError> {
        let stage = self.root.join("pending");
        self.store.write_new(&stage, bytes).map_err(storage_error)?;
        self.store
            .rename(&stage, destination)
            .map_err(storage_error)
    }

    fn remove_if_present(&self, path: &Path, limit: usize) -> Result<(), SyncError> {
        if self.store.exists(path).map_err(storage_error)? {
            self.store
                .remove_bounded_file(path, limit)
                .map_err(storage_error)?;
        }
        Ok(())
    }
}

pub(crate) struct BaselineUpdate {
    scope: String,
    ciphertext: Vec<u8>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct BaselineReceipt {
    scope: String,
    hash: String,
}

impl BaselineUpdate {
    pub(crate) fn new(transfer: &Transfer, ciphertext: Vec<u8>) -> Self {
        Self {
            scope: transfer.scope.clone(),
            ciphertext,
        }
    }

    pub(super) fn stage(
        &self,
        store: &Storage,
        stage: &Path,
    ) -> Result<BaselineReceipt, NotesError> {
        if !(44..=BASELINE_LIMIT).contains(&self.ciphertext.len()) {
            return Err(recovery_error());
        }
        store.write_new(stage, &self.ciphertext)?;
        Ok(BaselineReceipt {
            scope: self.scope.clone(),
            hash: digest(&self.ciphertext),
        })
    }

    pub(super) fn settle_unchanged(&self, store: &Storage) -> Result<(), NotesError> {
        let staged = Path::new(".sync-transfers")
            .join(&self.scope)
            .join("pending");
        self.stage(store, &staged)?.promote(store, &staged)
    }
}

impl BaselineReceipt {
    pub(super) fn promote(&self, store: &Storage, staged: &Path) -> Result<(), NotesError> {
        if !valid_digest(&self.scope) || !valid_digest(&self.hash) {
            return Err(recovery_error());
        }
        let target = Path::new(".sync-transfers")
            .join(&self.scope)
            .join(BASELINE_FILE);
        // Replay after the atomic rename also validates the installed baseline.
        let source = if store.exists(staged)? {
            staged
        } else {
            &target
        };
        if digest(&store.read(source, BASELINE_LIMIT)?) != self.hash {
            return Err(recovery_error());
        }
        if source == staged {
            store.replace_bounded_file(staged, &target, BASELINE_LIMIT)?;
        }
        Ok(())
    }
}

fn now() -> Result<u64, SyncError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| SyncError::LocalStorage)
}

fn storage_error(_: super::NotesError) -> SyncError {
    SyncError::LocalStorage
}
