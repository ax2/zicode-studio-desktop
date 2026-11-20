//! Portable reference records and the inventory of managed original bytes.
use rusqlite::{params, Connection};

const REFERENCE_EXISTS: &str =
    "SELECT EXISTS(SELECT 1 FROM asset_reference WHERE asset=?1 AND version=?2)";

pub(super) fn is_reference(db: &Connection, asset: i64, version: i64) -> rusqlite::Result<bool> {
    db.prepare_cached(REFERENCE_EXISTS)?
        .query_row(params![asset, version], |row| row.get(0))
}

pub(super) fn fill_page(db: &Connection, page: &mut super::catalog::Page) -> rusqlite::Result<()> {
    for asset in &mut page.assets {
        asset.referenced = is_reference(db, asset.id, 1)?;
        if asset.referenced {
            asset.archived_reference = is_archived(db, asset.id, 1)?;
        }
    }
    Ok(())
}

pub(super) const ARCHIVED_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS archived_reference(
    asset INTEGER NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(asset,version),
    FOREIGN KEY(asset,version) REFERENCES asset_reference(asset,version) ON DELETE CASCADE
    ) WITHOUT ROWID;";

pub(super) fn is_archived(db: &Connection, asset: i64, version: i64) -> rusqlite::Result<bool> {
    db.prepare_cached(
        "SELECT EXISTS(SELECT 1 FROM archived_reference WHERE asset=?1 AND version=?2)",
    )?
    .query_row(params![asset, version], |row| row.get(0))
}

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS asset_reference(
    asset INTEGER NOT NULL, version INTEGER NOT NULL, root_id TEXT NOT NULL CHECK(length(root_id)=36),
    relative_path TEXT NOT NULL CHECK(length(relative_path) BETWEEN 1 AND 32767),
    fingerprint TEXT NOT NULL CHECK(length(fingerprint) BETWEEN 1 AND 1024),
    PRIMARY KEY(asset,version),
    FOREIGN KEY(asset,version) REFERENCES revision(asset,version) ON DELETE CASCADE
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS external_blob(
        digest TEXT NOT NULL PRIMARY KEY REFERENCES blob(digest) ON DELETE CASCADE
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS revision_by_digest ON revision(digest);";

pub(super) fn managed_filter(db: &Connection) -> rusqlite::Result<&'static str> {
    if db
        .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='external_blob'")?
        .exists([])?
    {
        Ok(" WHERE NOT EXISTS(SELECT 1 FROM external_blob e WHERE e.digest=blob.digest)")
    } else {
        Ok("")
    }
}

pub(super) fn is_managed(db: &Connection, digest: &str) -> rusqlite::Result<bool> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM blob WHERE digest=?1)
         AND NOT EXISTS(SELECT 1 FROM external_blob WHERE digest=?1)",
        [digest],
        |row| row.get(0),
    )
}

pub(super) fn snapshot_version(db: &Connection) -> rusqlite::Result<u32> {
    if managed_filter(db)?.is_empty() {
        return Ok(1);
    }
    let invalid: bool = db.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM external_blob e WHERE
                NOT EXISTS(SELECT 1 FROM revision r WHERE r.digest=e.digest)
                OR EXISTS(SELECT 1 FROM revision r WHERE r.digest=e.digest
                    AND NOT EXISTS(SELECT 1 FROM asset_reference a WHERE a.asset=r.asset AND a.version=r.version))
        )",
        [],
        |row| row.get(0),
    )?;
    if invalid {
        return Err(rusqlite::Error::InvalidQuery);
    }
    let archived_schema = db
        .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='archived_reference'")?
        .exists([])?;
    if archived_schema
        && db
            .prepare("SELECT 1 FROM archived_reference LIMIT 1")?
            .exists([])?
    {
        if db
            .prepare(
                "SELECT 1 FROM archived_reference a
             JOIN revision r ON r.asset=a.asset AND r.version=a.version
             JOIN external_blob e ON e.digest=r.digest LIMIT 1",
            )?
            .exists([])?
        {
            return Err(rusqlite::Error::InvalidQuery);
        }
        return Ok(3);
    }
    let references: bool = db
        .prepare("SELECT 1 FROM asset_reference LIMIT 1")?
        .exists([])?;
    Ok(if references { 2 } else { 1 })
}
