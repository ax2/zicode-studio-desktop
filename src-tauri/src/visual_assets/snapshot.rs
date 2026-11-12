//! P0 snapshot protocol. Publication is a directory rename; partial work is retained.
//! A reserved SQLite writer lock pins every referenced Blob for the entire backup.
use super::{reference_catalog, worker, Result};
use rusqlite::{Connection, OpenFlags, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::windows::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};
use windows_sys::Win32::Storage::FileSystem::{
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
};

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    version: u32,
    library_id: String,
    pub(super) catalog_sha256: String,
    blob_count: u64,
    asset_count: u64,
}

fn read_file(path: &Path) -> Result<File> {
    let file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("snapshot requires regular files".into());
    }
    Ok(file)
}

pub(super) fn hash(path: &Path) -> Result<String> {
    hash_file(&mut read_file(path)?)
}

fn hash_file(file: &mut File) -> Result<String> {
    let mut digest = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            return Ok(format!("{:x}", digest.finalize()));
        }
        digest.update(&buffer[..count]);
    }
}

fn copy(source: &Path, target: &Path) -> Result<()> {
    let mut input = read_file(source)?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)?;
    std::io::copy(&mut input, &mut output)?;
    output.sync_all()?;
    Ok(())
}

pub(super) fn read_catalog(path: &Path) -> Result<Connection> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    db.execute_batch("PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON;")?;
    let version: u32 = db.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version != 1 || !super::catalog::has_managed_schema(&db)? {
        return Err("invalid snapshot schema".into());
    }
    let integrity: String = db.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    let foreign_key_errors = db.prepare("PRAGMA foreign_key_check")?.exists([])?;
    let libraries: u64 = db.query_row("SELECT count(*) FROM library", [], |row| row.get(0))?;
    if integrity != "ok" || foreign_key_errors || libraries != 1 {
        return Err("invalid snapshot catalog".into());
    }
    Ok(db)
}

fn inventory(db: &Connection, catalog_sha256: String) -> Result<Manifest> {
    let reference_version = reference_catalog::snapshot_version(db)?;
    let version = if super::characters::schema_present(db)? {
        super::characters::validate_snapshot(db)?;
        if super::generation_recipes::schema_present(db)? {
            super::generation_recipes::validate_snapshot(db)?;
            if super::generation_attempts::schema_present(db)? {
                super::generation_attempts::validate_snapshot(db)?;
                if super::generation_outputs::schema_present(db)? {
                    super::generation_outputs::validate_snapshot(db)?;
                    7
                } else {
                    6
                }
            } else {
                5
            }
        } else {
            4
        }
    } else {
        reference_version
    };
    let version = if super::novel_drafts::schema_present(db)? {
        super::novel_drafts::validate_snapshot(db)?;
        8
    } else {
        version
    };
    let version = if super::novel_model_archive::schema_present(db)? {
        super::novel_model_archive::validate_snapshot(db)?;
        9
    } else {
        version
    };
    Ok(Manifest {
        version,
        library_id: db.query_row("SELECT id FROM library", [], |row| row.get(0))?,
        catalog_sha256,
        blob_count: db.query_row(
            &format!(
                "SELECT count(*) FROM blob{}",
                reference_catalog::managed_filter(db)?
            ),
            [],
            |row| row.get(0),
        )?,
        asset_count: db.query_row("SELECT count(*) FROM asset", [], |row| row.get(0))?,
    })
}

fn visit_originals(
    db: &Connection,
    source: &Path,
    checkpoint: &impl Fn(&str) -> Result<()>,
    visit: impl Fn(&str, &[u8]) -> Result<()>,
) -> Result<()> {
    let mut statement = db.prepare(&format!(
        "SELECT digest, bytes FROM blob{} ORDER BY digest",
        reference_catalog::managed_filter(db)?
    ))?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        checkpoint("copying-originals")?;
        let digest: String = row.get(0)?;
        let bytes: u64 = row.get(1)?;
        if digest.len() != 64
            || !digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || bytes > 24 * 1024 * 1024
        {
            return Err("invalid snapshot blob metadata".into());
        }
        // The bounded read rejects reparse points and oversized images before copying.
        let data = worker::read_input(&source.join(format!("{digest}.blob")))?;
        if data.len() as u64 != bytes || format!("{:x}", Sha256::digest(&data)) != digest {
            return Err("snapshot original failed integrity check".into());
        }
        visit(&digest, &data)?;
    }
    Ok(())
}

fn copy_blobs(
    db: &Connection,
    source: &Path,
    target: &Path,
    checkpoint: &impl Fn(&str) -> Result<()>,
) -> Result<()> {
    visit_originals(db, source, checkpoint, |digest, data| {
        write_original(&target.join(format!("{digest}.blob")), digest, data)
    })
}

pub(super) fn write_original(path: &Path, digest: &str, data: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(data)?;
    file.sync_all()?;
    drop(file);
    if hash(path)? != digest {
        return Err("copied original failed integrity check".into());
    }
    Ok(())
}

