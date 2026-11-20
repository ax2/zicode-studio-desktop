use super::{
    comfyui::{Comfy, Output, Submission},
    generation_dispatch::{self, Lease},
    generation_outputs::{self, Archived},
    generation_recipes,
    generation_usage::{self, Budget, Execution, LOCAL_BUDGET, LOCAL_PROVIDER_CHARGE},
    generation_workflow::{self, Inputs},
    imports, Result,
};
use rusqlite::{params, Connection, Row, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};
use uuid::Uuid;

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS generation_attempt(
    id TEXT PRIMARY KEY CHECK(length(id)=36), recipe_id TEXT NOT NULL, recipe_version INTEGER NOT NULL,
    port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
    state TEXT NOT NULL CHECK(state IN ('submitting','unknown','submitted','queued','running','rejected','upload_failed','ready','failed','no_output')),
    prompt_id TEXT CHECK(length(prompt_id)=36), intent TEXT NOT NULL, outputs TEXT NOT NULL DEFAULT '[]',
    sequence INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL,
    FOREIGN KEY(recipe_id,recipe_version) REFERENCES generation_recipe_revision(recipe_id,version)
);
CREATE INDEX IF NOT EXISTS generation_attempt_recipe ON generation_attempt(recipe_id,recipe_version,created);
CREATE UNIQUE INDEX IF NOT EXISTS generation_attempt_active ON generation_attempt(recipe_id,recipe_version)
  WHERE state IN ('submitting','unknown','submitted','queued','running');";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Selection {
    pub(super) character_id: String,
    pub(super) recipe_id: String,
    pub(super) version: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Plan {
    pub(super) selection: Selection,
    pub(super) port: u16,
    pub(super) inputs: Inputs,
    budget: Budget,
}

impl Plan {
    pub(super) fn load(db: &Connection, selection: Selection, port: u16) -> Result<Self> {
        if port == 0 {
            return Err("visual_assets_comfy_endpoint_invalid".into());
        }
        let inputs = generation_workflow::inputs(generation_recipes::resolve(
            db,
            &selection.character_id,
            &selection.recipe_id,
            selection.version,
        )?)?;
        Ok(Self {
            selection,
            port,
            inputs,
            budget: LOCAL_BUDGET,
        })
    }

