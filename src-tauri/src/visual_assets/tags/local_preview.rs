//! Reviewed labels derived from the local thumbnail. Manual tags use a separate table.
use super::super::catalog::Page;
use rusqlite::{params, Connection, Transaction};

pub const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS local_preview_label_v1(
    asset INTEGER NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
    digest TEXT NOT NULL, label TEXT NOT NULL CHECK (label IN ('Landscape','Portrait','Square','Light tones','Dark tones','Mid tones')),
    PRIMARY KEY(asset,digest,label)) WITHOUT ROWID;
    CREATE UNIQUE INDEX IF NOT EXISTS preview_orientation ON local_preview_label_v1(asset,digest) WHERE label IN ('Landscape','Portrait','Square');
    CREATE UNIQUE INDEX IF NOT EXISTS preview_brightness ON local_preview_label_v1(asset,digest) WHERE label IN ('Light tones','Dark tones','Mid tones');";

pub fn present(db: &Connection) -> rusqlite::Result<bool> {
    db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='local_preview_label_v1'")?
        .exists([])
}

#[cfg(windows)]
pub fn validate_snapshot(db: &Connection) -> rusqlite::Result<()> {
    if db.prepare("SELECT 1 FROM local_preview_label_v1 l WHERE NOT EXISTS (SELECT 1 FROM revision r WHERE r.asset=l.asset AND r.version=1 AND r.digest=l.digest)")?.exists([])? {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(())
}

pub fn fill(db: &Connection, page: &mut Page) -> rusqlite::Result<()> {
    if !present(db)? {
        return Ok(());
    }
    let mut stmt = db.prepare_cached(
        "SELECT label FROM local_preview_label_v1 WHERE asset=?1 AND digest=?2 ORDER BY label",
    )?;
    for asset in &mut page.assets {
        asset.preview_labels = stmt
            .query_map(params![asset.id, asset.digest], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
    }
    Ok(())
}

pub fn replace(
    tx: &Transaction,
    asset: i64,
    digest: &str,
    mut previous: Vec<String>,
    mut labels: Vec<String>,
) -> Result<(), &'static str> {
    for list in [&mut previous, &mut labels] {
        if list.len() > 2
            || list.iter().any(|s| {
                !matches!(
                    s.as_str(),
                    "Landscape"
                        | "Portrait"
                        | "Square"
                        | "Light tones"
                        | "Dark tones"
                        | "Mid tones"
                )
            })
        {
            return Err("visual_assets_invalid_tags");
        }
        list.sort();
        list.dedup();
    }
    let apply = || -> rusqlite::Result<bool> {
        if !tx
            .prepare("SELECT 1 FROM revision WHERE asset=?1 AND version=1 AND digest=?2")?
            .exists(params![asset, digest])?
        {
            return Ok(false);
        }
        tx.execute_batch(SCHEMA)?;
        let mut stmt = tx.prepare_cached(
            "SELECT label FROM local_preview_label_v1 WHERE asset=?1 AND digest=?2 ORDER BY label",
        )?;
        let current = stmt
            .query_map(params![asset, digest], |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
        if current != previous {
            return Ok(false);
        }
        tx.execute(
            "DELETE FROM local_preview_label_v1 WHERE asset=?1 AND digest=?2",
            params![asset, digest],
        )?;
        for label in labels {
            tx.execute(
                "INSERT INTO local_preview_label_v1 VALUES (?1,?2,?3)",
                params![asset, digest, label],
            )?;
        }
        Ok(true)
    };
    if apply().map_err(|_| "visual_assets_tag_save_failed")? {
        Ok(())
    } else {
        Err("visual_assets_tags_changed")
    }
}