pub fn create(
    db: &mut Connection,
    library: &Path,
    destination: &Path,
    reference_profile: Option<&Path>,
    checkpoint: &impl Fn(&str) -> Result<()>,
    prepare_publication: &impl Fn(&str) -> Result<()>,
) -> Result<PathBuf> {
    if !destination.is_absolute() || fs::read_dir(destination)?.next().is_some() {
        return Err("backup requires an empty absolute destination directory".into());
    }
    let destination = fs::canonicalize(destination)?;
    let library = fs::canonicalize(library)?;
    if destination.starts_with(&library) || library.starts_with(&destination) {
        return Err("backup must be outside the active library".into());
    }
    // All managed writes/reclamation must acquire this same database writer lock.
    // A second connection can read the committed state while the pin is held.
    let pin = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let stage = destination.join("pending-snapshot");
    fs::create_dir(&stage)?;
    let catalog = stage.join("catalog.sqlite");
    let reader = read_catalog(&library.join("catalog.sqlite"))?;
    reader.execute(
        "VACUUM INTO ?1",
        [catalog.to_str().ok_or("invalid snapshot path")?],
    )?;
    drop(reader);
    OpenOptions::new().write(true).open(&catalog)?.sync_all()?;
    checkpoint("snapshot-catalog")?;
    let snapshot = read_catalog(&catalog)?;
    let manifest = inventory(&snapshot, hash(&catalog)?)?;
    copy_blobs(&snapshot, &library, &stage, checkpoint)?;
    drop(snapshot);
    let manifest = if let Some(profile) = reference_profile {
        super::snapshot_references::archive(profile, &stage, checkpoint)?;
        inventory(&read_catalog(&catalog)?, hash(&catalog)?)?
    } else {
        manifest
    };
    checkpoint("snapshot-blobs")?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(stage.join("manifest.json"))?;
    let manifest_bytes = serde_json::to_vec(&manifest)?;
    file.write_all(&manifest_bytes)?;
    file.sync_all()?;
    drop(file);
    prepare_publication(&format!("{:x}", Sha256::digest(&manifest_bytes)))?;
    checkpoint("snapshot-ready")?;
    let published = destination.join("snapshot");
    fs::rename(stage, &published)?;
    checkpoint("snapshot-published")?;
    pin.commit()?;
    Ok(published)
}

fn read_manifest(source: &Path) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    read_file(&source.join("manifest.json"))?
        .take(4097)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 4096 {
        return Err("snapshot manifest exceeds limit".into());
    }
    Ok(bytes)
}

/// Recheck a published snapshot in place without touching the active library.
pub(super) fn verify_publication(destination: &Path, manifest_digest: &str) -> Result<()> {
    let expected = destination.join("snapshot");
    let (source, _handles) = super::backup_destination::hold(&expected)?;
    if source != expected || destination.join("pending-snapshot").try_exists()? {
        return Err("backup publication directory changed".into());
    }
    let bytes = read_manifest(&source)?;
    if format!("{:x}", Sha256::digest(&bytes)) != manifest_digest {
        return Err("backup publication manifest mismatch".into());
    }
    let manifest: Manifest = serde_json::from_slice(&bytes)?;
    let catalog = source.join("catalog.sqlite");
    let mut catalog_file = read_file(&catalog)?;
    let digest = hash_file(&mut catalog_file)?;
    if digest != manifest.catalog_sha256 {
        return Err("snapshot catalog digest mismatch".into());
    }
    for name in [
        "catalog.sqlite-journal",
        "catalog.sqlite-wal",
        "catalog.sqlite-shm",
    ] {
        if source.join(name).try_exists()? {
            return Err("unexpected snapshot catalog sidecar".into());
        }
    }
    let db = read_catalog(&catalog)?;
    if inventory(&db, digest)? != manifest {
        return Err("snapshot manifest does not match catalog".into());
    }
    visit_originals(&db, &source, &|_| Ok(()), |_, _| Ok(()))
}

pub fn restore(
    source: &Path,
    library: &Path,
    mut thumbnail: impl FnMut(&Path, &Path) -> Result<()>,
    checkpoint: &impl Fn(&str) -> Result<()>,
) -> Result<Manifest> {
    if !source.is_absolute() || !library.is_absolute() || library.try_exists()? {
        return Err("restore requires an absolute snapshot and a new library directory".into());
    }
    let manifest: Manifest = serde_json::from_slice(&read_manifest(source)?)?;
    if !matches!(manifest.version, 1..=9) {
        return Err("unsupported snapshot version".into());
    }
    let parent = library.parent().ok_or("missing restore parent")?;
    let stage = parent.join(format!("pending-restore-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&stage)?;
    let catalog = stage.join("catalog.sqlite");
    copy(&source.join("catalog.sqlite"), &catalog)?;
    let digest = hash(&catalog)?;
    if digest != manifest.catalog_sha256 {
        return Err("snapshot catalog digest mismatch".into());
    }
    let db = read_catalog(&catalog)?;
    if inventory(&db, digest)? != manifest {
        return Err("snapshot manifest does not match catalog".into());
    }
    copy_blobs(&db, source, &stage, checkpoint)?;
    checkpoint("restore-blobs")?;
    let mut statement = db.prepare(&format!(
        "SELECT digest FROM blob{} ORDER BY digest",
        reference_catalog::managed_filter(&db)?
    ))?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        checkpoint("rebuilding-previews")?;
        let digest: String = row.get(0)?;
        thumbnail(
            &stage.join(format!("{digest}.blob")),
            &stage.join(format!("{digest}.png")),
        )?;
    }
    drop(rows);
    drop(statement);
    drop(db);
    drop(thumbnail);
    checkpoint("restore-ready")?;
    fs::rename(stage, library)?;
    checkpoint("restore-published")?;
    Ok(manifest)
}

#[cfg(test)]
#[path = "snapshot_tests.rs"]
mod tests;
