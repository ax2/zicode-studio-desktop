use super::{
    backup_jobs::{Job, Store},
    commands::{Request, LIBRARY},
};
use serde_json::{json, Value};
use std::sync::{Arc, LazyLock, Mutex};
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

static STORE: LazyLock<Mutex<Option<Arc<Store>>>> = LazyLock::new(|| Mutex::new(None));

pub(super) fn store() -> Result<Arc<Store>, String> {
    let mut value = STORE
        .lock()
        .map_err(|_| "visual_assets_backup_unavailable")?;
    if let Some(store) = value.as_ref() {
        return Ok(Arc::clone(store));
    }
    let root = crate::app_paths::data_root()?;
    let store = Arc::new(
        Store::open(
            &root.join("visual-assets-jobs"),
            &root.join("visual-assets"),
        )
        .map_err(|_| "visual_assets_backup_unavailable")?,
    );
    *value = Some(Arc::clone(&store));
    Ok(store)
}

pub async fn handle(
    app: AppHandle,
    window: WebviewWindow,
    workspace: String,
    request: Request,
) -> Result<Value, String> {
    let context = crate::resource_export_picker::context(&window, &workspace)?;
    let store = tauri::async_runtime::spawn_blocking(store)
        .await
        .map_err(|_| "visual_assets_backup_unavailable")??;
    let restoring = matches!(request, Request::StartRestore);
    let animation = matches!(request, Request::StartAnimation { .. });
    let include_referenced_originals = matches!(
        request,
        Request::StartBackup {
            include_referenced_originals: true,
        }
    );
    if let Request::StartAnimation { intent } = &request {
        intent
            .recipe_bytes()
            .map_err(|_| "visual_assets_animation_recipe_invalid")?;
    }
    if restoring || animation || matches!(request, Request::StartBackup { .. }) {
        let selected = tauri::async_runtime::spawn_blocking(move || {
            app.dialog().file().blocking_pick_folder()
        })
        .await
        .map_err(|_| "visual_assets_picker_unavailable")?;
        if crate::resource_export_picker::context(&window, &workspace)? != context {
            return Err("visual_assets_window_changed".into());
        }
        let Some(folder) = selected else {
            return Ok(json!({"cancelled": true}));
        };
        let parent = folder
            .into_path()
            .map_err(|_| "visual_assets_invalid_destination")?;
        let root = crate::app_paths::data_root()?.join("visual-assets");
        return tauri::async_runtime::spawn_blocking(move || {
            if crate::resource_export_picker::context(&window, &workspace)? != context {
                return Err("visual_assets_window_changed".to_string());
            }
            let (parent, directory_handles) = super::backup_destination::hold(&parent)
                .map_err(|_| "visual_assets_invalid_destination")?;
            let job = match &request {
                Request::StartAnimation { intent } => store.begin_animation(&parent, intent),
                Request::StartRestore => store.begin_restore(&root),
                _ => store.begin(&parent, include_referenced_originals),
            }
            .map_err(|_| "visual_assets_backup_start_failed")?;
            let response = json!({"job": job});
            // Authorization is fixed at submission. Closing the view does not cancel the task.
            spawn_task(store, job, move |store, job| {
                let _directory_handles = directory_handles;
                if animation {
                    return store
                        .run_animation(job, &root, &LIBRARY, &|_| {})
                        .map_err(|_| "library task failed");
                }
                let _guard = LIBRARY.lock().map_err(|_| "library unavailable")?;
                if restoring {
                    store.run_restore(job, &parent, &|_| {})
                } else {
                    store.run(job, &root, &|_| {})
                }
                .map_err(|_| "library task failed")
            });
            Ok(response)
        })
        .await
        .map_err(|_| "visual_assets_backup_unavailable")?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        if crate::resource_export_picker::context(&window, &workspace)? != context {
            return Err("visual_assets_window_changed".to_string());
        }
        if let Request::CancelBackup { job_id } = request {
            store
                .cancel(&job_id)
                .map_err(|_| "visual_assets_backup_cancel_unavailable")?;
            let job = store
                .latest()
                .map_err(|_| "visual_assets_backup_unavailable")?;
            return Ok(json!({ "job": job }));
        }
        let job = store
            .latest_for_display()
            .map_err(|_| "visual_assets_backup_unavailable")?;
        Ok(json!({"job": job}))
    })
    .await
    .map_err(|_| "visual_assets_backup_unavailable")?
}

pub(super) fn spawn_task(
    store: Arc<Store>,
    job: Job,
    run: impl FnOnce(&Store, &Job) -> Result<(), &'static str> + Send + 'static,
) {
    tauri::async_runtime::spawn_blocking(move || {
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(&store, &job)));
        if !matches!(outcome, Ok(Ok(()))) {
            // Ordinary failures are recorded by the runner. Reconcile failures before it records state.
            if let Ok(Some(current)) = store.latest() {
                if current.id == job.id
                    && matches!(
                        current.state.as_str(),
                        "queued" | "running" | "publishing" | "cancelling"
                    )
                {
                    let _ = store.interrupted(&job.id);
                }
            }
        }
    });
}
