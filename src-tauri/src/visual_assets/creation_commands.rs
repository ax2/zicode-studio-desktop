use super::{
    backup_commands, catalog,
    commands::LIBRARY,
    creation_archive as archive, creation_http,
    creation_store::Store,
    creation_types::{credential_scope, hash, library_matches, Input, Plan, Settings},
    generation_outputs, Result,
};
use crate::{credential_broker, host_server::ResourceExportContext, resource_export_picker};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::File,
    path::PathBuf,
    sync::{LazyLock, Mutex},
    time::Instant,
};
use tauri::WebviewWindow;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

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
    Settings,
    SaveSettings {
        settings: Settings,
        api_key: Option<String>,
    },
    Prepare {
        input: Input,
    },
    Submit {
        id: Uuid,
        digest: String,
        input: Input,
        confirmed: bool,
    },
    Status {
        id: Uuid,
    },
    History {
        before: Option<i64>,
    },
    Preview {
        id: Uuid,
    },
    Approve {
        id: Uuid,
        sha256: String,
    },
    Source {
        id: Uuid,
    },
    Cancel {
        id: Uuid,
    },
}

pub(super) async fn handle(
    window: WebviewWindow,
    owner: ResourceExportContext,
    scene: String,
    expected: Option<String>,
    action: Action,
) -> std::result::Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let run = || -> Result<Value> {
            if resource_export_picker::context(&window,&owner.workspace)? != owner { return Err("visual_assets_window_changed".into()); }
            backup_commands::store()?;
            let profile = crate::app_paths::data_root()?;
            let library = profile.join("visual-assets");
            let store = Store::open(&profile.join("visual-assets-jobs"),&owner.workspace,&scene)?;
            let credential_scene=credential_scope(&owner.workspace,&scene);
            let _guard = LIBRARY.try_lock().map_err(|_|"visual_assets_busy")?;
            std::fs::create_dir_all(&library)?;
            let mut db = catalog::open(&library)?;
            let id: String = db.query_row("SELECT id FROM library",[],|row|row.get(0))?;
            if let Some(expected) = expected.as_deref() { library_matches(&db,expected)?; }
            if resource_export_picker::context(&window,&owner.workspace)? != owner { return Err("visual_assets_window_changed".into()); }
            match action {
                Action::Settings => {
                    let settings = store.settings()?;
                    let configured = settings.credential_id().ok().and_then(|provider|credential_broker::model_tool_credential(&credential_scene,&provider).ok().flatten()).is_some();
                    Ok(json!({"libraryId":id,"capabilities":super::creation_types::generation::capabilities(&settings),"settings":settings,"credentialConfigured":configured}))
                }
                Action::SaveSettings { settings, api_key } => {
                    settings.endpoint()?;
                    if let Some(secret) = api_key.filter(|key|!key.is_empty()) {
                        if secret.len()>8192 || secret.chars().any(char::is_control) { return Err("visual_assets_creation_credential_invalid".into()); }
                        credential_broker::store_scene_credential(&credential_scene,&settings.credential_id()?,&secret)?;
                    }
                    store.save_settings(&settings)?;
                    let configured = credential_broker::model_tool_credential(&credential_scene,&settings.credential_id()?).ok().flatten().is_some();
                    Ok(json!({"capabilities":super::creation_types::generation::capabilities(&settings),"settings":settings,"credentialConfigured":configured}))
                }
                Action::Prepare { input } => {
                    let plan = Plan::prepare(&db,&owner.workspace,&scene,store.settings()?,input)?;
                    // Confirm availability and integrity without sending any bytes.
                    plan.images(&db,&library)?;
                    Ok(json!({"plan":plan}))
                }
                Action::Submit { id: job,digest,input,confirmed } => {
                    if !confirmed { return Err("visual_assets_creation_confirmation_required".into()); }
                    if let Some(existing) = store.get(&id,job)? {
                        if existing["plan"]["digest"]!=digest { return Err("visual_assets_creation_plan_changed".into()); }
                        return status(&db,&store,&id,job);
                    }
                    let lease = store.lease(&id)?.ok_or("visual_assets_creation_busy")?;
                    let plan = Plan::prepare(&db,&owner.workspace,&scene,store.settings()?,input)?;
                    if plan.digest!=digest { return Err("visual_assets_creation_plan_changed".into()); }
                    let images = plan.images(&db,&library)?;
                    let key = if plan.settings.requires_key { Some(credential_broker::model_tool_credential(&credential_scene,&plan.settings.credential_id()?)?.ok_or("visual_assets_creation_credential_required")?) } else { None };
                    let mut active = ACTIVE.lock().map_err(|_|"visual_assets_creation_busy")?;
                    if active.len()>=2 { return Err("visual_assets_creation_busy".into()); }
                    store.begin(job,&plan)?;
                    let cancellation = CancellationToken::new();
                    active.insert(job,cancellation.clone());
                    drop(active);
                    dispatch(Dispatch { window, owner, library, store:store.clone(), plan, images, key, cancellation, lease, id:job });
                    status(&db,&store,&id,job)
                }
                Action::Status { id:job } => status(&db,&store,&id,job),
                Action::History { before } => store.history(&id,before),
                Action::Cancel { id:job } => {
                    store.get(&id,job)?.ok_or("visual_assets_creation_job_missing")?;
                    let active = ACTIVE.lock().map_err(|_|"visual_assets_creation_busy")?;
                    let cancelled = active.get(&job).map(|token|token.cancel()).is_some();
                    Ok(json!({"cancelRequested":cancelled}))
                }
                Action::Preview { id:job } => {
                    let (bytes,thumbnail) = store.output(&id,job)?;
                    Ok(json!({"sha256":hash(&bytes),"base64":thumbnail,"mimeType":"image/png"}))
                }
                Action::Approve { id:job,sha256 } => {
                    if let Some(saved) = archive::get(&db,job)? {
                        if saved["sha256"]!=sha256 || saved["plan"]["workspaceId"]!=owner.workspace { return Err("visual_assets_creation_result_changed".into()); }
                        return Ok(saved);
                    }
                    let saved = store.get(&id,job)?.ok_or("visual_assets_creation_job_missing")?;
                    let plan: Plan = serde_json::from_value(saved["plan"].clone())?;
                    let (bytes,_) = store.output(&id,job)?;
                    archive::save(&mut db,&library,job,&plan,&bytes,&sha256,&saved["usage"])
                }
                Action::Source { id:job } => {
                    let saved = archive::get(&db,job)?.ok_or("visual_assets_creation_archive_missing")?;
                    // Approved provenance belongs to this authorized library, even after
                    // restoration on another computer/workspace. It contains no credentials.
                    Ok(saved)
                }
            }
        };
        run().map_err(|error| { let code=error.to_string(); if code.starts_with("visual_assets_") {code} else {"visual_assets_creation_unavailable".into()} })
    }).await.map_err(|_|"visual_assets_creation_unavailable".to_string())?
}
fn status(db: &rusqlite::Connection, store: &Store, library: &str, id: Uuid) -> Result<Value> {
    Ok(
        json!({"job":store.get(library,id)?,"active":ACTIVE.lock().is_ok_and(|active|active.contains_key(&id)),"archived":archive::get(db,id)?}),
    )
}

