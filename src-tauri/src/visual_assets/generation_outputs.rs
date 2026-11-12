//! Approve exactly the image bytes displayed for a completed generation attempt.
use super::{
    comfyui::{Comfy, Output},
    generation_attempts, imports, preview, worker, Result,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;
use uuid::Uuid;

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS generation_output_archive(
    attempt_id TEXT NOT NULL REFERENCES generation_attempt(id), filename TEXT NOT NULL,
    asset INTEGER NOT NULL UNIQUE, revision INTEGER NOT NULL CHECK(revision=1),
    approved INTEGER NOT NULL, PRIMARY KEY(attempt_id,filename),
    FOREIGN KEY(asset,revision) REFERENCES revision(asset,version)
);";

pub(super) const INPUT: &str = "pending.comfy-review.input";
pub(super) const THUMBNAIL: &str = "pending.comfy-review.png";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Archived {
    pub(super) filename: String,
    pub(super) asset_id: i64,
    pub(super) revision: i64,
    pub(super) sha256: String,
}

pub(super) fn schema_present(db: &Connection) -> rusqlite::Result<bool> {
    db.prepare(
        "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='generation_output_archive'",
    )?
    .exists([])
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Provenance {
    attempt_id: String,
    recipe_name: String,
    recipe_version: i64,
}

pub(super) fn fill_page(db: &Connection, page: &mut super::catalog::Page) -> rusqlite::Result<()> {
    if !schema_present(db)? {
        return Ok(());
    }
    let mut statement = db.prepare_cached(
        "SELECT g.id,r.name,g.recipe_version
        FROM generation_output_archive a JOIN generation_attempt g ON g.id=a.attempt_id
        JOIN generation_recipe r ON r.id=g.recipe_id WHERE a.asset=?1",
    )?;
    for asset in &mut page.assets {
        asset.generated_from = statement
            .query_row([asset.id], |row| {
                Ok(Provenance {
                    attempt_id: row.get(0)?,
                    recipe_name: row.get(1)?,
                    recipe_version: row.get(2)?,
                })
            })
            .optional()?;
    }
    Ok(())
}

pub(super) fn archived(db: &Connection, attempt: &str) -> Result<Vec<Archived>> {
    if !schema_present(db)? {
        return Ok(Vec::new());
    }
    let mut statement = db.prepare(
        "SELECT a.filename,a.asset,a.revision,r.digest
        FROM generation_output_archive a JOIN revision r ON r.asset=a.asset AND r.version=a.revision
        WHERE a.attempt_id=?1 ORDER BY a.filename",
    )?;
    let rows = statement.query_map([attempt], |row| {
        Ok(Archived {
            filename: row.get(0)?,
            asset_id: row.get(1)?,
            revision: row.get(2)?,
            sha256: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub(super) struct Source {
    attempt: Uuid,
    output: Output,
    port: u16,
}

impl Source {
    pub(super) fn load(db: &Connection, expected: &str, id: Uuid, filename: &str) -> Result<Self> {
        generation_attempts::check_library(db, expected)?;
        let (port, outputs): (u16, String) = db
            .query_row(
                "SELECT port,outputs FROM generation_attempt WHERE id=?1 AND state='ready'",
                [id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .ok_or("visual_assets_comfy_output_invalid")?;
        let outputs: Vec<Output> = serde_json::from_str(&outputs)?;
        let output = outputs
            .into_iter()
            .find(|file| file.matches(id, filename))
            .ok_or("visual_assets_comfy_output_invalid")?;
        Ok(Self {
            attempt: id,
            output,
            port,
        })
    }

    pub(super) fn download(&self) -> Result<Vec<u8>> {
        Comfy::new(self.port)?.read_output(self.attempt, &self.output)
    }

    pub(super) fn existing(&self, db: &Connection, sha256: &str) -> Result<Option<Archived>> {
        let found = archived(db, &self.attempt.to_string())?
            .into_iter()
            .find(|entry| entry.filename == self.output.filename);
        if found.as_ref().is_some_and(|entry| entry.sha256 != sha256) {
            return Err("visual_assets_comfy_output_changed".into());
        }
        Ok(found)
    }

    pub(super) fn archive(
        &self,
        db: &mut Connection,
        library: &Path,
        expected: &str,
        bytes: &[u8],
        sha256: &str,
        checkpoint: &impl Fn(&str),
    ) -> Result<Archived> {
        if digest(bytes) != sha256 {
            return Err("visual_assets_comfy_output_changed".into());
        }
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = Self::load(&tx, expected, self.attempt, &self.output.filename)?;
        if current.port != self.port {
            return Err("visual_assets_comfy_output_changed".into());
        }
        imports::recover(&tx, library)?;
        if let Some(existing) = self.existing(&tx, sha256)? {
            tx.commit()?;
            return Ok(existing);
        }
        let filename = &self.output.filename;
        let imported = imports::import_bytes(&tx, library, filename, bytes, checkpoint)?;
        tx.execute_batch(SCHEMA)?;
        tx.execute(
            "INSERT INTO generation_output_archive VALUES (?1,?2,?3,1,unixepoch('now'))",
            params![self.attempt.to_string(), filename, imported.asset_id],
        )?;
        tx.commit()?;
        checkpoint("comfy-output-committed");
        Ok(Archived {
            filename: filename.clone(),
            asset_id: imported.asset_id,
            revision: 1,
            sha256: sha256.to_string(),
        })
    }
}

pub(super) fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) fn thumbnail(db: &mut Connection, library: &Path, bytes: &[u8]) -> Result<String> {
    // The SQLite writer lock covers both preview files and their recovery.
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    imports::recover(&tx, library)?;
    let input = library.join(INPUT);
    let thumbnail = library.join(THUMBNAIL);
    let result: Result<String> = (|| {
        super::animation::write_new(&input, bytes)?;
        worker::generate(&input, &thumbnail)?;
        Ok(preview::read_thumbnail(&thumbnail)?)
    })();
    imports::clear_generation_preview(library)?;
    tx.commit()?;
    result
}

pub(super) fn validate_snapshot(db: &Connection) -> rusqlite::Result<()> {
    let invalid = db.prepare("SELECT 1 FROM generation_output_archive a JOIN generation_attempt g ON g.id=a.attempt_id
        WHERE g.state<>'ready' OR EXISTS(SELECT 1 FROM asset_reference r WHERE r.asset=a.asset AND r.version=a.revision)
        OR NOT EXISTS(SELECT 1 FROM json_each(g.outputs) item
            WHERE item.value->>'filename'=a.filename AND item.value->>'subfolder'='zicode')
        LIMIT 1")?.exists([])?;
    if invalid {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(())
}
