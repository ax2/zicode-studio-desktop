//! One review draft and one approved model annotation per immutable asset revision.
use super::super::catalog::Page;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use uuid::Uuid;

const SCHEMA:&str="CREATE TABLE IF NOT EXISTS vision_annotation(
    id TEXT PRIMARY KEY, asset INTEGER NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
    digest TEXT NOT NULL, preview_sha TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
    endpoint_origin TEXT NOT NULL, reviewed_at INTEGER NOT NULL CHECK(reviewed_at>0), approved INTEGER NOT NULL CHECK(approved IN(0,1)),
    UNIQUE(asset,digest,approved));
    CREATE TABLE IF NOT EXISTS vision_annotation_label(
    annotation TEXT NOT NULL REFERENCES vision_annotation(id) ON DELETE CASCADE,
    label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 64), PRIMARY KEY(annotation,label)) WITHOUT ROWID;";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    provider: String,
    model: String,
    endpoint_origin: String,
    preview_sha: String,
    approved: bool,
    reviewed_at: i64,
    labels: Vec<String>,
}

/// Approved and pending label records are authoritative; this lookup index is rebuildable.
pub fn ensure_index(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch(
        "CREATE INDEX IF NOT EXISTS vision_by_label ON vision_annotation_label(label,annotation)",
    )
}

pub fn ensure_schema(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch(SCHEMA)?;
    ensure_index(db)
}

pub fn present(db: &Connection) -> rusqlite::Result<bool> {
    db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='vision_annotation'")?
        .exists([])
}

fn labels(db: &Connection, id: &str) -> rusqlite::Result<Vec<String>> {
    db.prepare_cached(
        "SELECT label FROM vision_annotation_label WHERE annotation=?1 ORDER BY label LIMIT 9",
    )?
    .query_map([id], |r| r.get(0))?
    .collect()
}

pub fn fill(db: &Connection, page: &mut Page) -> rusqlite::Result<()> {
    if !present(db)? {
        return Ok(());
    }
    let mut stmt=db.prepare_cached("SELECT id,provider,model,endpoint_origin,preview_sha,approved,reviewed_at FROM vision_annotation WHERE asset=?1 AND digest=?2 ORDER BY approved DESC")?;
    for a in &mut page.assets {
        let mut rows = stmt.query(params![a.id, a.digest])?;
        while let Some(r) = rows.next()? {
            let id = r.get::<_, String>(0)?;
            a.vision.push(Record {
                labels: labels(db, &id)?,
                id,
                provider: r.get(1)?,
                model: r.get(2)?,
                endpoint_origin: r.get(3)?,
                preview_sha: r.get(4)?,
                approved: r.get(5)?,
                reviewed_at: r.get(6)?,
            });
        }
    }
    Ok(())
}

fn slot(
    db: &Connection,
    asset: i64,
    digest: &str,
    approved: bool,
) -> rusqlite::Result<Option<String>> {
    db.query_row(
        "SELECT id FROM vision_annotation WHERE asset=?1 AND digest=?2 AND approved=?3",
        params![asset, digest, approved],
        |r| r.get(0),
    )
    .optional()
}

pub struct Draft<'a> {
    pub asset: i64,
    pub digest: &'a str,
    pub preview_sha: &'a str,
    pub provider: &'a str,
    pub model: &'a str,
    pub origin: &'a str,
    pub labels: &'a [String],
}

