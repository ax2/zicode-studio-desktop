//! Watch work belongs to the Host. The view only starts, pauses and reads it.
use super::{
    catalog, generation_attempts, resource_export_picker, HostServer, ResourceExportContext,
    Result, LIBRARY,
};
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::Duration,
};
use tauri::{Manager, WebviewWindow};
use uuid::Uuid;

#[path = "novel_watch_store.rs"]
mod store;
use store::{Scope, Store};

static ACTIVE: LazyLock<Mutex<HashMap<String, Uuid>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Action {
    Status { scope: Scope },
    Start { scope: Scope },
    Pause { scope: Scope },
    Entries { scope: Scope, after: Option<String> },
}

fn current(id: &str, token: Uuid) -> bool {
    ACTIVE
        .lock()
        .is_ok_and(|active| active.get(id) == Some(&token))
}

fn status(store: &Store, scope: &Scope) -> Result<Value> {
    let Some(watch) = store.get(scope)? else {
        return Ok(json!({"watch":null}));
    };
    let active = ACTIVE
        .lock()
        .map_err(|_| "visual_assets_watch_unavailable")?
        .contains_key(&watch.id);
    let mut value = serde_json::to_value(&watch)?;
    if watch.state == "running" && !active && store.lease(&watch.id)?.is_some() {
        value["state"] = json!("interrupted");
    }
    Ok(json!({"watch":value}))
}

pub(super) fn handle(
    window: &WebviewWindow,
    owner: &ResourceExportContext,
    scene: &str,
    library: &str,
    catalog: &Connection,
    action: Action,
) -> Result<Value> {
    let root = crate::app_paths::data_root()?.join("visual-assets-jobs");
    let store = Store::open(&root, library, &owner.workspace)?;
    match action {
        Action::Status { scope } => status(&store, &scope),
        Action::Entries { scope, after } => {
            window
                .state::<HostServer>()
                .with_novel_notes(scene, &owner.workspace, |_| {
                    store.page(&scope, after.as_deref())
                })
        }
        Action::Pause { scope } => {
            store.pause(&scope, None)?;
            if let Some(watch) = store.get(&scope)? {
                ACTIVE
                    .lock()
                    .map_err(|_| "visual_assets_watch_unavailable")?
                    .remove(&watch.id);
            }
            status(&store, &scope)
        }
        Action::Start { scope } => {
            // Fix the notebook authorization before scheduling background reads.
            window
                .state::<HostServer>()
                .with_novel_notes(scene, &owner.workspace, |notes| {
                    notes
                        .chapter_page(&scope.notebook_id, None)
                        .map_err(|_| "visual_assets_chapter_unavailable")?;
                    Ok(())
                })?;
            let mut active = ACTIVE
                .lock()
                .map_err(|_| "visual_assets_watch_unavailable")?;
            if store
                .get(&scope)?
                .is_some_and(|watch| active.contains_key(&watch.id))
            {
                drop(active);
                return status(&store, &scope);
            }
            let existing_lease = if let Some(watch) = store.get(&scope)? {
                match store.lease(&watch.id)? {
                    Some(lease) => Some(lease),
                    None if watch.state == "running" => {
                        drop(active);
                        return status(&store, &scope);
                    }
                    None => return Err("visual_assets_watch_busy".into()),
                }
            } else {
                None
            };
            if active.len() >= 8 {
                return Err("visual_assets_watch_limit".into());
            }
            let watch = store.start(catalog, &scope)?;
            let scheduling_lease = match match existing_lease {
                Some(lease) => Some(lease),
                None => store.lease(&watch.id)?,
            } {
                Some(lease) => lease,
                None => {
                    drop(active);
                    return status(&store, &scope);
                }
            };
            let token = Uuid::new_v4();
            active.insert(watch.id.clone(), token);
            drop(active);
            spawn(
                window.clone(),
                owner.clone(),
                scene.into(),
                store.clone(),
                scope.clone(),
                Lease {
                    id: watch.id,
                    token,
                    _file: scheduling_lease,
                },
            );
            status(&store, &scope)
        }
    }
}

struct Lease {
    id: String,
    token: Uuid,
    _file: std::fs::File,
}
impl Lease {
    fn release(&self) {
        if let Ok(mut active) = ACTIVE.lock() {
            if active.get(&self.id) == Some(&self.token) {
                active.remove(&self.id);
            }
        }
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        self.release();
    }
}

fn spawn(
    window: WebviewWindow,
    owner: ResourceExportContext,
    scene: String,
    store: Store,
    scope: Scope,
    lease: Lease,
) {
    // No view callback participates in this lifetime. Window/workspace/grant changes pause it.
    tauri::async_runtime::spawn_blocking(move || {
        let id = lease.id.clone();
        let token = lease.token;
        while current(&id, token) {
            // Yield to interactive library commands and limit each batch to 20 chapters.
            if let Ok(_guard) = LIBRARY.try_lock() {
                if !current(&id, token) {
                    break;
                }
                match store.get(&scope) {
                    Ok(Some(watch)) => {
                        if watch.state != "running" {
                            lease.release();
                            break;
                        }
                        if watch.next_at > chrono::Utc::now().timestamp_millis() {
                            // Waiting watches need no Catalog or Notes initialization.
                            drop(_guard);
                            std::thread::sleep(Duration::from_secs(1));
                            continue;
                        }
                    }
                    Ok(None) => {
                        lease.release();
                        break;
                    }
                    Err(_) => {} // tick below classifies transient database contention.
                }
                let result: Result<()> = (|| {
                    if resource_export_picker::context(&window, &owner.workspace)? != owner {
                        return Err("visual_assets_window_changed".into());
                    }
                    let library = crate::app_paths::data_root()?.join("visual-assets");
                    let db = catalog::open(&library)?;
                    generation_attempts::check_library(&db, &store.library)?;
                    window.state::<HostServer>().with_novel_notes(
                        &scene,
                        &owner.workspace,
                        |notes| {
                            store.tick(
                                &db,
                                notes,
                                &scope,
                                chrono::Utc::now().timestamp_millis(),
                            )?;
                            Ok(())
                        },
                    )
                })();
                if let Err(error) = result {
                    let retryable = matches!(error.downcast_ref::<rusqlite::Error>(),
                        Some(rusqlite::Error::SqliteFailure(error, _)) if matches!(error.code,
                            rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked));
                    if retryable {
                        drop(_guard);
                        std::thread::sleep(Duration::from_secs(1));
                        continue;
                    }
                    let _ = store.pause(&scope, Some("visual_assets_watch_check_failed"));
                    lease.release();
                    break;
                }
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}
