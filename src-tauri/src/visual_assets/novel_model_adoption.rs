use super::jobs::Store;
use crate::{
    notes_vault::NotesVault,
    visual_assets::{
        imports,
        novel_drafts::{self, Proposal},
        novel_model_archive as archive,
        novel_model_source::Source,
        Result,
    },
};
use rusqlite::{Connection, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Selection {
    job_id: Uuid,
    draft_id: Uuid,
    text: String,
}

pub(super) struct Context<'a> {
    pub(super) library: &'a Path,
    pub(super) store: &'a Store,
    pub(super) notes: &'a NotesVault,
    pub(super) workspace: &'a str,
    pub(super) scene: &'a str,
}

pub(super) fn adopt(
    db: &mut Connection,
    context: Context<'_>,
    selection: Selection,
) -> Result<Value> {
    adopt_checked(db, &context, &selection, &|_| Ok(()))
}

fn adopt_checked(
    db: &mut Connection,
    context: &Context<'_>,
    selection: &Selection,
    checkpoint: &impl Fn(&str) -> Result<()>,
) -> Result<Value> {
    if let Some(id) = archive::existing(
        db,
        selection.job_id,
        selection.draft_id,
        &selection.text,
        context.workspace,
    )? {
        return Ok(json!({"id":id,"alreadySaved":true}));
    }
    let job = context
        .store
        .get(selection.job_id)?
        .ok_or("visual_assets_model_job_missing")?;
    if job.state != "ready" {
        return Err("visual_assets_model_result_unavailable".into());
    }
    let source = Source::seal(json!({
        "jobId":job.id,"plan":job.plan,"result":job.result,
        "draftId":selection.draft_id,"textDigest":format!("{:x}",Sha256::digest(selection.text.trim().as_bytes())),
        "edited":selection.text.trim()!=job.result.as_ref().and_then(|value|value["text"].as_str()).unwrap_or_default(),
        "requestedAtMs":job.created_ms,"completedAtMs":job.finished_ms,
    }))?;
    if source.plan.scene_id != context.scene
        || source.plan.evidence.workspace_id != context.workspace
    {
        return Err("visual_assets_chapter_access_denied".into());
    }
    let proposal: Proposal = serde_json::from_value(json!({
        "draftId":selection.draft_id,"characterId":source.plan.character_id,
        "facet":source.plan.facet,"baseVersion":source.plan.base_version,
        "evidence":source.plan.evidence,"text":selection.text,
    }))?;
    let note = super::super::read_chapter(
        context.notes,
        &proposal.evidence.notebook_id,
        &proposal.evidence.chapter_id,
    )?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    imports::recover(&tx, context.library)?;
    novel_drafts::create(
        &tx,
        &proposal,
        super::super::chapter(&note, context.workspace),
    )?;
    archive::insert(&tx, selection.draft_id, &source)?;
    checkpoint("before-archive-commit")?;
    tx.commit()?;
    checkpoint("after-archive-commit")?;
    Ok(json!({"id":selection.draft_id,"alreadySaved":false}))
}

#[cfg(test)]
#[path = "novel_model_adoption_tests.rs"]
mod tests;
