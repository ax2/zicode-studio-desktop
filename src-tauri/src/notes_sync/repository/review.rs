use super::*;
use crate::notes_sync::PendingMerge;
use crate::notes_vault::conflicts::{self, Applied, Choice, CopyLocale, Detail, List};

struct Capture {
    vault: NotesVault,
    transfer: Transfer,
    records: Snapshot,
    revision: String,
}

impl SyncRepository {
    fn review_capture(
        &self,
        storage: &NotesVault,
        workspace: &str,
        pending: &PendingMerge,
    ) -> Result<Capture, SyncError> {
        let saved = pending.saved.as_ref().ok_or(SyncError::InvalidData)?;
        if saved.workspace_id != workspace {
            return Err(SyncError::LocalChanged);
        }
        let vault = storage.scope_for_sync(workspace)?;
        let transfer = vault.lock_sync_transfer(&self.dav.scope())?;
        transfer.check_binding(&saved.binding)?;
        if Self::manifest_digest(&self.load_baseline(&transfer)?)? != saved.baseline_digest {
            return Err(SyncError::LocalChanged);
        }
        let current = vault.capture_sync().map_err(|_| SyncError::LocalStorage)?;
        transfer.check_vault(&vault)?;
        if current.revision != saved.local_revision {
            return Err(SyncError::LocalChanged);
        }
        Ok(Capture {
            vault,
            transfer,
            records: current.records,
            revision: current.revision,
        })
    }

    /// Inspect only a captured, unchanged saved-vault conflict. No network.
    pub(crate) fn conflict_list(
        &self,
        storage: &NotesVault,
        workspace: &str,
        pending: &PendingMerge,
        cursor: usize,
    ) -> Result<List, SyncError> {
        let _current = self.lock_current()?;
        let current = self.review_capture(storage, workspace, pending)?;
        conflicts::list(pending, &current.records, cursor)
    }
    pub(crate) fn conflict_detail(
        &self,
        storage: &NotesVault,
        workspace: &str,
        pending: &PendingMerge,
        id: &str,
    ) -> Result<Detail, SyncError> {
        let _current = self.lock_current()?;
        let current = self.review_capture(storage, workspace, pending)?;
        conflicts::detail(pending, &current.records, id)
    }

    /// An explicit choice is committed locally together with the captured
    /// remote baseline. A later manual sync still merges any newer remote
    /// edits; resolving here never sends a request or blindly replaces cloud.
    pub(crate) fn apply_saved_choices(
        &self,
        storage: &NotesVault,
        workspace: &str,
        pending: &PendingMerge,
        choices: &BTreeMap<String, Choice>,
        locale: CopyLocale,
    ) -> Result<Applied, SyncError> {
        let _current = self.lock_current()?;
        let current = self.review_capture(storage, workspace, pending)?;
        let resolved = conflicts::resolve(pending, &current.records, choices, locale)?;
        current.transfer.check_vault(&current.vault)?;
        let baseline = self.seal_baseline(&current.transfer, &pending.head)?;
        current
            .vault
            .apply_sync_baseline(&current.revision, &resolved.records, &baseline)
            .map_err(|error| match error.code {
                "sync_local_changed" => SyncError::LocalChanged,
                _ => SyncError::LocalStorage,
            })?;
        Ok(Applied {
            state: "savedLocally",
            copied_notes: resolved.copied_notes,
            copied_notebooks: resolved.copied_notebooks,
            pending_upload: resolved.records != pending.remote_snapshot,
        })
    }
}
