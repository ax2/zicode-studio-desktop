use super::{
    super::{imports, reference_catalog, Result},
    get, name,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::Path};
use uuid::Uuid;

const MAX_REFERENCES: usize = 8;

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AssetRevision {
    asset_id: i64,
    revision: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Reference {
    asset_id: i64,
    revision: i64,
    name: String,
    sha256: String,
}

#[derive(Serialize)]
pub(crate) struct ApprovedSet {
    id: i64,
    name: String,
    references: Vec<Reference>,
}

pub(crate) fn list(
    db: &Connection,
    id: &str,
    before: Option<i64>,
) -> Result<(Vec<ApprovedSet>, Option<i64>)> {
    get(db, id)?;
    let mut stmt = db.prepare("SELECT id,name FROM character_reference_set WHERE character_id=?1 AND id<=?2 ORDER BY id DESC LIMIT 11")?;
    let mut sets = stmt
        .query_map(params![id, before.unwrap_or(i64::MAX)], |row| {
            Ok(ApprovedSet {
                id: row.get(0)?,
                name: row.get(1)?,
                references: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let next = if sets.len() > 10 {
        sets.pop().map(|set| set.id)
    } else {
        None
    };
    for set in &mut sets {
        set.references = items(db, set.id)?;
    }
    Ok((sets, next))
}

pub(crate) fn find(db: &Connection, character: &str, id: i64) -> Result<ApprovedSet> {
    let name = db.query_row(
        "SELECT name FROM character_reference_set WHERE id=?1 AND character_id=?2",
        params![id, character],
        |row| row.get(0),
    )?;
    Ok(ApprovedSet {
        id,
        name,
        references: items(db, id)?,
    })
}

fn items(db: &Connection, id: i64) -> rusqlite::Result<Vec<Reference>> {
    let mut entries = db.prepare_cached(
        "SELECT i.asset,i.revision,a.name,r.digest FROM character_reference_item i
        JOIN asset a ON a.id=i.asset JOIN revision r ON r.asset=i.asset AND r.version=i.revision
        WHERE i.set_id=?1 ORDER BY i.position",
    )?;
    let rows = entries.query_map([id], |row| {
        Ok(Reference {
            asset_id: row.get(0)?,
            revision: row.get(1)?,
            name: row.get(2)?,
            sha256: row.get(3)?,
        })
    })?;
    rows.collect()
}

pub(crate) fn approve(
    db: &mut Connection,
    library: &Path,
    character: &str,
    request_id: &str,
    label: &str,
    references: &[AssetRevision],
    checkpoint: &impl Fn(&str),
) -> Result<i64> {
    get(db, character)?;
    let request_id = Uuid::parse_str(request_id)?.to_string();
    let label = name(label)?;
    if references.is_empty()
        || references.len() > MAX_REFERENCES
        || references
            .iter()
            .any(|item| item.asset_id <= 0 || item.revision <= 0)
        || references.iter().collect::<HashSet<_>>().len() != references.len()
    {
        return Err("visual_assets_character_references_invalid".into());
    }
    if let Some(id) = existing(db, &request_id, character, label, references)? {
        return Ok(id);
    }

    // Check the complete selection before making any offline copy. Each publication has
    // its own import journal and is reusable if a later copy or approval is interrupted.
    for item in references {
        imports::read_original(db, library, item.asset_id, item.revision)?;
    }
    for item in references {
        archive(db, library, *item, checkpoint)?;
    }
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    imports::recover(&tx, library)?;
    if let Some(id) = existing(&tx, &request_id, character, label, references)? {
        return Ok(id);
    }
    tx.execute(
        "INSERT INTO character_reference_set(character_id,request_id,name) VALUES (?1,?2,?3)",
        params![character, request_id, label],
    )?;
    let id = tx.last_insert_rowid();
    for (position, item) in references.iter().enumerate() {
        tx.execute(
            "INSERT INTO character_reference_item VALUES (?1,?2,?3,?4)",
            params![id, position, item.asset_id, item.revision],
        )?;
    }
    checkpoint("reference-set-before-commit");
    tx.commit()?;
    checkpoint("reference-set-committed");
    Ok(id)
}

fn archive(
    db: &mut Connection,
    library: &Path,
    item: AssetRevision,
    checkpoint: &impl Fn(&str),
) -> Result<()> {
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    imports::recover(&tx, library)?;
    let bytes = imports::read_original(&tx, library, item.asset_id, item.revision)?;
    if reference_catalog::is_reference(&tx, item.asset_id, item.revision)?
        && !reference_catalog::is_archived(&tx, item.asset_id, item.revision)?
    {
        imports::ensure_managed_bytes(&tx, library, &bytes, checkpoint)?;
        tx.execute(
            "INSERT INTO archived_reference VALUES (?1,?2)",
            params![item.asset_id, item.revision],
        )?;
    }
    tx.commit()?;
    Ok(())
}

fn existing(
    db: &Connection,
    request_id: &str,
    character: &str,
    label: &str,
    references: &[AssetRevision],
) -> Result<Option<i64>> {
    let prior = db
        .query_row(
            "SELECT id,character_id,name FROM character_reference_set WHERE request_id=?1",
            [request_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((id, owner, prior_name)) = prior else {
        return Ok(None);
    };
    let mut stmt = db.prepare(
        "SELECT asset,revision FROM character_reference_item WHERE set_id=?1 ORDER BY position",
    )?;
    let prior_refs = stmt
        .query_map([id], |row| {
            Ok(AssetRevision {
                asset_id: row.get(0)?,
                revision: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if owner != character || prior_name != label || prior_refs != references {
        return Err("visual_assets_character_reference_conflict".into());
    }
    Ok(Some(id))
}
