use super::{
    novel_drafts::{self, Draft},
    novel_model_source::{Source, Summary},
    Result,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use uuid::Uuid;

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS novel_model_source(
    draft_id TEXT PRIMARY KEY REFERENCES novel_character_draft(id),
    job_id TEXT NOT NULL UNIQUE CHECK(length(job_id)=36),
    source TEXT NOT NULL CHECK(length(source)<=262144)
) WITHOUT ROWID;";

pub(super) fn schema_present(db: &Connection) -> rusqlite::Result<bool> {
    db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='novel_model_source'")?
        .exists([])
}

pub(super) fn get(db: &Connection, id: Uuid) -> Result<Option<Source>> {
    if !schema_present(db)? {
        return Ok(None);
    }
    let value: Option<(String, String)> = db
        .query_row(
            "SELECT job_id,source FROM novel_model_source WHERE draft_id=?1",
            [id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    value
        .map(|(job, encoded)| {
            let source = Source::decode(&encoded)?;
            if source.job_id.to_string() != job {
                return Err("visual_assets_model_source_invalid".into());
            }
            Ok(source)
        })
        .transpose()
}

pub(super) fn find_job(db: &Connection, id: Uuid) -> Result<Option<String>> {
    if !schema_present(db)? {
        return Ok(None);
    }
    Ok(db
        .query_row(
            "SELECT draft_id FROM novel_model_source WHERE job_id=?1",
            [id.to_string()],
            |row| row.get(0),
        )
        .optional()?)
}

pub(super) fn summary(db: &Connection, draft: &Draft) -> Result<Option<Summary>> {
    get(db, Uuid::parse_str(&draft.id)?)?
        .map(|source| {
            source.validate(db, draft)?;
            Ok(source.summary(draft))
        })
        .transpose()
}

pub(super) fn existing(
    db: &Connection,
    job: Uuid,
    draft: Uuid,
    text: &str,
    workspace: &str,
) -> Result<Option<String>> {
    if let Some(id) = find_job(db, job)? {
        let saved =
            novel_drafts::get(db, Uuid::parse_str(&id)?)?.ok_or("visual_assets_draft_missing")?;
        if saved.text != text.trim() || saved.evidence.workspace_id != workspace {
            return Err("visual_assets_model_already_adopted".into());
        }
        return Ok(Some(id));
    }
    if novel_drafts::get(db, draft)?.is_some() {
        return Err("visual_assets_draft_id_conflict".into());
    }
    Ok(None)
}

pub(super) fn insert(tx: &Transaction<'_>, draft: Uuid, source: &Source) -> Result<()> {
    let saved = novel_drafts::get(tx, draft)?.ok_or("visual_assets_draft_missing")?;
    source.validate(tx, &saved)?;
    let encoded = serde_json::to_string(source)?;
    if encoded.len() > 256 * 1024 {
        return Err("visual_assets_model_source_invalid".into());
    }
    tx.execute_batch(SCHEMA)?;
    tx.execute(
        "INSERT INTO novel_model_source VALUES (?1,?2,?3)",
        params![draft.to_string(), source.job_id.to_string(), encoded],
    )?;
    Ok(())
}

pub(super) fn validate_snapshot(db: &Connection) -> Result<()> {
    if !novel_drafts::schema_present(db)? {
        return Err("visual_assets_model_source_invalid".into());
    }
    let mut statement = db.prepare("SELECT draft_id FROM novel_model_source")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        // Loading the draft validates its source without consulting Notes or a live model.
        novel_drafts::get(db, Uuid::parse_str(&id)?)?.ok_or("visual_assets_draft_missing")?;
    }
    Ok(())
}
