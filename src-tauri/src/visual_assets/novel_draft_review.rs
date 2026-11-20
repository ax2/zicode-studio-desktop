//! Compare saved draft evidence with the current revisions of the cited Notes chapters.
use super::{characters, novel_drafts, NotesVault, Result};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Serialize)]
struct Revision {
    id: String,
    title: String,
    revision: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Check {
    id: Uuid,
    latest: Option<Revision>,
    chapter_changed: bool,
    base_changed: bool,
}

pub(super) fn check(
    db: &Connection,
    notes: &NotesVault,
    workspace: &str,
    character: &str,
    ids: &[Uuid],
) -> Result<Vec<Check>> {
    if ids.is_empty() || ids.len() > 10 {
        return Err("visual_assets_draft_review_size".into());
    }
    let drafts = ids
        .iter()
        .map(|id| {
            let draft = novel_drafts::get(db, *id)?.ok_or("visual_assets_draft_missing")?;
            if draft.character_id != character {
                return Err("visual_assets_draft_missing".into());
            }
            Ok(draft)
        })
        .collect::<Result<Vec<_>>>()?;
    let mut chapters = HashMap::new();
    let mut checks = Vec::with_capacity(ids.len());
    for (id, draft) in ids.iter().zip(drafts) {
        let evidence = draft.evidence;
        let latest = if evidence.workspace_id == workspace {
            chapters
                .entry((evidence.notebook_id, evidence.chapter_id))
                .or_insert_with_key(|(notebook, chapter)| {
                    notes
                        .get_note(notebook, chapter)
                        .ok()
                        .map(|note| note.summary)
                })
                .as_ref()
        } else {
            None
        };
        checks.push(Check {
            id: *id,
            chapter_changed: latest.is_some_and(|summary| {
                summary.version != evidence.revision || summary.title != evidence.chapter_title
            }),
            base_changed: draft.approved_version.is_none()
                && characters::latest(db, character, draft.facet)? != draft.base_version,
            latest: latest.map(|summary| Revision {
                id: summary.id.clone(),
                title: summary.title.clone(),
                revision: summary.version.clone(),
            }),
        });
    }
    Ok(checks)
}
