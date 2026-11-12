//! Machine-local authorization. This database is outside all library snapshots.
use super::{reference_source::Root, Result};
use rusqlite::{params, Connection, OpenFlags};
use std::path::Path;

pub(super) struct Grants(Connection);

impl Grants {
    pub(super) fn open(profile: &Path) -> Result<Self> {
        let db = Connection::open(profile.join("visual-assets-authorizations.sqlite"))?;
        db.execute_batch(
            "PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL;
             CREATE TABLE IF NOT EXISTS source_grant(
                library_id TEXT NOT NULL, id TEXT NOT NULL, source TEXT NOT NULL,
                PRIMARY KEY(library_id,id), UNIQUE(library_id,source)
             ) WITHOUT ROWID;",
        )?;
        Ok(Self(db))
    }

    pub(super) fn register(&self, library: &str, source: &Root) -> Result<String> {
        let value = serde_json::to_string(source)?;
        self.0.execute(
            "INSERT INTO source_grant VALUES (?1,?2,?3)
             ON CONFLICT(library_id,source) DO NOTHING",
            params![library, uuid::Uuid::new_v4().to_string(), value],
        )?;
        Ok(self.0.query_row(
            "SELECT id FROM source_grant WHERE library_id=?1 AND source=?2",
            params![library, value],
            |row| row.get(0),
        )?)
    }

    pub(super) fn load(profile: &Path, library: &str, id: &str) -> Result<Root> {
        let path = profile.join("visual-assets-authorizations.sqlite");
        if !path.try_exists()? {
            return Err("reference_not_authorized".into());
        }
        let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        db.execute_batch("PRAGMA trusted_schema=OFF;")?;
        let value: String = db
            .query_row(
                "SELECT source FROM source_grant WHERE library_id=?1 AND id=?2",
                params![library, id],
                |row| row.get(0),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => {
                    Box::<dyn std::error::Error>::from("reference_not_authorized")
                }
                error => error.into(),
            })?;
        Ok(serde_json::from_str(&value)?)
    }
}
