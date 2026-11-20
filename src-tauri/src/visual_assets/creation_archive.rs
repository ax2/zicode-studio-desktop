//! Approved image results and portable source plans share a Catalog transaction.
use super::{
    creation_types::{hash, validate_usage, Plan},
    imports, Result,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
use std::path::Path;
use uuid::Uuid;

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS image_creation_source(
    job_id TEXT PRIMARY KEY, asset INTEGER NOT NULL UNIQUE, revision INTEGER NOT NULL CHECK(revision=1),
    output_digest TEXT NOT NULL, plan TEXT NOT NULL CHECK(length(plan)<=131072), usage TEXT NOT NULL,
    FOREIGN KEY(asset,revision) REFERENCES revision(asset,version)
) WITHOUT ROWID;";
pub(super) fn schema_present(db: &Connection) -> rusqlite::Result<bool> {
    db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='image_creation_source'")?
        .exists([])
}
pub(super) fn fill_page(db: &Connection, page: &mut super::catalog::Page) -> rusqlite::Result<()> {
    if !schema_present(db)? {
        return Ok(());
    }
    let mut statement =
        db.prepare_cached("SELECT job_id FROM image_creation_source WHERE asset=?1")?;
    for asset in &mut page.assets {
        asset.creation_job_id = statement
            .query_row([asset.id], |row| row.get(0))
            .optional()?;
    }
    Ok(())
}
pub(super) fn get(db: &Connection, id: Uuid) -> Result<Option<Value>> {
    if !schema_present(db)? {
        return Ok(None);
    }
    let saved: Option<(i64, String, String, String)> = db
        .query_row(
            "SELECT asset,output_digest,plan,usage FROM image_creation_source WHERE job_id=?1",
            [id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    saved
        .map(|(asset, digest, encoded, usage)| {
            let plan: Plan = serde_json::from_str(&encoded)?;
            plan.validate(db)?;
            let actual: String = db.query_row(
                "SELECT digest FROM revision WHERE asset=?1 AND version=1",
                [asset],
                |row| row.get(0),
            )?;
            if actual != digest {
                return Err("visual_assets_creation_result_changed".into());
            }
            let usage: Value = serde_json::from_str(&usage)?;
            validate_usage(&usage)?;
            Ok(json!({"jobId":id,"assetId":asset,"sha256":digest,"plan":plan,"usage":usage}))
        })
        .transpose()
}
pub(super) fn save(
    db: &mut Connection,
    library: &Path,
    id: Uuid,
    plan: &Plan,
    bytes: &[u8],
    digest: &str,
    usage: &Value,
) -> Result<Value> {
    save_checked(
        db,
        library,
        Approval {
            id,
            plan,
            bytes,
            digest,
            usage,
        },
        &|_| Ok(()),
    )
}
pub(super) struct Approval<'a> {
    pub id: Uuid,
    pub plan: &'a Plan,
    pub bytes: &'a [u8],
    pub digest: &'a str,
    pub usage: &'a Value,
}
pub(super) fn save_checked(
    db: &mut Connection,
    library: &Path,
    approval: Approval<'_>,
    checkpoint: &impl Fn(&str) -> Result<()>,
) -> Result<Value> {
    let Approval {
        id,
        plan,
        bytes,
        digest,
        usage,
    } = approval;
    validate_usage(usage)?;
    if hash(bytes) != digest {
        return Err("visual_assets_creation_result_changed".into());
    }
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    imports::recover(&tx, library)?;
    if let Some(saved) = get(&tx, id)? {
        if saved["sha256"] != digest {
            return Err("visual_assets_creation_result_changed".into());
        }
        tx.commit()?;
        return Ok(saved);
    }
    plan.validate(&tx)?;
    let extension = plan.result_extension(bytes)?;
    let label = match plan.workflow.as_str() {
        "style" => "Style result",
        "text-to-image" => "Generated image",
        "image-to-image" => "Edited image",
        _ => "Outfit result",
    };
    let name = format!("{label}.{extension}");
    let imported = imports::import_bytes(&tx, library, &name, bytes, &|_| {})?;
    tx.execute_batch(SCHEMA)?;
    tx.execute(
        "INSERT INTO image_creation_source VALUES (?1,?2,1,?3,?4,?5)",
        params![
            id.to_string(),
            imported.asset_id,
            digest,
            serde_json::to_string(plan)?,
            usage.to_string()
        ],
    )?;
    let saved = get(&tx, id)?.ok_or("visual_assets_creation_archive_missing")?;
    checkpoint("before-archive-commit")?;
    tx.commit()?;
    checkpoint("after-archive-commit")?;
    Ok(saved)
}
pub(super) fn validate_snapshot(db: &Connection) -> Result<()> {
    let mut statement = db.prepare("SELECT job_id FROM image_creation_source")?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for id in ids {
        get(db, Uuid::parse_str(&id)?)?.ok_or("visual_assets_creation_archive_missing")?;
    }
    Ok(())
}
