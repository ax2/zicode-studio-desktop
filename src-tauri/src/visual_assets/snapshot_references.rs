//! Materialize explicitly selected reference originals into the staged snapshot.
use super::{reference_import, snapshot, worker, Result};
use rusqlite::{params, Connection, OpenFlags, TransactionBehavior};
use std::path::Path;

pub(super) fn archive(
    profile: &Path,
    stage: &Path,
    checkpoint: &impl Fn(&str) -> Result<()>,
) -> Result<()> {
    let mut db = Connection::open_with_flags(
        stage.join("catalog.sqlite"),
        OpenFlags::SQLITE_OPEN_READ_WRITE,
    )?;
    db.execute_batch("PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;")?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    {
        let mut next = tx.prepare_cached(
            "SELECT a.asset,a.version,r.digest,b.bytes FROM asset_reference a
             JOIN revision r ON r.asset=a.asset AND r.version=a.version
             JOIN blob b ON b.digest=r.digest
             WHERE (a.asset,a.version)>(?1,?2) AND NOT EXISTS (
                 SELECT 1 FROM archived_reference p WHERE p.asset=a.asset AND p.version=a.version
             ) ORDER BY a.asset,a.version LIMIT 1",
        )?;
        let mut cursor = (0i64, 0i64);
        loop {
            let item = {
                let mut rows = next.query(params![cursor.0, cursor.1])?;
                rows.next()?
                    .map(|row| {
                        Ok::<_, rusqlite::Error>((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, usize>(3)?,
                        ))
                    })
                    .transpose()?
            };
            let Some((asset, version, digest, length)) = item else {
                break;
            };
            checkpoint("copying-referenced-originals")?;
            let (bytes, _) = reference_import::read(&tx, profile, asset, version)?;
            if bytes.len() != length {
                return Err("reference blob metadata mismatch".into());
            }
            let path = stage.join(format!("{digest}.blob"));
            if path.try_exists()? {
                if worker::read_input(&path)? != bytes {
                    return Err("archived reference does not match copied original".into());
                }
            } else {
                snapshot::write_original(&path, &digest, &bytes)?;
            }
            tx.execute("DELETE FROM external_blob WHERE digest=?1", [&digest])?;
            tx.execute(
                "INSERT INTO archived_reference VALUES (?1,?2)",
                params![asset, version],
            )?;
            cursor = (asset, version);
        }
    }
    tx.commit()?;
    Ok(())
}
