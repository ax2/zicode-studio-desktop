use super::{
    backup_commands, catalog,
    commands::LIBRARY,
    generation_attempts::{self, Plan, Selection},
    Result,
};
use crate::{host_server::ResourceExportContext, resource_export_picker};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};
use tauri::WebviewWindow;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Action {
    Plan {
        selection: Selection,
        port: u16,
    },
    Confirm {
        token: String,
    },
    Cancel {
        token: String,
    },
    List {
        selection: Selection,
    },
    Refresh {
        id: String,
    },
    Output {
        review: super::generation_review_commands::Action,
    },
}

struct Ticket {
    owner: ResourceExportContext,
    library: String,
    plan: Plan,
    until: Instant,
}

const TTL: Duration = Duration::from_secs(120);
static PLANS: LazyLock<Mutex<HashMap<Uuid, Ticket>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn take(token: Uuid, owner: &ResourceExportContext, library: &str) -> Result<Ticket> {
    let mut plans = PLANS
        .lock()
        .map_err(|_| "visual_assets_comfy_plan_unavailable")?;
    if !plans.get(&token).is_some_and(|ticket| {
        &ticket.owner == owner && ticket.library == library && ticket.until > Instant::now()
    }) {
        return Err("visual_assets_comfy_plan_unavailable".into());
    }
    plans
        .remove(&token)
        .ok_or_else(|| "visual_assets_comfy_plan_unavailable".into())
}

pub(super) async fn handle(
    window: WebviewWindow,
    workspace: String,
    owner: ResourceExportContext,
    library_id: String,
    action: Action,
) -> std::result::Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let recheck = || {
            if resource_export_picker::context(&window,&workspace)? != owner {
                return Err("visual_assets_window_changed".to_string());
            }
            Ok(())
        };
        let result: Result<Value> = (|| {
            recheck()?;
            backup_commands::store()?;
            let library = crate::app_paths::data_root()?.join("visual-assets");
            let load = || {
                let db = catalog::open(&library)?;
                let actual: String = db.query_row("SELECT id FROM library",[],|row| row.get(0))?;
                if actual != library_id { return Err(Box::<dyn std::error::Error>::from("visual_assets_library_changed")); }
                Ok(db)
            };
            match action {
                Action::Plan { selection,port } => {
                    let plan = {
                        let _guard = LIBRARY.try_lock().map_err(|_| "visual_assets_busy")?;
                        Plan::load(&load()?,selection,port)?
                    };
                    plan.check_provider()?;
                    recheck()?;
                    let token = Uuid::new_v4();
                    let response = json!({"token":token.to_string(),"plan":plan});
                    let mut plans = PLANS.lock().map_err(|_| "visual_assets_comfy_plan_unavailable")?;
                    let now = Instant::now();
                    plans.retain(|_,ticket| ticket.until > now && ticket.owner.window != owner.window);
                    if plans.len() >= 16 { return Err("visual_assets_comfy_plan_unavailable".into()); }
                    plans.insert(token,Ticket { owner:owner.clone(),library:library_id.clone(),plan,until:now+TTL });
                    Ok(response)
                }
                Action::Confirm { token } => {
                    let token = Uuid::parse_str(&token).map_err(|_| "visual_assets_comfy_plan_unavailable")?;
                    let _guard = LIBRARY.try_lock().map_err(|_| "visual_assets_busy")?;
                    let mut db = load()?;
                    let ticket = take(token,&owner,&library_id)?;
                    recheck()?;
                    let (attempt,prepared) = generation_attempts::begin(&mut db,&library,&library_id,token,ticket.plan)?;
                    let expected = library_id.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        let _ = generation_attempts::run(&library,&expected,prepared,&|_| {});
                    });
                    Ok(json!({"attempt":attempt}))
                }
                Action::Cancel { token } => {
                    if let Ok(token) = Uuid::parse_str(&token) { let _ = take(token,&owner,&library_id); }
                    Ok(json!({"cancelled":true}))
                }
                Action::List { selection } => {
                    let _guard = LIBRARY.try_lock().map_err(|_| "visual_assets_busy")?;
                    Ok(json!({"attempts":generation_attempts::list(&load()?,&library,&library_id,&selection)?}))
                }
                Action::Refresh { id } => Ok(json!({"attempt":generation_attempts::refresh(&library,&library_id,Uuid::parse_str(&id)?)?})),
                Action::Output { review } => super::generation_review_commands::handle(&owner,&library,&library_id,review,recheck),
            }
        })();
        result.map_err(|error| {
            let code = error.to_string();
            if code.starts_with("visual_assets_") { code } else { "visual_assets_comfy_unavailable".into() }
        })
    }).await.map_err(|_| "visual_assets_comfy_unavailable".to_string())?
}
