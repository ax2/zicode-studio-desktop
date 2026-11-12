//! Reference batches validate images before committing metadata, without managing their originals.
use super::{
    catalog,
    import_batch::{self, Item, Outcome},
    imports,
    reference_grants::Grants,
    reference_source::{Fault, Fingerprint, Root},
    worker, Result,
};
use rusqlite::{params, Connection, Transaction, TransactionBehavior};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub(super) fn import_selected(
    db: &mut Connection,
    library: &Path,
    profile: &Path,
    source: &Root,
    files: &[PathBuf],
    checkpoint: &impl Fn(&str),
) -> Result<Vec<Item>> {
    if files.is_empty() || files.len() > import_batch::MAX_FILES {
        return Err("invalid batch size".into());
    }
    let library_id: String = db.query_row("SELECT id FROM library", [], |row| row.get(0))?;
    let root_id = Grants::open(profile)?.register(&library_id, source)?;
    let items = files.iter().map(|path| {
        (
            path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            path,
        )
    });
    Ok(import_batch::results(items, |name, path| {
        let Ok(tx) = db.transaction_with_behavior(TransactionBehavior::Immediate) else {
            return Outcome::NotAttempted;
        };
        if imports::recover(&tx, library).is_err() {
            return Outcome::NotAttempted;
        }
        let Ok((asset_id, duplicate_of)) =
            import_one(&tx, library, source, &root_id, name, path, checkpoint)
        else {
            return Outcome::Failed;
        };
        if tx.commit().is_err() {
            return Outcome::Unconfirmed;
        }
        checkpoint("committed");
        Outcome::Imported {
            asset_id,
            duplicate_of,
        }
    }))
}

fn import_one(
    tx: &Transaction<'_>,
    library: &Path,
    source: &Root,
    root_id: &str,
    name: &str,
    path: &Path,
    checkpoint: &impl Fn(&str),
) -> Result<(i64, Option<imports::DuplicateCandidate>)> {
    let (bytes, fingerprint) = source.read(path, None)?;
    let relative = path.to_str().ok_or("invalid reference path")?;
    with_thumbnail(library, &bytes, checkpoint, |_| Ok(()))?;
    let digest = &fingerprint.sha256;
    let duplicate_of = imports::duplicate_candidate(tx, digest)?;
    if tx.execute(
        "INSERT OR IGNORE INTO blob VALUES (?1,?2)",
        params![digest, bytes.len()],
    )? == 1
    {
        tx.execute("INSERT INTO external_blob VALUES (?1)", [digest])?;
    } else if tx.query_row("SELECT bytes FROM blob WHERE digest=?1", [digest], |row| {
        row.get::<_, usize>(0)
    })? != bytes.len()
    {
        return Err("reference blob metadata mismatch".into());
    }
    let asset = catalog::add_asset(tx, name)?;
    tx.execute(
        "INSERT INTO revision VALUES (?1,1,?2)",
        params![asset, digest],
    )?;
    tx.execute(
        "INSERT INTO asset_reference VALUES (?1,1,?2,?3,?4)",
        params![
            asset,
            root_id,
            relative,
            serde_json::to_string(&fingerprint)?
        ],
    )?;
    Ok((asset, duplicate_of))
}

pub(super) fn with_thumbnail<T>(
    library: &Path,
    bytes: &[u8],
    checkpoint: &impl Fn(&str),
    use_preview: impl FnOnce(&Path) -> Result<T>,
) -> Result<T> {
    let input = library.join("pending.reference.input");
    let preview = library.join("pending.reference.png");
    let mut staged = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&input)?;
    staged.write_all(bytes)?;
    drop(staged);
    checkpoint("reference-staged");
    let verified = worker::generate(&input, &preview).and_then(|()| {
        if worker::read_input(&input)? != bytes {
            return Err("staged reference failed integrity check".into());
        }
        use_preview(&preview)
    });
    // Recovery also removes these names if the process exited before this point.
    imports::clear_reference_stage(library)?;
    verified
}

struct Record {
    library: String,
    root: String,
    relative: String,
    fingerprint: Fingerprint,
}

fn record(db: &Connection, asset: i64, version: i64) -> Result<Record> {
    let (library, root, relative, stored, digest): (String, String, String, String, String) = db
        .query_row(
            "SELECT l.id,a.root_id,a.relative_path,a.fingerprint,r.digest
         FROM asset_reference a JOIN revision r ON r.asset=a.asset AND r.version=a.version
         CROSS JOIN library l WHERE a.asset=?1 AND a.version=?2",
            params![asset, version],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )?;
    let fingerprint: Fingerprint = serde_json::from_str(&stored)?;
    if fingerprint.sha256 != digest {
        return Err("invalid reference metadata".into());
    }
    Ok(Record {
        library,
        root,
        relative,
        fingerprint,
    })
}

pub(super) fn read(
    db: &Connection,
    profile: &Path,
    asset: i64,
    version: i64,
) -> Result<(Vec<u8>, Fingerprint)> {
    let saved = record(db, asset, version)?;
    let root = Grants::load(profile, &saved.library, &saved.root)?;
    Ok(root.read(Path::new(&saved.relative), Some(&saved.fingerprint))?)
}

pub(super) fn reauthorize(
    tx: &Transaction<'_>,
    profile: &Path,
    asset: i64,
    version: i64,
    root: &Root,
) -> Result<()> {
    if super::reference_catalog::is_archived(tx, asset, version)? {
        return Err("reference_original_archived".into());
    }
    let saved = record(tx, asset, version)?;
    let (_, fingerprint) = root.read(Path::new(&saved.relative), None)?;
    if fingerprint.sha256 != saved.fingerprint.sha256 {
        return Err(Fault::ContentChanged.into());
    }
    let grant = Grants::open(profile)?.register(&saved.library, root)?;
    tx.execute(
        "UPDATE asset_reference SET root_id=?3,fingerprint=?4 WHERE asset=?1 AND version=?2",
        params![asset, version, grant, serde_json::to_string(&fingerprint)?],
    )?;
    Ok(())
}

pub(super) fn public_error(error: Box<dyn std::error::Error>) -> String {
    let message = error.to_string();
    if error.is::<Fault>() || message == "reference_not_authorized" {
        message
    } else {
        "reference_source_unavailable".into()
    }
}
