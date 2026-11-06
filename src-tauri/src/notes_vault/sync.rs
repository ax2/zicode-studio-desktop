//! Saved Notes projection and recoverable local application, independent of
//! network transport. Only a workspace-scoped, locked vault can use it.
mod records;
mod snapshot;
mod storage;
#[cfg(test)]
mod tests;
mod transaction;

use super::*;
use crate::notes_sync::Snapshot as RecordMap;
use records::{Book, SavedNote};
use storage::Storage;

pub struct SyncCapture {
    pub records: RecordMap,
    pub revision: String,
}

pub(super) fn recover(root: &Path) -> Result<(), NotesError> {
    transaction::recover(&Storage::open(root)?)
}

fn invalid() -> NotesError {
    NotesError::new(
        "sync_invalid_data",
        "Saved Notes contain invalid or incomplete synchronization data",
    )
}

fn recovery_error() -> NotesError {
    NotesError::new(
        "sync_recovery_required",
        "Keep the Notes synchronization journal. Local recovery could not finish safely.",
    )
}

fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>, NotesError> {
    serde_json::to_vec(value).map_err(|_| invalid())
}

fn decode<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Result<T, NotesError> {
    serde_json::from_slice(bytes).map_err(|_| invalid())
}

const PARTS: [&str; 4] = [
    ".zicode/vault.json",
    "src/content/notes",
    ".trash",
    "public/attachments",
];
const OWNER: &str = ".zicode/sync-owner";
const JOURNALS: &str = ".sync-transactions";
const ARCHIVES: &str = ".sync-archives";
