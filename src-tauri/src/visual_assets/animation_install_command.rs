use super::{
    animation_install::{self, Plan},
    animation_request::AnimationIntent,
    backup_commands, backup_destination,
    commands::{Request, LIBRARY},
};
use crate::{host_server::ResourceExportContext, resource_export_picker};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::File,
    path::PathBuf,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

const TTL: Duration = Duration::from_secs(120);
const MAX_PLANS: usize = 16;
const PLAN_UNAVAILABLE: &str = "visual_assets_animation_install_plan_unavailable";
const RETRY_UNAVAILABLE: &str = "visual_assets_animation_retry_unavailable";
const RETRY_TARGET: &str = "visual_assets_animation_retry_target_changed";
static PLANS: LazyLock<Mutex<HashMap<String, Ticket>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

struct Ticket {
    context: ResourceExportContext,
    expires: Instant,
    project: PathBuf,
    directory_handles: Vec<File>,
    target: Target,
}

enum Target {
    Install {
        name: String,
        intent: AnimationIntent,
        plan: Plan,
    },
    Retry {
        job_id: String,
    },
}

impl Target {
    fn is_retry(&self) -> bool {
        matches!(self, Self::Retry { .. })
    }
}

fn issue(
    context: ResourceExportContext,
    project: PathBuf,
    directory_handles: Vec<File>,
    target: Target,
) -> Result<String, String> {
    let mut plans = PLANS.lock().map_err(|_| PLAN_UNAVAILABLE)?;
    let now = Instant::now();
    plans.retain(|_, ticket| ticket.expires > now && ticket.context.window != context.window);
    if plans.len() >= MAX_PLANS {
        return Err(PLAN_UNAVAILABLE.into());
    }
    let token = uuid::Uuid::new_v4().to_string();
    plans.insert(
        token.clone(),
        Ticket {
            context,
            expires: now + TTL,
            project,
            directory_handles,
            target,
        },
    );
    let expiring = token.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(TTL).await;
        if let Ok(mut plans) = PLANS.lock() {
            plans.remove(&expiring);
        }
    });
    Ok(token)
}

