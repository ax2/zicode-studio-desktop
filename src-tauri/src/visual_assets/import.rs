use super::{reference_catalog, worker, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::Path};

#[cfg(test)]
#[path = "import_duplicate_tests.rs"]
mod duplicate_tests;
#[cfg(test)]
#[path = "import_tests.rs"]
mod tests;

const DUPLICATE_QUERY: &str = "SELECT r.asset, a.name FROM revision r JOIN asset a ON a.id=r.asset
     WHERE r.digest=?1 AND r.version=1 ORDER BY r.asset LIMIT 1";

pub fn recover(db: &Connection, library: &Path) -> Result<()> {
    // Older probe libraries had no import journal. Reconcile them once under
    // the caller's exclusive write transaction before switching protocols.
    let version: i64 = db.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version == 0 {
        recover_legacy(db, library)?;
        db.execute_batch("PRAGMA user_version=1")?;
    } else if version != 1 {
        return Err("unsupported visual asset storage version".into());
    }
    remove_if_present(&library.join("pending.journal.tmp"))?;
    clear_reference_stage(library)?;
    clear_generation_preview(library)?;
    let journal = library.join("pending.import");
    let digest = match fs::read_to_string(&journal) {
        Ok(digest) => digest,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("invalid import journal; preserve library for recovery".into());
    }
    remove_if_present(&library.join("pending.input.tmp"))?;
    remove_if_present(&library.join("pending.thumbnail.tmp"))?;
    let committed = reference_catalog::is_managed(db, &digest)?;
    if !committed {
        remove_if_present(&library.join(format!("{digest}.blob")))?;
        remove_if_present(&library.join(format!("{digest}.png")))?;
    }
    remove_if_present(&journal)?;
    Ok(())
}

fn remove_if_present(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

pub(super) fn clear_reference_stage(library: &Path) -> Result<()> {
    remove_if_present(&library.join("pending.reference.input"))?;
    remove_if_present(&library.join("pending.reference.png"))
}

pub(super) fn clear_generation_preview(library: &Path) -> Result<()> {
    remove_if_present(&library.join(super::generation_outputs::INPUT))?;
    remove_if_present(&library.join(super::generation_outputs::THUMBNAIL))
}

fn recover_legacy(db: &Connection, library: &Path) -> Result<()> {
    for entry in fs::read_dir(library)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some((digest, extension)) = name.to_str().and_then(|name| name.split_once('.')) else {
            continue;
        };
        let staged = matches!(extension, "input.tmp" | "thumbnail.tmp") && digest == "pending";
        let orphan = matches!(extension, "blob" | "png")
            && digest.len() == 64
            && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
            && !reference_catalog::is_managed(db, digest)?;
        if staged || orphan {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

pub fn import(
    db: &Connection,
    library: &Path,
    source: &Path,
    checkpoint: &impl Fn(&str),
) -> Result<i64> {
    let name = source
        .file_name()
        .ok_or("missing file name")?
        .to_string_lossy();
    let bytes = worker::read_input(source)?;
    Ok(import_bytes(db, library, &name, &bytes, checkpoint)?.asset_id)
}

pub(super) struct Imported {
    pub asset_id: i64,
    pub duplicate_of: Option<DuplicateCandidate>,
}

#[derive(Serialize)]
pub(super) struct DuplicateCandidate {
    id: i64,
    name: String,
}

pub(super) fn import_bytes(
    db: &Connection,
    library: &Path,
    name: &str,
    bytes: &[u8],
    checkpoint: &impl Fn(&str),
) -> Result<Imported> {
    let digest = ensure_managed_bytes(db, library, bytes, checkpoint)?;
    let duplicate_of = duplicate_candidate(db, &digest)?;
    let id = super::catalog::add_asset(db, name)?;
    db.execute(
        "INSERT INTO revision VALUES (?1, 1, ?2)",
        params![id, digest],
    )?;
    Ok(Imported {
        asset_id: id,
        duplicate_of,
    })
}

pub(super) fn ensure_managed_bytes(
    db: &Connection,
    library: &Path,
    bytes: &[u8],
    checkpoint: &impl Fn(&str),
) -> Result<String> {
    let digest = format!("{:x}", Sha256::digest(bytes));
    let original = library.join(format!("{digest}.blob"));
    let thumbnail = library.join(format!("{digest}.png"));
    if reference_catalog::is_managed(db, &digest)? {
        if worker::read_input(&original)? != bytes {
            return Err("managed original failed integrity check".into());
        }
    } else {
        if original.try_exists()? || thumbnail.try_exists()? {
            return Err("unregistered managed bytes require reconciliation".into());
        }
        // Publish a durable intent before creating any managed image bytes.
        let journal_temp = library.join("pending.journal.tmp");
        let mut journal = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&journal_temp)?;
        journal.write_all(digest.as_bytes())?;
        journal.sync_all()?;
        drop(journal);
        fs::rename(journal_temp, library.join("pending.import"))?;
        checkpoint("intent");
        let staged = library.join("pending.input.tmp");
        let preview = library.join("pending.thumbnail.tmp");
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staged)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        checkpoint("staged");
        worker::generate(&staged, &preview)?;
        if worker::read_input(&staged)? != bytes {
            return Err("staged original failed integrity check".into());
        }
        fs::rename(staged, original)?;
        checkpoint("original-published");
        fs::rename(preview, thumbnail)?;
        checkpoint("published");
    }
    let inserted = db.execute(
        "INSERT OR IGNORE INTO blob VALUES (?1, ?2)",
        params![digest, bytes.len()],
    )?;
    if inserted == 0
        && db.query_row("SELECT bytes FROM blob WHERE digest=?1", [&digest], |row| {
            row.get::<_, usize>(0)
        })? != bytes.len()
    {
        return Err("managed original metadata mismatch".into());
    }
    db.execute("DELETE FROM external_blob WHERE digest=?1", [&digest])?;
    Ok(digest)
}

pub(super) fn read_original(
    db: &Connection,
    library: &Path,
    asset: i64,
    version: i64,
) -> Result<Vec<u8>> {
    let (digest, length): (String, u64) = db.query_row(
        "SELECT r.digest, b.bytes FROM revision r JOIN blob b ON b.digest = r.digest
         WHERE r.asset = ?1 AND r.version = ?2",
        params![asset, version],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("invalid asset revision digest".into());
    }
    let bytes = if reference_catalog::is_reference(db, asset, version)?
        && !reference_catalog::is_archived(db, asset, version)?
    {
        let profile = library.parent().ok_or("missing library profile")?;
        super::reference_import::read(db, profile, asset, version)?.0
    } else {
        worker::read_input(&library.join(format!("{digest}.blob")))?
    };
    if bytes.len() as u64 != length || format!("{:x}", Sha256::digest(&bytes)) != digest {
        return Err("original bytes differ from the selected revision".into());
    }
    Ok(bytes)
}

pub(super) fn duplicate_candidate(
    db: &Connection,
    digest: &str,
) -> rusqlite::Result<Option<DuplicateCandidate>> {
    db.query_row(DUPLICATE_QUERY, [digest], |row| {
        Ok(DuplicateCandidate {
            id: row.get(0)?,
            name: row.get(1)?,
        })
    })
    .optional()
}