struct Dispatch {
    window: WebviewWindow,
    owner: ResourceExportContext,
    library: PathBuf,
    store: Store,
    plan: Plan,
    images: Vec<Vec<u8>>,
    key: Option<String>,
    cancellation: CancellationToken,
    lease: File,
    id: Uuid,
}
fn dispatch(work: Dispatch) {
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        let network_plan = work.plan.clone();
        let network = creation_http::create(
            &network_plan,
            work.id,
            work.images,
            work.key,
            work.cancellation.clone(),
        );
        tokio::pin!(network);
        let (output, rejected) = loop {
            if !resource_export_picker::context(&work.window, &work.owner.workspace)
                .is_ok_and(|owner| owner == work.owner)
            {
                work.cancellation.cancel();
                break (None, None);
            }
            tokio::select! { result=&mut network => {
                let rejected=result.as_ref().err().map(|error|error.to_string()).filter(|code| super::creation_errors::rejected(code));
                break (result.ok(),rejected);
            }, _=tokio::time::sleep(std::time::Duration::from_millis(250))=>{} }
        };
        if let Some(reason) = rejected {
            let store = work.store.clone();
            let id = work.id;
            let _ = tauri::async_runtime::spawn_blocking(move || store.reject(id, &reason).is_ok())
                .await;
        }
        if let Some(mut output) = output {
            output.usage["elapsedMs"] =
                json!(started.elapsed().as_millis().min(u64::MAX as u128) as u64);
            let library = work.library;
            let store = work.store;
            let id = work.id;
            let expected = work.plan.library_id;
            let _ =
                tauri::async_runtime::spawn_blocking(move || -> std::result::Result<(), String> {
                    let run = || -> Result<()> {
                        let _guard = LIBRARY.lock().map_err(|_| "visual_assets_busy")?;
                        let mut db = catalog::open(&library)?;
                        library_matches(&db, &expected)?;
                        let thumbnail =
                            generation_outputs::thumbnail(&mut db, &library, &output.bytes)?;
                        store.finish(id, &output.bytes, &thumbnail, &output.usage)
                    };
                    run().map_err(|_| "visual_assets_creation_result_invalid".into())
                })
                .await;
        }
        if let Ok(mut active) = ACTIVE.lock() {
            active.remove(&work.id);
        }
        drop(work.lease);
    });
}
