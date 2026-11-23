//! Blog sites are selected through a native directory picker and remain local to the profile.
mod assets;
mod catalog;
mod git;
mod site;

use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

static OPERATIONS: Mutex<()> = Mutex::new(());

fn selection(file: &Path) -> Result<Option<PathBuf>, String> {
    match fs::read(file) {
        Ok(bytes) => serde_json::from_slice::<PathBuf>(&bytes)
            .map(Some)
            .map_err(|_| "blog_selection_invalid".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("blog_selection_unavailable".into()),
    }
}

fn listing(root: Option<&Path>) -> Result<Value, String> {
    let Some(root) = root else {
        return Ok(
            json!({"root":null,"paths":[],"changedPaths":[],"pendingPush":false,"homepagePicks":false}),
        );
    };
    if site::detect(root)? != root {
        return Err("blog_site_changed".into());
    }
    let paths = site::list(root)?;
    let state = git::status(root);
    let catalog = catalog::summaries(root, &paths);
    Ok(json!({
        "root": crate::process_command::working_directory(root),
        "paths": paths,
        "catalog": catalog,
        "homepagePicks": site::resolve(root, "@homepagePicks", false).is_ok(),
        "changedPaths": state.as_ref().map(|s| &s.changed).cloned().unwrap_or_default(),
        "pendingPush": state.as_ref().is_ok_and(|s| s.pending),
        "gitAvailable": state.is_ok()
    }))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Keep each user approval distinct in the IPC payload.
pub(crate) async fn blog_workspace(
    window: WebviewWindow,
    action: String,
    site: Option<String>,
    path: Option<String>,
    text: Option<String>,
    expected: Option<String>,
    paths: Option<Vec<String>>,
    owners: Option<Vec<String>>,
    deletions: Option<Vec<String>>,
) -> Result<Value, String> {
    crate::require_workspace_window(&window)?;
    let config = crate::app_paths::data_root()?.join("blog-workspace.json");
    tauri::async_runtime::spawn_blocking(move || {
        let picked = if action == "choose" {
            window
                .app_handle()
                .dialog()
                .file()
                .set_parent(&window)
                .blocking_pick_folder()
        } else {
            None
        };
        let _guard = OPERATIONS.lock().map_err(|_| "blog_busy")?;
        crate::require_workspace_window(&window)?;
        if let Some(directory) = picked {
            let selected = site::detect(&directory.into_path().map_err(|_| "blog_invalid_site")?)?;
            let result = listing(Some(&selected))?;
            fs::create_dir_all(config.parent().ok_or("blog_selection_invalid")?)
                .map_err(|_| "blog_selection_unavailable")?;
            let bytes = serde_json::to_vec(&selected).map_err(|_| "blog_selection_invalid")?;
            site::replace(&config, &bytes, false)?;
            return Ok(result);
        }
        let root = selection(&config)?;
        if matches!(action.as_str(), "list" | "choose") {
            return listing(root.as_deref());
        }
        let root = root.ok_or("blog_select_site")?;
        let presented = crate::process_command::working_directory(&root);
        if site.as_deref().map(Path::new) != Some(presented.as_path())
            || site::detect(&root)? != root
        {
            return Err("blog_site_changed".into());
        }
        match action.as_str() {
            "read" => Ok(json!(site::read(&site::resolve(
                &root,
                path.as_deref().ok_or("blog_invalid_path")?,
                false
            )?)?)),
            "save" => {
                let key = path.as_deref().ok_or("blog_invalid_path")?;
                let new = text.ok_or("blog_missing_text")?;
                site::save(&root, key, &new, expected.as_deref())?;
                Ok(json!(new))
            }
            "pull" | "push" => {
                git::sync(
                    &root,
                    &action,
                    paths.unwrap_or_default(),
                    owners.unwrap_or_default(),
                    deletions.unwrap_or_default(),
                )?;
                listing(Some(&root))
            }
            "preview" => Ok(json!(git::preview(&root, &paths.unwrap_or_default())?)),
            _ => Err("blog_unknown_action".into()),
        }
    })
    .await
    .map_err(|_| "blog_unavailable".to_owned())?
}
