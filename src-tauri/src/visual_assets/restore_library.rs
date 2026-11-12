//! Install a verified snapshot into the default library while holding the library lock.
use super::{catalog, collections, snapshot, Result};
use rusqlite::{Connection, OpenFlags};
use std::{fs, io::ErrorKind, os::windows::fs::MetadataExt, path::Path};
use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

fn publication_paths(
    library: &Path,
    id: uuid::Uuid,
) -> Result<(std::path::PathBuf, std::path::PathBuf)> {
    let parent = library.parent().ok_or("missing library parent")?;
    Ok((
        parent.join(format!("pending-library-{id}")),
        parent.join(format!("previous-empty-library-{id}")),
    ))
}

/// Inspect the published catalog before any normal open can initialize or update it.
pub fn reconcile(library: &Path, id: uuid::Uuid, digest: &str) -> Result<bool> {
    let (staged, archive) = publication_paths(library, id)?;
    match fs::symlink_metadata(library) {
        Ok(metadata) => {
            if !metadata.is_dir()
                || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
                || staged.try_exists()?
            {
                return Ok(false);
            }
            Ok(
                snapshot::hash(&library.join("catalog.sqlite"))
                    .is_ok_and(|actual| actual == digest),
            )
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {
            if existing_empty(&archive)? {
                fs::rename(archive, library)?;
            }
            Ok(false)
        }
        Err(error) => Err(error.into()),
    }
}

fn existing_empty(library: &Path) -> Result<bool> {
    let metadata = match fs::symlink_metadata(library) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("invalid default library directory".into());
    }
    let mut found_catalog = false;
    for entry in fs::read_dir(library)? {
        let entry = entry?;
        let metadata = fs::symlink_metadata(entry.path())?;
        if entry.file_name() != "catalog.sqlite"
            || !metadata.is_file()
            || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        {
            return Err("default library contains files".into());
        }
        found_catalog = true;
    }
    if found_catalog {
        let db = Connection::open_with_flags(
            library.join("catalog.sqlite"),
            OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        db.execute_batch("PRAGMA trusted_schema=OFF;")?;
        if !catalog::has_managed_schema(&db)?
            || collections::has_records(&db)?
            || super::characters::has_records(&db)?
            || db.query_row(
                "SELECT EXISTS(SELECT 1 FROM asset) OR EXISTS(SELECT 1 FROM blob) OR EXISTS(SELECT 1 FROM revision)",
                [],
                |row| row.get::<_, bool>(0),
            )?
        {
            return Err("default library is not empty".into());
        }
    }
    Ok(true)
}

pub fn install(
    source: &Path,
    library: &Path,
    id: uuid::Uuid,
    thumbnail: impl FnMut(&Path, &Path) -> Result<()>,
    checkpoint: &impl Fn(&str) -> Result<()>,
    prepare_publication: &impl Fn(&str) -> Result<()>,
    observe_publication: &impl Fn(&str),
) -> Result<snapshot::Manifest> {
    existing_empty(library)?;
    let (staged, archive) = publication_paths(library, id)?;
    let manifest = snapshot::restore(source, &staged, thumbnail, &|phase| {
        checkpoint(match phase {
            "restore-ready" => "verified-library-ready",
            "restore-published" => "verified-library-staged",
            _ => phase,
        })
    })?;
    let archive_empty = existing_empty(library)?;
    prepare_publication(&manifest.catalog_sha256)?;
    observe_publication("default-restore-ready");
    if archive_empty {
        fs::rename(library, &archive)?;
    }
    observe_publication("default-restore-archived");
    if let Err(error) = fs::rename(staged, library) {
        if archive_empty && !library.try_exists()? {
            fs::rename(archive, library)?;
        }
        return Err(error.into());
    }
    observe_publication("default-restore-installed");
    Ok(manifest)
}
