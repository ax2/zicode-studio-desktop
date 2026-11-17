//! File identity stays in the Host and is checked before consent and before an explicit read.
use super::*;
use crate::plugin_worker::resource_input::Resource;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

pub(super) const MAX_BYTES: usize = 128 * 1024;
const SENDER: &str = "com.zicode.devtools.files";
const RECEIVER: &str = "com.zicode.devtools.encoding";
const INSPECT: &str = "devtools.encoding.inspect";

pub(super) fn is_source(owner: &Owner) -> bool {
    owner.plugin_id == SENDER
        && owner.capability_id == crate::plugin_resource_execution::file_digest::CAPABILITY
}

fn is_target(owner: &Owner) -> bool {
    owner.plugin_id == RECEIVER && owner.capability_id == INSPECT
}

pub(super) fn transfer_profile(original_file: bool) -> &'static str {
    if original_file {
        "resource.transfer.original-file.draft1"
    } else {
        "resource.transfer.draft1"
    }
}

pub(super) fn transfer_mime(original_file: bool, mime: &str) -> &str {
    if original_file {
        "application/octet-stream"
    } else {
        mime
    }
}

pub(super) struct TransferTarget {
    pub owner: Owner,
    pub mime: String,
    pub original: Option<Arc<OriginalFile>>,
}

pub(super) struct OriginalFile {
    root: PathBuf,
    relative: String,
    stamp: String,
}

pub(super) enum FileBinding {
    Source {
        file: Arc<OriginalFile>,
        verified: bool,
    },
    AwaitingRead(Arc<OriginalFile>),
}

impl OriginalFile {
    pub(super) fn new(root: PathBuf, relative: String, stamp: String) -> Self {
        Self {
            root,
            relative,
            stamp,
        }
    }

    pub(super) fn name(&self) -> String {
        self.relative
            .rsplit('/')
            .next()
            .unwrap_or_default()
            .chars()
            .filter(|ch| {
                !ch.is_control() && !matches!(ch, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
            })
            .collect()
    }

    fn verify_scope(&self, state: &HostState, owner: &Owner, proof: &str) -> Result<(), ApiError> {
        let (root, current) = local_file::scope(state, owner)?;
        if root != self.root || current != proof {
            return Err(rejected("resource_authorization_changed"));
        }
        Ok(())
    }

    pub(super) fn verify(
        &self,
        state: &HostState,
        owner: &Owner,
        proof: &str,
    ) -> Result<(), ApiError> {
        self.verify_scope(state, owner, proof)?;
        let file = local_file::files::open(&self.root, &self.relative)?;
        if local_file::files::stamp(&file)?.0 != self.stamp {
            return Err(rejected("resource_file_changed"));
        }
        self.verify_scope(state, owner, proof)
    }
}

pub(super) fn checked_source(
    original: Option<&FileBinding>,
    length: usize,
    source: &Owner,
    target: &Owner,
) -> Result<Arc<OriginalFile>, ApiError> {
    if !is_source(source) || !is_target(target) {
        return Err(rejected("resource_transfer_scope_invalid"));
    }
    if length > MAX_BYTES {
        return Err(rejected("resource_input_too_large"));
    }
    match original {
        Some(FileBinding::Source {
            file,
            verified: true,
        }) if !file.name().is_empty() => Ok(file.clone()),
        _ => Err(rejected("resource_file_reference_unavailable")),
    }
}

pub(super) fn snapshot_for_worker(
    state: &HostState,
    access: &Access,
    proof: &str,
    cancelled: &AtomicBool,
) -> Result<Resource, ApiError> {
    let (file, descriptor) = {
        let mut store = state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?;
        if !is_target(&access.owner) {
            return store.snapshot(access, proof);
        }
        let Some(reference) = store.file_reference_to_read(access, proof)? else {
            return store.snapshot(access, proof);
        };
        reference
    };
    if descriptor.byte_length > MAX_BYTES {
        return Err(rejected("resource_transfer_scope_invalid"));
    }
    if cancelled.load(Ordering::Acquire) {
        return Err(rejected("worker_cancelled"));
    }
    file.verify_scope(state, &access.owner, proof)?;
    let control = local_file::reading::Control::new(Instant::now() + Duration::from_secs(30));
    let bytes =
        local_file::files::snapshot_controlled(&file.root, &file.relative, &file.stamp, &control)?;
    if cancelled.load(Ordering::Acquire) {
        return Err(rejected("worker_cancelled"));
    }
    if bytes.len() != descriptor.byte_length || sha256_hex(&bytes) != access.content_version {
        return Err(rejected("resource_file_changed"));
    }
    file.verify(state, &access.owner, proof)?;
    authority::check_ancestors(state, access, proof)?;
    Ok(Resource { descriptor, bytes })
}
