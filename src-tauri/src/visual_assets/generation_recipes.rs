//! A saved version pins the exact character inputs for a future generation attempt.
use super::{characters, Result};
use rusqlite::{params, Connection, Row, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use uuid::Uuid;

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS generation_recipe(
    id TEXT PRIMARY KEY CHECK(length(id)=36), character_id TEXT NOT NULL REFERENCES character(id),
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80), UNIQUE(id,character_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS generation_recipe_character ON generation_recipe(character_id,id);
CREATE TABLE IF NOT EXISTS generation_recipe_revision(
    recipe_id TEXT NOT NULL, character_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
    identity_version INTEGER NOT NULL, appearance_version INTEGER, style_version INTEGER,
    identity_facet TEXT GENERATED ALWAYS AS ('identity') VIRTUAL,
    appearance_facet TEXT GENERATED ALWAYS AS ('appearance') VIRTUAL,
    style_facet TEXT GENERATED ALWAYS AS ('style') VIRTUAL,
    reference_set_id INTEGER REFERENCES character_reference_set(id),
    prompt TEXT NOT NULL CHECK(length(prompt)<=8000), negative_prompt TEXT NOT NULL CHECK(length(negative_prompt)<=8000),
    settings TEXT NOT NULL CHECK(length(CAST(settings AS BLOB)) BETWEEN 2 AND 16384),
    PRIMARY KEY(recipe_id,version),
    FOREIGN KEY(recipe_id,character_id) REFERENCES generation_recipe(id,character_id),
    FOREIGN KEY(character_id,identity_facet,identity_version) REFERENCES character_revision(character_id,facet,version),
    FOREIGN KEY(character_id,appearance_facet,appearance_version) REFERENCES character_revision(character_id,facet,version),
    FOREIGN KEY(character_id,style_facet,style_version) REFERENCES character_revision(character_id,facet,version)
) WITHOUT ROWID;";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Draft {
    identity_version: i64,
    appearance_version: Option<i64>,
    style_version: Option<i64>,
    reference_set_id: Option<i64>,
    #[serde(default)]
    prompt: String,
    #[serde(default)]
    negative_prompt: String,
    #[serde(default = "empty_settings")]
    settings_json: String,
}

fn empty_settings() -> String {
    "{}".to_string()
}

#[derive(Serialize)]
pub(super) struct Recipe {
    id: String,
    name: String,
}

#[derive(Serialize)]
pub(super) struct Version {
    version: i64,
    draft: Draft,
}

const VERSION_COLUMNS: &str = "version, identity_version, appearance_version, style_version, reference_set_id, prompt, negative_prompt, settings";

pub(super) fn schema_present(db: &Connection) -> rusqlite::Result<bool> {
    db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='generation_recipe'")?
        .exists([])
}

pub(super) fn list(
    db: &Connection,
    character: &str,
    after: Option<&str>,
) -> Result<(Vec<Recipe>, Option<String>)> {
    characters::get(db, character)?;
    if let Some(after) = after {
        Uuid::parse_str(after)?;
    }
    if !schema_present(db)? {
        return Ok((Vec::new(), None));
    }
    let mut stmt = db.prepare("SELECT id,name FROM generation_recipe WHERE character_id=?1 AND id>?2 ORDER BY id LIMIT 51")?;
    let mut entries = stmt
        .query_map(params![character, after.unwrap_or_default()], |row| {
            Ok(Recipe {
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

fn check_recipe(db: &Connection, character: &str, recipe: &str) -> Result<()> {
    Uuid::parse_str(recipe)?;
    if !schema_present(db)?
        || !db
            .prepare("SELECT 1 FROM generation_recipe WHERE id=?1 AND character_id=?2")?
            .exists(params![recipe, character])?
    {
        return Err("visual_assets_recipe_missing".into());
    }
    Ok(())
}

fn decode(row: &Row<'_>) -> rusqlite::Result<Version> {
    Ok(Version {
        version: row.get(0)?,
        draft: Draft {
            identity_version: row.get(1)?,
            appearance_version: row.get(2)?,
            style_version: row.get(3)?,
            reference_set_id: row.get(4)?,
            prompt: row.get(5)?,
            negative_prompt: row.get(6)?,
            settings_json: row.get(7)?,
        },
    })
}

pub(super) fn versions(
    db: &Connection,
    character: &str,
    recipe: &str,
    before: Option<i64>,
) -> Result<(Vec<Version>, Option<i64>)> {
    check_recipe(db, character, recipe)?;
    let mut stmt = db.prepare(&format!("SELECT {VERSION_COLUMNS} FROM generation_recipe_revision WHERE recipe_id=?1 AND version<=?2 ORDER BY version DESC LIMIT 11"))?;
    let mut entries = stmt
        .query_map(params![recipe, before.unwrap_or(i64::MAX)], decode)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let next = if entries.len() > 10 {
        entries.pop().map(|entry| entry.version)
    } else {
        None
    };
    Ok((entries, next))
}

fn character_text(db: &Connection, character: &str, facet: &str, version: i64) -> Result<String> {
    Ok(db.query_row(
        "SELECT text FROM character_revision WHERE character_id=?1 AND facet=?2 AND version=?3",
        params![character, facet, version],
        |row| row.get(0),
    )?)
}

pub(super) fn resolve(
    db: &Connection,
    character: &str,
    recipe: &str,
    version: i64,
) -> Result<Value> {
    check_recipe(db, character, recipe)?;
    let stored = db.query_row(&format!("SELECT {VERSION_COLUMNS} FROM generation_recipe_revision WHERE recipe_id=?1 AND version=?2"),params![recipe,version],decode)?;
    let draft = &stored.draft;
    let identity = character_text(db, character, "identity", draft.identity_version)?;
    let appearance = draft
        .appearance_version
        .map(|version| character_text(db, character, "appearance", version))
        .transpose()?;
    let style = draft
        .style_version
        .map(|version| character_text(db, character, "style", version))
        .transpose()?;
    let reference_set = draft
        .reference_set_id
        .map(|id| characters::references::find(db, character, id))
        .transpose()?;
    Ok(
        json!({"recipe":stored,"identity":identity,"appearance":appearance,"style":style,"referenceSet":reference_set}),
    )
}

pub(super) fn create(
    tx: &Transaction<'_>,
    character: &str,
    name: &str,
    draft: &Draft,
) -> Result<String> {
    characters::get(tx, character)?;
    let name = characters::name(name)?;
    tx.execute_batch(SCHEMA)?;
    let id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO generation_recipe VALUES (?1,?2,?3)",
        params![id, character, name],
    )?;
    insert(tx, character, &id, 1, draft)?;
    Ok(id)
}

pub(super) fn append(
    tx: &Transaction<'_>,
    character: &str,
    recipe: &str,
    previous: i64,
    draft: &Draft,
) -> Result<i64> {
    check_recipe(tx, character, recipe)?;
    let latest: i64 = tx.query_row(
        "SELECT MAX(version) FROM generation_recipe_revision WHERE recipe_id=?1",
        [recipe],
        |row| row.get(0),
    )?;
    if latest != previous {
        return Err("visual_assets_recipe_version_changed".into());
    }
    let version = latest.checked_add(1).ok_or("invalid recipe version")?;
    insert(tx, character, recipe, version, draft)?;
    Ok(version)
}

fn insert(
    tx: &Transaction<'_>,
    character: &str,
    recipe: &str,
    version: i64,
    draft: &Draft,
) -> Result<()> {
    if draft.settings_json.len() > 16384
        || serde_json::from_str::<Map<String, Value>>(&draft.settings_json).is_err()
        || [&draft.prompt, &draft.negative_prompt]
            .iter()
            .any(|value| value.contains('\0') || value.chars().take(8001).count() > 8000)
    {
        return Err("visual_assets_recipe_settings_invalid".into());
    }
    if let Some(id) = draft.reference_set_id {
        if !tx
            .prepare("SELECT 1 FROM character_reference_set WHERE id=?1 AND character_id=?2")?
            .exists(params![id, character])?
        {
            return Err("visual_assets_recipe_inputs_invalid".into());
        }
    }
    tx.execute("INSERT INTO generation_recipe_revision(recipe_id,character_id,version,identity_version,appearance_version,style_version,reference_set_id,prompt,negative_prompt,settings)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![recipe,character,version,draft.identity_version,draft.appearance_version,draft.style_version,draft.reference_set_id,draft.prompt,draft.negative_prompt,draft.settings_json])
        .map_err(|error| match error {
            rusqlite::Error::SqliteFailure(code,_) if code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY => Box::<dyn std::error::Error>::from("visual_assets_recipe_inputs_invalid"),
            other => other.into(),
        })?;
    Ok(())
}

pub(super) fn validate_snapshot(db: &Connection) -> rusqlite::Result<()> {
    let invalid = db.prepare("SELECT 1 FROM generation_recipe r WHERE NOT EXISTS(
        SELECT 1 FROM generation_recipe_revision v WHERE v.recipe_id=r.id AND v.version=1
    ) UNION ALL SELECT 1 FROM generation_recipe_revision v
    WHERE (CASE WHEN json_valid(v.settings) THEN json_type(v.settings)<>'object' ELSE 1 END)
       OR EXISTS(SELECT 1 FROM character_reference_set s WHERE s.id=v.reference_set_id AND s.character_id<>v.character_id)
    LIMIT 1")?.exists([])?;
    if invalid {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(())
}
