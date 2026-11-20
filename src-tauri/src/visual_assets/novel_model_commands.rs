use super::{model, HostServer, ResourceExportContext, Result};
use crate::{model_tools, resource_export_picker};
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::Duration,
};
use tauri::{Manager, WebviewWindow};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[path = "novel_model_execution.rs"]
mod execution;
#[path = "novel_model_jobs.rs"]
mod jobs;
use jobs::Store;
#[path = "novel_model_adoption.rs"]
mod adoption;
use crate::visual_assets::novel_model_archive as archive;

static ACTIVE: LazyLock<Mutex<HashMap<Uuid, CancellationToken>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum Action {
    Adopt {
        selection: adoption::Selection,
    },
    Submit {
        id: Uuid,
        digest: String,
        input: Box<model::Input>,
        confirmed: bool,
    },
    Status {
        id: Uuid,
    },
    Cancel {
        id: Uuid,
    },
    History {
        character_id: String,
        before: Option<i64>,
    },
}

fn status(db: &Connection, store: &Store, id: Uuid) -> Result<Value> {
    Ok(
        json!({"job":store.get(id)?,"active":ACTIVE.lock().is_ok_and(|active| active.contains_key(&id)),"archivedDraftId":archive::find_job(db,id)?}),
    )
}

fn authorized(window: &WebviewWindow, owner: &ResourceExportContext, scene: &str) -> Result<()> {
    if resource_export_picker::context(window, &owner.workspace)? != *owner {
        return Err("visual_assets_window_changed".into());
    }
    window.state::<HostServer>().authorize_novel_model(scene)
}

pub(super) fn handle(
    window: &WebviewWindow,
    owner: &ResourceExportContext,
    scene: &str,
    library: &str,
    db: &mut Connection,
    action: Action,
) -> Result<Value> {
    let store = Store::open(
        &crate::app_paths::data_root()?.join("visual-assets-jobs"),
        library,
        &owner.workspace,
        scene,
    )?;
    match action {
        Action::Adopt { selection } => {
            window
                .state::<HostServer>()
                .with_novel_notes(scene, &owner.workspace, |notes| {
                    let root = crate::app_paths::data_root()?.join("visual-assets");
                    adoption::adopt(
                        db,
                        adoption::Context {
                            library: &root,
                            store: &store,
                            notes,
                            workspace: &owner.workspace,
                            scene,
                        },
                        selection,
                    )
                })
        }
        Action::Cancel { id } => {
            if store.get(id)?.is_none() {
                return Err("visual_assets_model_job_missing".into());
            }
            let active = ACTIVE
                .lock()
                .map_err(|_| "visual_assets_model_job_unavailable")?;
            let cancelled = active.get(&id).map(|token| token.cancel()).is_some();
            Ok(json!({"cancelRequested":cancelled}))
        }
        Action::Status { id } => {
            window
                .state::<HostServer>()
                .with_novel_notes(scene, &owner.workspace, |_| status(db, &store, id))
        }
        Action::History {
            character_id,
            before,
        } => window
            .state::<HostServer>()
            .with_novel_notes(scene, &owner.workspace, |_| {
                crate::visual_assets::characters::get(db, &character_id)?;
                let mut history = store.list(&character_id, before)?;
                for entry in history["entries"]
                    .as_array_mut()
                    .ok_or("visual_assets_model_job_unavailable")?
                {
                    let id = Uuid::parse_str(
                        entry["id"]
                            .as_str()
                            .ok_or("visual_assets_model_job_unavailable")?,
                    )?;
                    entry["archivedDraftId"] = json!(archive::find_job(db, id)?);
                }
                Ok(history)
            }),
        Action::Submit {
            id,
            digest,
            input,
            confirmed,
        } => {
            if !confirmed {
                return Err("visual_assets_model_confirmation_required".into());
            }
            window
                .state::<HostServer>()
                .with_novel_notes(scene, &owner.workspace, |_| Ok(()))?;
            if let Some(existing) = store.get(id)? {
                if existing.plan["digest"] != digest {
                    return Err("visual_assets_model_job_exists".into());
                }
                return status(db, &store, id);
            }
            authorized(window, owner, scene)?;
            let lease = store.lease()?.ok_or("visual_assets_model_busy")?;
            let root = crate::app_paths::system_root()?;
            let plan = window.state::<HostServer>().with_novel_notes(
                scene,
                &owner.workspace,
                |notes| model::preview(db, notes, &owner.workspace, scene, &root, *input),
            )?;
            if plan["digest"] != digest {
                return Err("visual_assets_model_plan_changed".into());
            }
            let endpoint = model_tools::resolve(
                &root,
                scene,
                plan["model"]["provider"].as_str(),
                plan["model"]["model"].as_str(),
            )
            .map_err(|_| "visual_assets_model_selection_unavailable")?;
            if plan["endpointIdentity"] != endpoint.request_identity() {
                return Err("visual_assets_model_plan_changed".into());
            }
            let key = if endpoint.choice.requires_key {
                Some(
                    crate::credential_broker::model_tool_credential(
                        scene,
                        &endpoint.choice.provider,
                    )
                    .map_err(|_| "visual_assets_model_credential_unavailable")?
                    .filter(|value| !value.trim().is_empty())
                    .ok_or("visual_assets_model_credential_unavailable")?,
                )
            } else {
                None
            };
            let mut active = ACTIVE
                .lock()
                .map_err(|_| "visual_assets_model_job_unavailable")?;
            if active.len() >= 8 {
                return Err("visual_assets_model_busy".into());
            }
            store.begin(id, &plan)?;
            let cancellation = CancellationToken::new();
            active.insert(id, cancellation.clone());
            drop(active);
            spawn(Dispatch {
                window: window.clone(),
                owner: owner.clone(),
                scene: scene.into(),
                store: store.clone(),
                id,
                plan,
                endpoint,
                key,
                lease,
                cancellation,
            });
            status(db, &store, id)
        }
    }
}

struct Active(Uuid);
impl Drop for Active {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE.lock() {
            active.remove(&self.0);
        }
    }
}

struct Dispatch {
    window: WebviewWindow,
    owner: ResourceExportContext,
    scene: String,
    store: Store,
    id: Uuid,
    plan: Value,
    endpoint: model_tools::ModelEndpoint,
    key: Option<String>,
    lease: std::fs::File,
    cancellation: CancellationToken,
}

fn spawn(dispatch: Dispatch) {
    tauri::async_runtime::spawn(async move {
        let Dispatch {
            window,
            owner,
            scene,
            store,
            id,
            plan,
            endpoint,
            key,
            lease,
            cancellation,
        } = dispatch;
        let _active = Active(id);
        let _lease = lease;
        if authorized(&window, &owner, &scene).is_err() {
            cancellation.cancel();
        }
        let completion = execution::execute(
            endpoint,
            key,
            plan["prompt"].as_str().unwrap_or_default().into(),
            cancellation.clone(),
        );
        tokio::pin!(completion);
        let outcome = loop {
            tokio::select! {
                result = &mut completion => break result,
                _ = tokio::time::sleep(Duration::from_millis(250)) => {
                    if authorized(&window,&owner,&scene).is_err() { cancellation.cancel(); }
                }
            }
        };
        // SQLite work and bounded contention retries do not occupy the async executor.
        let _ = tauri::async_runtime::spawn_blocking(move || {
            for _ in 0..20 {
                let saved = match &outcome {
                    Some(result) => store.finish(id, result),
                    None => store.record_unknown(id),
                };
                if saved.is_ok() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            // The pre-send row remains unknown if the result could not be persisted.
        })
        .await;
    });
}
