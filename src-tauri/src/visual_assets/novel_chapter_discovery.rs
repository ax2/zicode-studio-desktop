//! Discovery is a read-only comparison against all persisted draft history.
use super::{characters, novel_drafts, Facet, NotesVault, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Query {
    pub(super) character_id: String,
    pub(super) notebook_id: String,
    pub(super) facet: Facet,
    pub(super) title: String,
    pub(super) after: Option<String>,
    pub(super) needs_work_only: bool,
}

pub(super) fn discover(
    db: &Connection,
    notes: &NotesVault,
    workspace: &str,
    query: Query,
) -> Result<Value> {
    characters::get(db, &query.character_id)?;
    if query.title.chars().take(121).count() > 120 || query.title.chars().any(char::is_control) {
        return Err("visual_assets_chapter_search_invalid".into());
    }
    let title = query.title.trim().to_lowercase();
    let base = characters::latest(db, &query.character_id, query.facet)?;
    let (notes, next) = notes
        .chapter_page(&query.notebook_id, query.after.as_deref())
        .map_err(|_| "visual_assets_chapter_unavailable")?;
    let has_history = novel_drafts::schema_present(db)?;
    let mut entries = Vec::new();
    for note in notes {
        if !title.is_empty() && !note.title.to_lowercase().contains(&title) {
            continue;
        }
        let previous = if has_history {
            db.query_row(
                "SELECT id FROM novel_character_draft WHERE character_id=?1 AND facet=?2
                 AND json_extract(evidence,'$.workspaceId')=?3
                 AND json_extract(evidence,'$.notebookId')=?4
                 AND json_extract(evidence,'$.chapterId')=?5 ORDER BY rowid DESC LIMIT 1",
                params![
                    query.character_id,
                    query.facet.key(),
                    workspace,
                    query.notebook_id,
                    note.id
                ],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .map(|id| novel_drafts::get(db, id.parse()?))
            .transpose()?
            .flatten()
        } else {
            None
        };
        let status = match previous.as_ref() {
            None => "new",
            Some(draft)
                if draft.evidence.revision != note.version
                    || draft.evidence.chapter_title != note.title =>
            {
                "chapterChanged"
            }
            Some(draft) if draft.approved_version.is_none() && draft.base_version != base => {
                "baseChanged"
            }
            Some(_) => "recorded",
        };
        if !query.needs_work_only || status != "recorded" {
            entries.push(
                json!({"id":note.id,"title":note.title,"revision":note.version,
                "status":status,"draftId":previous.map(|draft| draft.id)}),
            );
        }
    }
    Ok(json!({"entries":entries,"next":next}))
}
