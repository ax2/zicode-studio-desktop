//! Read-only, reproducible request preparation. A preview is not permission to send.
use super::{chapter, read_chapter};
use crate::visual_assets::novel_model_source::INSTRUCTIONS;
use crate::{
    model_tools,
    notes_vault::NotesVault,
    visual_assets::{characters, novel_drafts::Evidence, Result},
};
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;

const MAX_PROMPT_BYTES: usize = 32 * 1024;
const MAX_OUTPUT_TOKENS: u32 = 2048;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Input {
    character_id: String,
    facet: characters::Facet,
    base_version: Option<i64>,
    evidence: Evidence,
    provider: String,
    model: String,
}

pub(super) fn preview(
    db: &Connection,
    notes: &NotesVault,
    workspace: &str,
    scene: &str,
    config_root: &Path,
    input: Input,
) -> Result<Value> {
    if input.evidence.workspace_id != workspace {
        return Err("visual_assets_chapter_access_denied".into());
    }
    for selection in [&input.provider, &input.model] {
        if selection.trim().is_empty()
            || selection.len() > 256
            || selection.chars().any(char::is_control)
        {
            return Err("visual_assets_model_selection_required".into());
        }
    }
    let character = characters::get(db, &input.character_id)?;
    if characters::latest(db, &input.character_id, input.facet)? != input.base_version {
        return Err("visual_assets_character_revision_changed".into());
    }
    let note = read_chapter(
        notes,
        &input.evidence.notebook_id,
        &input.evidence.chapter_id,
    )?;
    chapter(&note, workspace).verify(&input.evidence)?;
    let approved: Option<String> = input
        .base_version
        .map(|version| {
            db.query_row(
            "SELECT text FROM character_revision WHERE character_id=?1 AND facet=?2 AND version=?3",
            params![input.character_id, input.facet.key(), version],
            |row| row.get(0),
        )
        })
        .transpose()?;
    let material = json!({
        "character": character.name,
        "facet": input.facet,
        "approvedSetting": approved,
        "chapterTitle": note.summary.title,
        "excerpt": input.evidence.quote,
    });
    let prompt = format!("{INSTRUCTIONS}{}", serde_json::to_string_pretty(&material)?);
    if prompt.len() > MAX_PROMPT_BYTES {
        return Err("visual_assets_model_input_too_large".into());
    }
    let endpoint = model_tools::resolve(
        config_root,
        scene,
        Some(&input.provider),
        Some(&input.model),
    )
    .map_err(|_| "visual_assets_model_selection_unavailable")?;
    let library: String = db.query_row("SELECT id FROM library", [], |row| row.get(0))?;
    let mut plan = json!({
        "schemaVersion": 1,
        "libraryId": library,
        "sceneId": scene,
        "characterId": input.character_id,
        "facet": input.facet,
        "baseVersion": input.base_version,
        "evidence": input.evidence,
        "model": endpoint.choice,
        "endpointIdentity": endpoint.request_identity(),
        "prompt": prompt,
        "promptBytes": prompt.len(),
        "maxPromptBytes": MAX_PROMPT_BYTES,
        "maxOutputTokens": MAX_OUTPUT_TOKENS,
        "maxResultCharacters": 4000,
        "timeoutSeconds": 120,
        "estimatedCost": null,
    });
    let digest = format!("{:x}", Sha256::digest(serde_json::to_vec(&plan)?));
    plan["digest"] = json!(digest);
    Ok(plan)
}

#[cfg(test)]
#[path = "novel_model_plan_tests.rs"]
mod tests;
