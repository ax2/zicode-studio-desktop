//! File identity stays in the Host and is checked before consent and before an explicit read.
use super::*;
use crate::plugin_worker::resource_input::Resource;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::plugin_resource_execution::encoding;

pub(super) const MAX_BYTES: usize = encoding::MAX_BYTES;
const SENDER: &str = "com.zicode.devtools.files";
pub(super) fn target_max_bytes(target: &Owner, profile: Option<&str>) -> Result<usize, ApiError> {
    if target.plugin_id != encoding::PLUGIN {
        return Err(rejected("resource_transfer_scope_invalid"));
    }
    match (target.capability_id.as_str(), profile) {
        (encoding::CAPABILITY, None) => Ok(encoding::LEGACY_MAX_BYTES),
        (encoding::CAPABILITY, Some(encoding::PROFILE))
        | (encoding::MULTI_TARGET_CAPABILITY, Some(encoding::MULTI_TARGET_PROFILE)) => {
            Ok(encoding::MAX_BYTES)
        }
        _ => Err(rejected("resource_transfer_scope_invalid")),
    }
}

pub(super) fn is_source(owner: &Owner) -> bool {
    owner.plugin_id == SENDER
        && owner.capability_id == crate::plugin_resource_execution::file_digest::CAPABILITY
}

fn is_target(owner: &Owner) -> bool {
    owner.plugin_id == encoding::PLUGIN
        && matches!(
            owner.capability_id.as_str(),
            encoding::CAPABILITY | encoding::MULTI_TARGET_CAPABILITY
        )
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
    picked_directory: Option<PathBuf>,
}

pub(super) enum FileBinding {
    Source {
        file: Arc<OriginalFile>,
        verified: bool,
    },
    AwaitingRead(Arc<OriginalFile>),
}

impl OriginalFile {
    pub(super) fn new(
        root: PathBuf,
        relative: String,
        stamp: String,
        picked_directory: Option<PathBuf>,
    ) -> Self {
        Self {
            root,
            relative,
            stamp,
            picked_directory,
        }
    }

    pub(super) fn name(&self) -> &str {
        self.relative.rsplit('/').next().unwrap_or_default()
    }

    pub(super) fn display_name(&self) -> String {
        self.name()
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

    fn open(&self) -> Result<std::fs::File, ApiError> {
        match &self.picked_directory {
            Some(directory) => local_directory::open_picked_file(directory, &self.relative),
            None => local_file::files::open(&self.root, &self.relative),
        }
    }

    pub(super) fn read(&self, control: &local_file::reading::Control) -> Result<Vec<u8>, ApiError> {
        if self.picked_directory.is_none() {
            return local_file::files::snapshot_controlled(
                &self.root,
                &self.relative,
                &self.stamp,
                control,
            );
        }
        let bytes = local_file::files::snapshot_opened(self.open()?, &self.stamp, control)?;
        // Ensure the file at the selected path still names the same object after the read.
        self.verify_file()?;
        Ok(bytes)
    }

    fn verify_file(&self) -> Result<(), ApiError> {
        if local_file::files::stamp(&self.open()?)?.0 != self.stamp {
            return Err(rejected("resource_file_changed"));
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
        self.verify_file()?;
        self.verify_scope(state, owner, proof)
    }
}

pub(super) fn checked_source(
    original: Option<&FileBinding>,
    length: usize,
    source: &Owner,
    target: &Owner,
    limit: usize,
) -> Result<Arc<OriginalFile>, ApiError> {
    if !is_source(source) || !is_target(target) {
        return Err(rejected("resource_transfer_scope_invalid"));
    }
    if length > limit {
        return Err(rejected("resource_input_too_large"));
    }
    match original {
        Some(FileBinding::Source {
            file,
            verified: true,
        }) => Ok(file.clone()),
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
    let bytes = file.read(&control)?;
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
