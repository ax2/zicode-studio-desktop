//! The OS releases this lock when a dispatch process exits. Its file identity
//! stays local to the live library, so a restored backup cannot prove that an
//! attempt in the source library stopped before submission.
use super::{reference_source, Result};
use fs2::FileExt;
use rusqlite::Connection;
use std::{
    fs::{File, OpenOptions},
    os::windows::fs::{MetadataExt, OpenOptionsExt},
    path::Path,
};
use windows_sys::Win32::Storage::FileSystem::{
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ, FILE_SHARE_WRITE,
};

pub(super) struct Lease {
    _file: File,
    pub(super) identity: Option<String>,
}

impl Lease {
    pub(super) fn try_acquire(library: &Path) -> Result<Option<Self>> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .open(library.join("generation-dispatch.lock"))?;
        let metadata = file.metadata()?;
        if !metadata.is_file()
            || metadata.len() != 0
            || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        {
            return Err("visual_assets_comfy_dispatch_unavailable".into());
        }
        match file.try_lock_exclusive() {
            Ok(()) => {
                let identity = reference_source::identity(&file, &metadata)
                    .ok()
                    .filter(reference_source::Identity::has_file_id)
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()?;
                Ok(Some(Self {
                    _file: file,
                    identity,
                }))
            }
            Err(error) if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() => {
                Ok(None)
            }
            Err(error) => Err(error.into()),
        }
    }

    pub(super) fn recover(&self, db: &Connection) -> Result<()> {
        db.execute(
            "UPDATE generation_attempt
             SET state=CASE WHEN json_extract(intent,'$.preSubmitLease')=?1 THEN 'upload_failed' ELSE 'unknown' END,
                 intent=CASE WHEN json_extract(intent,'$.preSubmitLease')=?1
                             THEN json_set(intent,'$.interruptedBeforeSubmit',1) ELSE intent END,
                 sequence=sequence+1
             WHERE state='submitting'",
            [&self.identity],
        )?;
        Ok(())
    }
}

pub(super) fn recover_if_idle(db: &Connection, library: &Path) -> Result<()> {
    let preparing = db
        .prepare("SELECT 1 FROM generation_attempt WHERE state='submitting' LIMIT 1")?
        .exists([])?;
    if !preparing {
        return Ok(());
    }
    if let Some(lease) = Lease::try_acquire(library)? {
        lease.recover(db)?;
    }
    Ok(())
}
