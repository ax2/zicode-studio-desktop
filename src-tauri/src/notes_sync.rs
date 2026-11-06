//! Encrypted WebDAV protocol. Not exposed to the app until the vault journal
//! and profile-scoped credentials are integrated; no startup network activity.
mod crypto;
mod merge;
mod model;
mod repository;
mod resolution;
#[cfg(test)]
pub(crate) mod tests;
mod webdav;

pub use crypto::SyncKey;
pub use model::{Conflict, Manifest, Snapshot, SyncError, SyncOutcome};
#[cfg(test)]
pub use repository::SyncRepository;
#[cfg(test)]
pub use resolution::ConflictChoice;
pub use resolution::PendingMerge;

pub(super) const MAX_OBJECT_BYTES: usize = 8 * 1024 * 1024;
pub(super) const MAX_SNAPSHOT_BYTES: usize = 64 * 1024 * 1024;
pub(super) const MAX_INDEX_BYTES: usize = 2 * 1024 * 1024;
pub(super) const MAX_RECORDS: usize = 10_000;