    pub(super) fn check_provider(&self) -> Result<()> {
        let placeholders = vec!["zicode/reference.png".to_string(); self.inputs.references.len()];
        Comfy::new(self.port)?.capabilities(
            &self.inputs,
            &generation_workflow::graph(&self.inputs, &placeholders, "preview")?,
        )
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Attempt {
    id: String,
    port: u16,
    state: String,
    prompt_id: Option<String>,
    outputs: Vec<Output>,
    archived: Vec<Archived>,
    interrupted_before_submit: bool,
    provider_fee: u32,
    execution_usage: Option<Execution>,
    #[serde(skip)]
    sequence: i64,
}

pub(super) struct Prepared {
    id: Uuid,
    port: u16,
    graph: Map<String, Value>,
    uploads: Vec<(String, Vec<u8>)>,
    lease: Lease,
}

pub(super) fn schema_present(db: &Connection) -> rusqlite::Result<bool> {
    db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='generation_attempt'")?
        .exists([])
}

pub(super) fn check_library(db: &Connection, expected: &str) -> Result<()> {
    let actual: String = db.query_row("SELECT id FROM library", [], |row| row.get(0))?;
    if actual != expected {
        return Err("visual_assets_library_changed".into());
    }
    Ok(())
}

pub(super) fn begin(
    db: &mut Connection,
    library: &Path,
    expected: &str,
    id: Uuid,
    plan: Plan,
) -> Result<(Attempt, Prepared)> {
    check_library(db, expected)?;
    let lease = Lease::try_acquire(library)?.ok_or("visual_assets_comfy_dispatch_busy")?;
    if schema_present(db)? {
        lease.recover(db)?;
    }
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    imports::recover(&tx, library)?;
    tx.execute_batch(SCHEMA)?;
    if tx
        .prepare(
            "SELECT 1 FROM generation_attempt WHERE recipe_id=?1 AND recipe_version=?2
        AND state IN ('submitting','unknown','submitted','queued','running')",
        )?
        .exists(params![plan.selection.recipe_id, plan.selection.version])?
    {
        return Err("visual_assets_comfy_attempt_active".into());
    }
    let mut uploads = Vec::new();
    let mut total_bytes = 0;
    for (index, reference) in plan.inputs.references.iter().enumerate() {
        if super::reference_catalog::is_reference(&tx, reference.asset_id, reference.revision)?
            && !super::reference_catalog::is_archived(&tx, reference.asset_id, reference.revision)?
        {
            return Err("visual_assets_comfy_reference_unavailable".into());
        }
        let bytes = imports::read_original(&tx, library, reference.asset_id, reference.revision)?;
        total_bytes += bytes.len();
        if total_bytes > 64 * 1024 * 1024
            || format!("{:x}", Sha256::digest(&bytes)) != reference.sha256
        {
            return Err("visual_assets_comfy_reference_unavailable".into());
        }
        let extension = match image::guess_format(&bytes)? {
            image::ImageFormat::Png => "png",
            image::ImageFormat::Jpeg => "jpg",
            image::ImageFormat::WebP => "webp",
            _ => return Err("visual_assets_comfy_reference_unavailable".into()),
        };
        uploads.push((format!("{id}-{index}.{extension}"), bytes));
    }
    let files: Vec<_> = uploads
        .iter()
        .map(|(name, _)| format!("zicode/{name}"))
        .collect();
    let graph = generation_workflow::graph(&plan.inputs, &files, &id.to_string())?;
    let intent = serde_json::to_string(&json!({
        "plan":plan,"graph":graph,"preSubmitLease":lease.identity,"providerFee":LOCAL_PROVIDER_CHARGE,
    }))?;
    tx.execute(
        "INSERT INTO generation_attempt(id,recipe_id,recipe_version,port,state,intent,created)
        VALUES (?1,?2,?3,?4,'submitting',?5,unixepoch('now'))",
        params![
            id.to_string(),
            plan.selection.recipe_id,
            plan.selection.version,
            plan.port,
            intent
        ],
    )?;
    let attempt = get(&tx, &id.to_string())?;
    tx.commit()?;
    Ok((
        attempt,
        Prepared {
            id,
            port: plan.port,
            graph,
            uploads,
            lease,
        },
    ))
}

fn decode(row: &Row<'_>) -> rusqlite::Result<Attempt> {
    let outputs: String = row.get(4)?;
    let outputs = serde_json::from_str(&outputs).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let state: String = row.get(2)?;
    let prompt_id: Option<String> = row.get(3)?;
    let execution_usage = decode_usage(&state, prompt_id.as_deref(), row.get(7)?)?;
    Ok(Attempt {
        id: row.get(0)?,
        port: row.get(1)?,
        state,
        prompt_id,
        outputs,
        archived: Vec::new(),
        sequence: row.get(5)?,
        interrupted_before_submit: row.get(6)?,
        provider_fee: row.get(8)?,
        execution_usage,
    })
}

const COLUMNS: &str = "id,port,state,prompt_id,outputs,sequence,
    COALESCE(json_extract(intent,'$.interruptedBeforeSubmit'),0), json_extract(intent,'$.executionUsage'),
    COALESCE(json_extract(intent,'$.providerFee'),0)";

fn decode_usage(
    state: &str,
    prompt: Option<&str>,
    json: Option<String>,
) -> rusqlite::Result<Option<Execution>> {
    let Some(json) = json else { return Ok(None) };
    let usage: Execution =
        serde_json::from_str(&json).map_err(|_| rusqlite::Error::InvalidQuery)?;
    if !usage.valid_for(state) || !prompt.is_some_and(|id| Uuid::parse_str(id).is_ok()) {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(Some(usage))
}

fn get(db: &Connection, id: &str) -> Result<Attempt> {
    let mut entry = db.query_row(
        &format!("SELECT {COLUMNS} FROM generation_attempt WHERE id=?1"),
        [id],
        decode,
    )?;
    entry.archived = generation_outputs::archived(db, id)?;
    Ok(entry)
}

pub(super) fn list(
    db: &Connection,
    library: &Path,
    expected: &str,
    selection: &Selection,
) -> Result<Vec<Attempt>> {
    check_library(db, expected)?;
    if !schema_present(db)? {
        return Ok(Vec::new());
    }
    generation_dispatch::recover_if_idle(db, library)?;
    let mut stmt = db.prepare(&format!("SELECT {COLUMNS} FROM generation_attempt WHERE recipe_id=?1 AND recipe_version=?2
        AND EXISTS(SELECT 1 FROM generation_recipe r WHERE r.id=?1 AND r.character_id=?3) ORDER BY created DESC,rowid DESC LIMIT 10"))?;
    let entries = stmt.query_map(
        params![
            selection.recipe_id,
            selection.version,
            selection.character_id
        ],
        decode,
    )?;
    let mut entries = entries.collect::<rusqlite::Result<Vec<_>>>()?;
    for entry in &mut entries {
        entry.archived = generation_outputs::archived(db, &entry.id)?;
    }
    Ok(entries)
}

fn connect(library: &Path, expected: &str) -> Result<Connection> {
    let db = Connection::open_with_flags(
        library.join("catalog.sqlite"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE,
    )?;
    db.busy_timeout(Duration::from_secs(3))?;
    db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")?;
    check_library(&db, expected)?;
    Ok(db)
}

pub(super) fn run(
    library: &Path,
    expected: &str,
    prepared: Prepared,
    checkpoint: &impl Fn(&str),
) -> Result<Attempt> {
    let Prepared {
        id,
        port,
        graph,
        uploads,
        lease: _lease,
    } = prepared;
    checkpoint("comfy-before-upload");
    let upload = || -> Result<Comfy> {
        let client = Comfy::new(port)?;
        for (name, bytes) in uploads {
            client.upload(&name, bytes)?;
            checkpoint("comfy-reference-uploaded");
        }
        Ok(client)
    };
    let key = id.to_string();
    let client = match upload() {
        Ok(client) => client,
        Err(_) => {
            let db = connect(library, expected)?;
            db.execute(
                "UPDATE generation_attempt SET state='upload_failed',sequence=sequence+1
                        WHERE id=?1 AND state='submitting'",
                [&key],
            )?;
            return get(&db, &key);
        }
    };
    // Commit the uncertainty boundary before opening the prompt request.
    let changed = connect(library, expected)?.execute(
        "UPDATE generation_attempt SET state='unknown',sequence=sequence+1
         WHERE id=?1 AND state='submitting'",
        [&key],
    )?;
    if changed != 1 {
        return Err("visual_assets_comfy_dispatch_changed".into());
    }
    checkpoint("comfy-before-prompt");
    let submission = client.submit(id, &graph);
    checkpoint("comfy-prompt-returned");
    let (state, prompt) = match submission {
        Ok(Submission::Accepted(prompt)) => ("submitted", Some(prompt.to_string())),
        Ok(Submission::Rejected) => ("rejected", None),
        Err(_) => return get(&connect(library, expected)?, &key),
    };
    let db = connect(library, expected)?;
    db.execute(
        "UPDATE generation_attempt SET state=?2,prompt_id=?3,sequence=sequence+1
        WHERE id=?1 AND state='unknown' AND prompt_id IS NULL",
        params![key, state, prompt],
    )?;
    get(&db, &key)
}

pub(super) fn refresh(library: &Path, expected: &str, id: Uuid) -> Result<Attempt> {
    let key = id.to_string();
    let db = connect(library, expected)?;
    let mut entry = get(&db, &key)?;
    if entry.state == "submitting" {
        generation_dispatch::recover_if_idle(&db, library)?;
        entry = get(&db, &key)?;
    }
    drop(db);
    let known = entry
        .prompt_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()?;
    if generation_usage::terminal(&entry.state) {
        if let Some(prompt) = known.filter(|_| entry.execution_usage.is_none()) {
            if let Some(usage) = Comfy::new(entry.port)?
                .history(id, Some(prompt))?
                .and_then(|observation| observation.execution_usage)
                .filter(|usage| usage.valid_for(&entry.state))
            {
                let db = connect(library, expected)?;
                db.execute("UPDATE generation_attempt SET intent=json_set(intent,'$.executionUsage',json(?2)),sequence=sequence+1
                    WHERE id=?1 AND sequence=?3", params![key,serde_json::to_string(&usage)?,entry.sequence])?;
                return get(&db, &key);
            }
        }
        return Ok(entry);
    }
    if !matches!(
        entry.state.as_str(),
        "unknown" | "submitted" | "queued" | "running"
    ) {
        return Ok(entry);
    }
    let observed = Comfy::new(entry.port)?.observe(id, known)?;
    let (state, prompt, outputs, execution_usage) = match observed {
        Some(value) => (
            value.state,
            Some(value.prompt_id.to_string()),
            value.outputs,
            value.execution_usage,
        ),
        None => ("unknown", entry.prompt_id, Vec::new(), None),
    };
    let usage = execution_usage
        .map(|usage| serde_json::to_string(&usage))
        .transpose()?;
    let db = connect(library, expected)?;
    db.execute("UPDATE generation_attempt SET state=?2,prompt_id=?3,outputs=?4,sequence=sequence+1,
               intent=CASE WHEN ?6 IS NULL THEN intent ELSE json_set(intent,'$.executionUsage',json(?6)) END
               WHERE id=?1 AND sequence=?5",
        params![key,state,prompt,serde_json::to_string(&outputs)?,entry.sequence,usage])?;
    get(&db, &key)
}

pub(super) fn validate_snapshot(db: &Connection) -> rusqlite::Result<()> {
    let invalid = db
        .prepare(
            "SELECT 1 FROM generation_attempt
        WHERE NOT json_valid(intent) OR NOT json_valid(outputs)
           OR (CASE WHEN json_valid(outputs) THEN json_type(outputs)<>'array' ELSE 0 END)
           OR (CASE WHEN json_valid(intent) AND json_type(intent,'$.plan.budget') IS NOT NULL
                    THEN json_type(intent,'$.plan.budget.providerFeeLimit') IS NOT 'integer'
                       OR json_extract(intent,'$.plan.budget.providerFeeLimit') <> 0 ELSE 0 END)
           OR (CASE WHEN json_valid(intent) AND json_type(intent,'$.providerFee') IS NOT NULL
                    THEN json_type(intent,'$.providerFee') IS NOT 'integer'
                       OR json_extract(intent,'$.providerFee') <> 0 ELSE 0 END)
        LIMIT 1",
        )?
        .exists([])?;
    if invalid {
        return Err(rusqlite::Error::InvalidQuery);
    }
    let mut statement = db.prepare(
        "SELECT state,prompt_id,json_extract(intent,'$.executionUsage')
        FROM generation_attempt WHERE json_type(intent,'$.executionUsage') IS NOT NULL",
    )?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let state: String = row.get(0)?;
        let prompt: Option<String> = row.get(1)?;
        if decode_usage(&state, prompt.as_deref(), row.get(2)?)?.is_none() {
            return Err(rusqlite::Error::InvalidQuery);
        }
    }
    Ok(())
}
