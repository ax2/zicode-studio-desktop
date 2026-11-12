use base64::Engine;
use rusqlite::Connection;
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::Path,
    time::{Duration, Instant},
};

const TTL: Duration = Duration::from_secs(60);
const MAX_HANDLES: usize = 256;
const MAX_BYTES: u64 = 512 * 1024;

#[cfg(windows)]
#[path = "preview_cache.rs"]
mod cache;

#[derive(Clone, PartialEq, Eq)]
pub struct Owner {
    pub window: String,
    pub workspace: String,
    pub route: String,
}

struct Grant {
    owner: Owner,
    library: String,
    asset: i64,
    revision: i64,
    digest: String,
    expires: Instant,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ticket {
    pub(super) handle: String,
    expires_in_seconds: u64,
    specification: &'static str,
}

#[derive(Default)]
pub struct Previews {
    grants: HashMap<String, Grant>,
    #[cfg(windows)]
    reference_thumbnails: cache::Thumbnails,
}

fn revision_digest(
    db: &Connection,
    library: &str,
    asset: i64,
    revision: i64,
) -> Result<String, String> {
    let digest: String = db
        .query_row(
            "SELECT digest FROM revision WHERE asset=?1 AND version=?2
         AND EXISTS(SELECT 1 FROM library WHERE id=?3)",
            rusqlite::params![asset, revision, library],
            |row| row.get(0),
        )
        .map_err(|_| "visual_assets_revision_unavailable")?;
    if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("visual_assets_revision_invalid".into());
    }
    Ok(digest)
}

impl Previews {
    pub fn issue(
        &mut self,
        db: &Connection,
        owner: Owner,
        library: &str,
        asset: i64,
        revision: i64,
    ) -> Result<Ticket, String> {
        let now = Instant::now();
        self.grants.retain(|_, grant| grant.expires > now);
        if self.grants.len() >= MAX_HANDLES {
            return Err("visual_assets_preview_capacity".into());
        }
        let digest = revision_digest(db, library, asset, revision)?;
        let handle = uuid::Uuid::new_v4().to_string();
        self.grants.insert(
            handle.clone(),
            Grant {
                owner,
                library: library.into(),
                asset,
                revision,
                digest,
                expires: now + TTL,
            },
        );
        Ok(Ticket {
            handle,
            expires_in_seconds: TTL.as_secs(),
            specification: "thumbnail-256-png-v1",
        })
    }

    pub fn read(
        &mut self,
        db: &Connection,
        root: &Path,
        owner: &Owner,
        handle: &str,
    ) -> Result<String, String> {
        let grant = self
            .grants
            .get(handle)
            .ok_or("visual_assets_preview_unavailable")?;
        if grant.owner != *owner {
            return Err("visual_assets_preview_owner_mismatch".into());
        }
        // A valid owner consumes the ticket even if the file is missing or expired.
        let grant = self
            .grants
            .remove(handle)
            .ok_or("visual_assets_preview_unavailable")?;
        if grant.expires <= Instant::now() {
            return Err("visual_assets_preview_expired".into());
        }
        if revision_digest(db, &grant.library, grant.asset, grant.revision)? != grant.digest {
            return Err("visual_assets_revision_changed".into());
        }
        #[cfg(windows)]
        if !super::reference_catalog::managed_filter(db)
            .map_err(|_| "visual_assets_preview_unavailable")?
            .is_empty()
            && super::reference_catalog::is_reference(db, grant.asset, grant.revision)
                .map_err(|_| "visual_assets_preview_unavailable")?
            && !super::reference_catalog::is_archived(db, grant.asset, grant.revision)
                .map_err(|_| "visual_assets_preview_unavailable")?
        {
            let profile = root.parent().ok_or("reference_source_unavailable")?;
            let (bytes, _) =
                super::reference_import::read(db, profile, grant.asset, grant.revision)
                    .map_err(super::reference_import::public_error)?;
            return self.reference_thumbnails.get_or_generate(
                &grant.library,
                &grant.digest,
                || {
                    super::reference_import::with_thumbnail(root, &bytes, &|_| {}, |path| {
                        read_thumbnail(path).map_err(Into::into)
                    })
                    .map_err(super::reference_import::public_error)
                },
            );
        }
        read_thumbnail(&root.join(format!("{}.png", grant.digest)))
    }
}

pub(super) fn read_thumbnail(path: &Path) -> Result<String, String> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options
        .open(path)
        .map_err(|_| "visual_assets_preview_missing")?;
    let metadata = file
        .metadata()
        .map_err(|_| "visual_assets_preview_unavailable")?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes()
            & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
            != 0
        {
            return Err("visual_assets_preview_invalid".into());
        }
    }
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err("visual_assets_preview_invalid".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "visual_assets_preview_unavailable")?;
    if bytes.len() as u64 > MAX_BYTES
        || bytes.len() < 33
        || !bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || &bytes[8..16] != b"\x00\x00\x00\x0dIHDR"
    {
        return Err("visual_assets_preview_invalid".into());
    }
    let width = u32::from_be_bytes(
        bytes[16..20]
            .try_into()
            .map_err(|_| "visual_assets_preview_invalid")?,
    );
    let height = u32::from_be_bytes(
        bytes[20..24]
            .try_into()
            .map_err(|_| "visual_assets_preview_invalid")?,
    );
    if !(1..=256).contains(&width) || !(1..=256).contains(&height) {
        return Err("visual_assets_preview_invalid".into());
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[cfg(test)]
#[path = "preview_tests.rs"]
mod tests;