pub(super) async fn handle(
    app: AppHandle,
    window: WebviewWindow,
    workspace: String,
    context: ResourceExportContext,
    request: Request,
) -> Result<Value, String> {
    let recheck = move || {
        let current = resource_export_picker::context(&window, &workspace)?;
        if current != context {
            return Err("visual_assets_window_changed".to_string());
        }
        Ok(current)
    };
    let is_retry = matches!(
        &request,
        Request::CancelAnimationRetry { .. } | Request::ConfirmAnimationRetry { .. }
    );
    match request {
        Request::PlanAnimationInstall { name, intent } => {
            animation_install::validate_name(&name)
                .map_err(|_| "visual_assets_animation_install_invalid_name")?;
            intent.check_godot_installation()
                .map_err(|_| "visual_assets_animation_recipe_invalid")?;
            intent
                .recipe_bytes()
                .map_err(|_| "visual_assets_animation_recipe_invalid")?;
            let picked = tauri::async_runtime::spawn_blocking(move || {
                app.dialog().file().blocking_pick_folder()
            })
            .await
            .map_err(|_| "visual_assets_picker_unavailable")?;
            recheck()?;
            let Some(folder) = picked else {
                return Ok(json!({"cancelled": true}));
            };
            let project = folder.into_path().map_err(|_| PLAN_UNAVAILABLE)?;
            tauri::async_runtime::spawn_blocking(move || {
                let (project, directory_handles) = backup_destination::hold(&project)
                    .map_err(|_| "visual_assets_animation_install_invalid_project")?;
                let plan = animation_install::plan(&project, &name)
                    .map_err(|_| "visual_assets_animation_install_invalid_project")?;
                let summary = serde_json::to_value(&plan).map_err(|_| PLAN_UNAVAILABLE)?;
                let token = issue(recheck()?, project, directory_handles, Target::Install { name, intent, plan })?;
                Ok(json!({"token": token, "plan": summary}))
            })
            .await
            .map_err(|_| PLAN_UNAVAILABLE)?
        }
        Request::PlanAnimationRetry { job_id } => {
            tauri::async_runtime::spawn_blocking(move || {
                let store = backup_commands::store()?;
                let retry = store.retry_animation(&job_id).map_err(|_| RETRY_UNAVAILABLE)?;
                let parent = retry.destination.parent().ok_or(RETRY_TARGET)?;
                recheck()?;
                let picked = app.dialog().file().set_directory(parent).blocking_pick_folder();
                recheck()?;
                let Some(folder) = picked else {
                    return Ok(json!({"cancelled": true}));
                };
                let folder = folder.into_path().map_err(|_| RETRY_TARGET)?;
                let (project, directory_handles) = backup_destination::hold(&folder).map_err(|_| RETRY_TARGET)?;
                let retry = store.retry_animation(&job_id).map_err(|_| RETRY_UNAVAILABLE)?;
                retry.check_target(&project).map_err(|_| RETRY_TARGET)?;
                let token = issue(recheck()?, project, directory_handles, Target::Retry { job_id })?;
                Ok(json!({"token": token, "retry": {"destination": retry.destination, "intent": retry.intent}}))
            })
            .await
            .map_err(|_| RETRY_UNAVAILABLE)?
        }
        Request::CancelAnimationInstall { token } | Request::CancelAnimationRetry { token } => {
            let context = recheck()?;
            let mut plans = PLANS.lock().map_err(|_| PLAN_UNAVAILABLE)?;
            if plans
                .get(&token)
                .is_some_and(|ticket| ticket.context == context && ticket.target.is_retry() == is_retry)
            {
                plans.remove(&token);
            }
            Ok(json!({"cancelled": true}))
        }
        Request::ConfirmAnimationInstall { token } | Request::ConfirmAnimationRetry { token } => {
            tauri::async_runtime::spawn_blocking(move || {
                let context = recheck()?;
                let ticket = {
                    let mut plans = PLANS.lock().map_err(|_| PLAN_UNAVAILABLE)?;
                    if !plans.get(&token).is_some_and(|ticket| {
                        ticket.expires > Instant::now() && ticket.context == context && ticket.target.is_retry() == is_retry
                    }) {
                        return Err(PLAN_UNAVAILABLE.to_string());
                    }
                    plans.remove(&token).ok_or(PLAN_UNAVAILABLE)?
                };
                let store = backup_commands::store()?;
                let library = crate::app_paths::data_root()?.join("visual-assets");
                let job = match ticket.target {
                    Target::Install { name, intent, plan } => {
                        const CHANGED: &str = "visual_assets_animation_install_changed";
                        let current = animation_install::plan(&ticket.project, &name).map_err(|_| CHANGED)?;
                        if current.destination != plan.destination || current.previous != plan.previous {
                            return Err(CHANGED.into());
                        }
                        recheck()?;
                        store.begin_animation_install(&current, &intent)
                            .map_err(|_| "visual_assets_animation_install_start_failed")?
                    }
                    Target::Retry { job_id } => {
                        let retry = store.retry_animation(&job_id).map_err(|_| RETRY_UNAVAILABLE)?;
                        retry.check_target(&ticket.project).map_err(|_| RETRY_TARGET)?;
                        recheck()?;
                        store.begin_animation_retry(&retry).map_err(|_| RETRY_UNAVAILABLE)?
                    }
                };
                let response = json!({"job": job});
                let directory_handles = ticket.directory_handles;
                backup_commands::spawn_task(store, job, move |store, job| {
                    let _directory_handles = directory_handles;
                    store
                        .run_animation(job, &library, &LIBRARY, &|_| {})
                        .map_err(|_| "animation installation failed")
                });
                Ok(response)
            })
            .await
            .map_err(|_| PLAN_UNAVAILABLE)?
        }
        _ => unreachable!(),
    }
}
