use super::Result;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[path = "character_references.rs"]
pub(super) mod references;

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS character(
    id TEXT PRIMARY KEY CHECK(length(id)=36), name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS character_revision(
    character_id TEXT NOT NULL REFERENCES character(id), facet TEXT NOT NULL CHECK(facet IN ('identity','appearance','style')),
    version INTEGER NOT NULL CHECK(version>0), text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 4000),
    PRIMARY KEY(character_id,facet,version)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS character_reference_set(
    id INTEGER PRIMARY KEY, character_id TEXT NOT NULL REFERENCES character(id),
    request_id TEXT NOT NULL UNIQUE CHECK(length(request_id)=36),
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80)
);
CREATE INDEX IF NOT EXISTS character_reference_owner ON character_reference_set(character_id,id);
CREATE TABLE IF NOT EXISTS character_reference_item(
    set_id INTEGER NOT NULL REFERENCES character_reference_set(id), position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 7),
    asset INTEGER NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(set_id,position), UNIQUE(set_id,asset,revision),
    FOREIGN KEY(asset,revision) REFERENCES revision(asset,version)
) WITHOUT ROWID;";

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Facet {
    Identity,
    Appearance,
    Style,
}

impl Facet {
    pub(super) fn key(self) -> &'static str {
        match self {
            Self::Identity => "identity",
            Self::Appearance => "appearance",
            Self::Style => "style",
        }
    }

    pub(super) fn from_key(key: &str) -> rusqlite::Result<Self> {
        match key {
            "identity" => Ok(Self::Identity),
            "appearance" => Ok(Self::Appearance),
            "style" => Ok(Self::Style),
            _ => Err(rusqlite::Error::InvalidQuery),
        }
    }
}

#[derive(Serialize)]
pub(super) struct Summary {
    id: String,
    pub(super) name: String,
}

#[derive(Serialize)]
pub(super) struct Revision {
    version: i64,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    manuscript: Option<super::novel_drafts::Evidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<super::novel_model_source::Summary>,
}

pub(super) fn schema_present(db: &Connection) -> rusqlite::Result<bool> {
    db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='character'")?
        .exists([])
}

pub(super) fn has_records(db: &Connection) -> rusqlite::Result<bool> {
    Ok(schema_present(db)? && db.prepare("SELECT 1 FROM character LIMIT 1")?.exists([])?)
}

pub(super) fn name(value: &str) -> Result<&str> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().take(81).count() > 80
        || value.chars().any(char::is_control)
    {
        return Err("visual_assets_character_name_invalid".into());
    }
    Ok(value)
}

pub(super) fn description(value: &str) -> Result<&str> {
    let value = value.trim();
    if value.is_empty() || value.chars().take(4001).count() > 4000 || value.contains('\0') {
        return Err("visual_assets_character_text_invalid".into());
    }
    Ok(value)
}

pub(super) fn list(db: &Connection, after: Option<&str>) -> Result<(Vec<Summary>, Option<String>)> {
    if let Some(after) = after {
        Uuid::parse_str(after)?;
    }
    if !schema_present(db)? {
        return Ok((Vec::new(), None));
    }
    let mut stmt = db.prepare("SELECT id,name FROM character WHERE id>?1 ORDER BY id LIMIT 51")?;
    let mut entries = stmt
        .query_map([after.unwrap_or_default()], |row| {
            Ok(Summary {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let next = if entries.len() > 50 {
        entries.pop();
        entries.last().map(|entry| entry.id.clone())
    } else {
        None
    };
    Ok((entries, next))
}

pub(super) fn get(db: &Connection, id: &str) -> Result<Summary> {
    Uuid::parse_str(id)?;
    if !schema_present(db)? {
        return Err("visual_assets_character_missing".into());
    }
    db.query_row("SELECT name FROM character WHERE id=?1", [id], |row| {
        Ok(Summary {
            id: id.to_string(),
            name: row.get(0)?,
        })
    })
    .optional()?
    .ok_or_else(|| "visual_assets_character_missing".into())
}

pub(super) fn create(tx: &Transaction<'_>, label: &str, identity: &str) -> Result<String> {
    let label = name(label)?;
    let identity = description(identity)?;
    tx.execute_batch(SCHEMA)?;
    let id = Uuid::new_v4().to_string();
    tx.execute("INSERT INTO character VALUES (?1,?2)", params![id, label])?;
    append(tx, &id, Facet::Identity, None, identity)?;
    Ok(id)
}

pub(super) fn append(
    tx: &Transaction<'_>,
    id: &str,
    facet: Facet,
    previous: Option<i64>,
    text: &str,
) -> Result<i64> {
    let text = description(text)?;
    let latest = latest(tx, id, facet)?;
    if latest != previous {
        return Err("visual_assets_character_revision_changed".into());
    }
    let version = latest
        .unwrap_or(0)
        .checked_add(1)
        .ok_or("invalid character version")?;
    tx.execute(
        "INSERT INTO character_revision VALUES (?1,?2,?3,?4)",
        params![id, facet.key(), version, text],
    )?;
    Ok(version)
}

pub(super) fn latest(db: &Connection, id: &str, facet: Facet) -> Result<Option<i64>> {
    get(db, id)?;
    Ok(db.query_row(
        "SELECT MAX(version) FROM character_revision WHERE character_id=?1 AND facet=?2",
        params![id, facet.key()],
        |row| row.get(0),
    )?)
}

pub(super) fn revisions(
    db: &Connection,
    id: &str,
    facet: Facet,
    before: Option<i64>,
) -> Result<(Vec<Revision>, Option<i64>)> {
    get(db, id)?;
    let mut stmt = db.prepare("SELECT version,text FROM character_revision WHERE character_id=?1 AND facet=?2 AND version<=?3 ORDER BY version DESC LIMIT 11")?;
    let mut entries = stmt
        .query_map(
            params![id, facet.key(), before.unwrap_or(i64::MAX)],
            |row| {
                Ok(Revision {
                    version: row.get(0)?,
                    text: row.get(1)?,
                    manuscript: None,
                    model: None,
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let next = if entries.len() > 10 {
        entries.pop().map(|revision| revision.version)
    } else {
        None
    };
    if super::novel_drafts::schema_present(db)? {
        for entry in &mut entries {
            entry.manuscript =
                super::novel_drafts::revision_evidence(db, id, facet, entry.version)?;
            entry.model = super::novel_drafts::revision_model(db, id, facet, entry.version)?;
        }
    }
    Ok((entries, next))
}

pub(super) fn validate_snapshot(db: &Connection) -> rusqlite::Result<()> {
    let invalid = db.prepare("SELECT 1 FROM character c WHERE NOT EXISTS(
        SELECT 1 FROM character_revision r WHERE r.character_id=c.id AND r.facet='identity' AND r.version=1
    ) UNION ALL SELECT 1 FROM character_reference_set s WHERE NOT EXISTS(
        SELECT 1 FROM character_reference_item i WHERE i.set_id=s.id
    ) UNION ALL SELECT 1 FROM character_reference_item i JOIN revision r ON r.asset=i.asset AND r.version=i.revision
    WHERE EXISTS(SELECT 1 FROM external_blob e WHERE e.digest=r.digest)
       OR (EXISTS(SELECT 1 FROM asset_reference a WHERE a.asset=i.asset AND a.version=i.revision)
        AND NOT EXISTS(SELECT 1 FROM archived_reference a WHERE a.asset=i.asset AND a.version=i.revision)) LIMIT 1")?.exists([])?;
    if invalid {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(())
}
