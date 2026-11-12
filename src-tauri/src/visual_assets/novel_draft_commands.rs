use super::{
    backup_commands, catalog,
    characters::{self, Facet},
    commands::LIBRARY,
    generation_attempts, imports,
    novel_drafts::{self, Chapter, Proposal},
    Result,
};
use crate::{
    host_server::{HostServer, ResourceExportContext},
    notes_vault::{NoteDocument, NotesVault},
    resource_export_picker,
};
use rusqlite::{Connection, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;
use tauri::{Manager, WebviewWindow};
use uuid::Uuid;

#[path = "novel_chapter_discovery.rs"]
mod discovery;
#[cfg(test)]
#[path = "novel_chapter_discovery_tests.rs"]
mod discovery_tests;
#[path = "novel_model_plan.rs"]
mod model;
#[path = "novel_model_commands.rs"]
mod model_commands;
#[path = "novel_draft_review.rs"]
mod review;
#[cfg(test)]
#[path = "novel_draft_notes_tests.rs"]
mod tests;
#[path = "novel_watch_commands.rs"]
mod watch;

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum Action {
    List {
        character_id: String,
        before: Option<i64>,
    },
    Review {
        character_id: String,
        draft_ids: Vec<Uuid>,
    },
    Notebooks,
    ModelCatalog,
    ModelSource {
        id: Uuid,
    },
    ModelJob {
        action: model_commands::Action,
    },
    ModelPreview {
        input: model::Input,
    },
    Watch {
        action: watch::Action,
    },
    Discover {
        query: discovery::Query,
    },
    Chapters {
        notebook_id: String,
        title: String,
    },
    Preview {
        character_id: String,
        facet: Facet,
        notebook_id: String,
        chapter_id: String,
        revision: String,
        phrase: String,
    },
    Save {
        proposal: Proposal,
    },
    Approve {
        id: Uuid,
    },
}

fn read_chapter(notes: &NotesVault, notebook: &str, id: &str) -> Result<NoteDocument> {
    notes
        .get_note(notebook, id)
        .map_err(|_| "visual_assets_chapter_unavailable".into())
}

fn chapter<'a>(note: &'a NoteDocument, workspace: &'a str) -> Chapter<'a> {
    Chapter {
        workspace_id: workspace,
        notebook_id: &note.summary.notebook_id,
        id: &note.summary.id,
        title: &note.summary.title,
        revision: &note.summary.version,
        body: &note.content,
    }
}

fn with_notes(
    db: &mut Connection,
    library: &Path,
    notes: &NotesVault,
    workspace: &str,
    action: Action,
) -> Result<Value> {
    match action {
        Action::List { .. }
        | Action::Watch { .. }
        | Action::ModelCatalog
        | Action::ModelSource { .. }
        | Action::ModelJob { .. }
        | Action::ModelPreview { .. } => unreachable!(),
        Action::Discover { query } => discovery::discover(db, notes, workspace, query),
        Action::Review {
            character_id,
            draft_ids,
        } => {
            Ok(json!({"entries": review::check(db, notes, workspace, &character_id, &draft_ids)?}))
        }
        Action::Notebooks => {
            let books = notes
                .list_notebooks()
                .map_err(|_| "visual_assets_chapter_unavailable")?;
            Ok(
                json!({"notebooks":books.into_iter().map(|book| json!({"id":book.id,"title":book.title})).collect::<Vec<_>>() }),
            )
        }
        Action::Chapters { notebook_id, title } => {
            if title.chars().take(121).count() > 120 || title.chars().any(char::is_control) {
                return Err("visual_assets_chapter_search_invalid".into());
            }
            let title = title.trim().to_lowercase();
            let snapshot = notes
                .list(Some(&notebook_id), None, None, false)
                .map_err(|_| "visual_assets_chapter_unavailable")?;
            let mut matches = snapshot
                .notes
                .into_iter()
                .filter(|note| title.is_empty() || note.title.to_lowercase().contains(&title));
            let chapters: Vec<_> = matches
                .by_ref()
                .take(50)
                .map(|note| json!({"id":note.id,"title":note.title,"revision":note.version}))
                .collect();
            Ok(json!({"chapters":chapters,"more":matches.next().is_some()}))
        }
        Action::Preview {
            character_id,
            facet,
            notebook_id,
            chapter_id,
            revision,
            phrase,
        } => {
            let base = characters::latest(db, &character_id, facet)?;
            let note = read_chapter(notes, &notebook_id, &chapter_id)?;
            if note.summary.version != revision {
                return Err("visual_assets_chapter_changed".into());
            }
            Ok(json!({"excerpts":chapter(&note,workspace).excerpts(&phrase)?,"baseVersion":base}))
        }
        Action::Save { proposal } => {
            if proposal.evidence.workspace_id != workspace {
                return Err("visual_assets_chapter_access_denied".into());
            }
            let note = read_chapter(
                notes,
                &proposal.evidence.notebook_id,
                &proposal.evidence.chapter_id,
            )?;
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            imports::recover(&tx, library)?;
            novel_drafts::create(&tx, &proposal, chapter(&note, workspace))?;
            tx.commit()?;
            Ok(json!({"id":proposal.draft_id}))
        }
        Action::Approve { id } => {
            let draft = novel_drafts::get(db, id)?.ok_or("visual_assets_draft_missing")?;
            if draft.evidence.workspace_id != workspace {
                return Err("visual_assets_chapter_access_denied".into());
            }
            if let Some(version) = draft.approved_version {
                return Ok(json!({"version":version}));
            }
            let note = read_chapter(
                notes,
                &draft.evidence.notebook_id,
                &draft.evidence.chapter_id,
            )?;
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            imports::recover(&tx, library)?;
            let version = novel_drafts::approve(&tx, id, chapter(&note, workspace))?;
            tx.commit()?;
            Ok(json!({"version":version}))
        }
    }
}

pub(super) async fn handle(
    window: WebviewWindow,
    owner: ResourceExportContext,
    scene: String,
    library_id: String,
    action: Action,
) -> std::result::Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result: Result<Value> = (|| {
            if resource_export_picker::context(&window, &owner.workspace)? != owner {
                return Err("visual_assets_window_changed".into());
            }
            backup_commands::store()?;
            let library = crate::app_paths::data_root()?.join("visual-assets");
            let _guard = LIBRARY.try_lock().map_err(|_| "visual_assets_busy")?;
            let mut db = catalog::open(&library)?;
            generation_attempts::check_library(&db, &library_id)?;
            match action {
                Action::ModelJob { action } => {
                    model_commands::handle(&window, &owner, &scene, &library_id, &mut db, action)
                }
                Action::ModelSource { id } => {
                    let draft = novel_drafts::get(&db, id)?.ok_or("visual_assets_draft_missing")?;
                    if draft.evidence.workspace_id != owner.workspace {
                        return Err("visual_assets_chapter_access_denied".into());
                    }
                    Ok(json!({"source":super::novel_model_archive::get(&db,id)?}))
                }
                Action::ModelCatalog => {
                    window
                        .state::<HostServer>()
                        .with_novel_notes(&scene, &owner.workspace, |_| {
                            let root = crate::app_paths::system_root()?;
                            Ok(json!({"models": crate::model_tools::catalog(&root, &scene)
                            .map_err(|_| "visual_assets_model_config_unavailable")?}))
                        })
                }
                Action::ModelPreview { input } => window.state::<HostServer>().with_novel_notes(
                    &scene,
                    &owner.workspace,
                    |notes| {
                        let root = crate::app_paths::system_root()?;
                        model::preview(&db, notes, &owner.workspace, &scene, &root, input)
                    },
                ),
                Action::Watch { action } => {
                    watch::handle(&window, &owner, &scene, &library_id, &db, action)
                }
                Action::List {
                    character_id,
                    before,
                } => {
                    let (entries, next) = novel_drafts::list(&db, &character_id, before)?;
                    Ok(json!({"entries":entries,"next":next}))
                }
                action => window.state::<HostServer>().with_novel_notes(
                    &scene,
                    &owner.workspace,
                    |notes| with_notes(&mut db, &library, notes, &owner.workspace, action),
                ),
            }
        })();
        result.map_err(|error| {
            let code = error.to_string();
            if code.starts_with("visual_assets_") {
                code
            } else {
                "visual_assets_draft_unavailable".into()
            }
        })
    })
    .await
    .map_err(|_| "visual_assets_draft_unavailable".to_string())?
}
