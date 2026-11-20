//! Encrypted WebDAV transport and saved-vault transfer. Calling the transfer
//! requires an explicit destination and key; no startup network activity.
mod crypto;
mod merge;
mod model;
pub(crate) mod repository;
mod resolution;
#[cfg(test)]
pub(crate) mod tests;
mod webdav;

pub use crypto::SyncKey;
pub(crate) use crypto::{digest, valid_digest};
pub use model::{Conflict, Manifest, Snapshot, SyncError, SyncOutcome};
#[cfg(test)]
pub use repository::SyncRepository;
pub(crate) use resolution::ConflictChoice;
pub(crate) use model::validate_snapshot;
pub use resolution::PendingMerge;

pub(super) const MAX_OBJECT_BYTES: usize = 8 * 1024 * 1024;
pub(super) const MAX_SNAPSHOT_BYTES: usize = 64 * 1024 * 1024;
pub(super) const MAX_INDEX_BYTES: usize = 2 * 1024 * 1024;
pub(super) const MAX_RECORDS: usize = 10_000;