pub fn draft(tx: &Transaction, d: Draft, previous: Option<&str>) -> rusqlite::Result<()> {
    if !valid_metadata(d.provider, d.model, d.origin, d.preview_sha)
        || d.labels.is_empty()
        || d.labels.len() > 8
        || d.labels
            .iter()
            .any(|s| !super::super::semantic_search::valid_term(s))
    {
        return Err(rusqlite::Error::InvalidQuery);
    }
    if !tx
        .prepare("SELECT 1 FROM revision WHERE asset=?1 AND version=1 AND digest=?2")?
        .exists(params![d.asset, d.digest])?
    {
        return Err(rusqlite::Error::InvalidQuery);
    }
    ensure_schema(tx)?;
    if slot(tx, d.asset, d.digest, false)?.as_deref() != previous {
        return Err(rusqlite::Error::InvalidQuery);
    }
    tx.execute(
        "DELETE FROM vision_annotation WHERE asset=?1 AND digest=?2 AND approved=0",
        params![d.asset, d.digest],
    )?;
    let id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO vision_annotation VALUES(?1,?2,?3,?4,?5,?6,?7,unixepoch(),0)",
        params![
            id,
            d.asset,
            d.digest,
            d.preview_sha,
            d.provider,
            d.model,
            d.origin
        ],
    )?;
    for label in d.labels {
        tx.execute(
            "INSERT OR IGNORE INTO vision_annotation_label VALUES(?1,?2)",
            params![id, label],
        )?;
    }
    Ok(())
}

pub fn review(
    tx: &Transaction,
    asset: i64,
    digest: &str,
    id: &str,
    selected: Option<&[String]>,
    old_approved: Option<&str>,
) -> rusqlite::Result<()> {
    if !present(tx)? {
        return Err(rusqlite::Error::InvalidQuery);
    }
    let old = slot(tx, asset, digest, true)?;
    if old.as_deref() != old_approved {
        return Err(rusqlite::Error::InvalidQuery);
    }
    let pending = slot(tx, asset, digest, false)?;
    if let Some(chosen) = selected {
        if pending.as_deref() != Some(id) {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let available = labels(tx, id)?;
        if chosen.is_empty() || chosen.len() > 8 || chosen.iter().any(|s| !available.contains(s)) {
            return Err(rusqlite::Error::InvalidQuery);
        }
        for label in available {
            if !chosen.contains(&label) {
                tx.execute(
                    "DELETE FROM vision_annotation_label WHERE annotation=?1 AND label=?2",
                    params![id, label],
                )?;
            }
        }
        tx.execute("DELETE FROM vision_annotation WHERE id=?1", [old])?;
        tx.execute(
            "UPDATE vision_annotation SET approved=1,reviewed_at=unixepoch() WHERE id=?1",
            [id],
        )?;
    } else {
        if old.as_deref() != Some(id) && pending.as_deref() != Some(id) {
            return Err(rusqlite::Error::InvalidQuery);
        }
        tx.execute("DELETE FROM vision_annotation WHERE id=?1", [id])?;
    }
    Ok(())
}

fn valid_metadata(provider: &str, model: &str, origin: &str, sha: &str) -> bool {
    [provider, model]
        .iter()
        .all(|s| !s.is_empty() && s.len() <= 256 && !s.chars().any(char::is_control))
        && sha.len() == 64
        && sha.bytes().all(|b| b.is_ascii_hexdigit())
        && reqwest::Url::parse(origin).is_ok_and(|url| {
            matches!(url.scheme(), "http" | "https") && url.origin().ascii_serialization() == origin
        })
}

pub fn validate_snapshot(db: &Connection) -> rusqlite::Result<()> {
    let mut stmt = db.prepare(
        "SELECT j.id,j.provider,j.model,j.endpoint_origin,j.preview_sha,
      EXISTS(SELECT 1 FROM revision r WHERE r.asset=j.asset AND r.version=1 AND r.digest=j.digest)
      FROM vision_annotation j",
    )?;
    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        let id: String = r.get(0)?;
        if Uuid::parse_str(&id).is_err()
            || !r.get::<_, bool>(5)?
            || !valid_metadata(
                &r.get::<_, String>(1)?,
                &r.get::<_, String>(2)?,
                &r.get::<_, String>(3)?,
                &r.get::<_, String>(4)?,
            )
        {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let values = labels(db, &id)?;
        if values.is_empty()
            || values.len() > 8
            || values
                .iter()
                .any(|s| !super::super::semantic_search::valid_term(s))
        {
            return Err(rusqlite::Error::InvalidQuery);
        }
    }
    Ok(())
}
