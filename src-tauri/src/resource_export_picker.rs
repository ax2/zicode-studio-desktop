//! Native commands available only to trusted workspace windows, not plugin iframes.
use crate::{
    host_server::{HostServer, ResourceExportContext},
    WindowWorkspaceState,
};
use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
pub(crate) fn context(window: &WebviewWindow, workspace: &str) -> Result<ResourceExportContext, String> {
    crate::require_workspace_window(window)?;
    let state = window.state::<WindowWorkspaceState>();
    let entries = state
        .0
        .lock()
        .map_err(|_| "resource_export_window_changed")?;
    if entries.get(window.label()).map(String::as_str) != Some(workspace) {
        return Err("resource_export_window_changed".into());
    }
    Ok(ResourceExportContext {
        window: window.label().into(),
        workspace: workspace.into(),
        route: window
            .url()
            .map_err(|_| "resource_export_window_changed")?
            .path()
            .into(),
    })
}
#[tauri::command]
pub(crate) async fn select_resource_export(
    app: AppHandle,
    window: WebviewWindow,
    workspace_id: String,
    source: Value,
) -> Result<Option<Value>, String> {
    let original = context(&window, &workspace_id)?;
    let metadata = app
        .state::<HostServer>()
        .resource_export_metadata(&original, source.clone())?;
    let extension = metadata["extension"]
        .as_str()
        .ok_or("resource_metadata_invalid")?
        .to_string();
    let initial = app
        .state::<HostServer>()
        .project_resource_root(&workspace_id)?;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_directory(initial)
            .set_file_name(format!("result.{extension}"))
            .add_filter("Output", &[&extension])
            .blocking_save_file()
    })
    .await
    .map_err(|_| "resource_export_picker_unavailable")?;
    if context(&window, &workspace_id)? != original {
        return Err("resource_export_window_changed".into());
    }
    picked
        .map(|file| {
            window.state::<HostServer>().prepare_resource_export(
                original,
                source,
                file.into_path()
                    .map_err(|_| "resource_export_path_invalid")?,
            )
        })
        .transpose()
}
#[tauri::command]
pub(crate) async fn commit_resource_export(
    window: WebviewWindow,
    workspace_id: String,
    source: Value,
    grant_id: String,
    confirmed: bool,
) -> Result<Value, String> {
    let original = context(&window, &workspace_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        window
            .state::<HostServer>()
            .commit_resource_export(original, source, grant_id, confirmed)
    })
    .await
    .map_err(|_| "resource_export_unavailable")?
}
#[tauri::command]
pub(crate) fn cancel_resource_export(
    window: WebviewWindow,
    workspace_id: String,
    source: Value,
    grant_id: String,
) -> Result<(), String> {
    window.state::<HostServer>().cancel_resource_export(
        context(&window, &workspace_id)?,
        source,
        grant_id,
    )
}
#[tauri::command]
pub(crate) async fn verify_resource_export(
    window: WebviewWindow,
    workspace_id: String,
    source: Value,
    grant_id: String,
) -> Result<Value, String> {
    let original = context(&window, &workspace_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        window
            .state::<HostServer>()
            .verify_resource_export(original, source, grant_id)
    })
    .await
    .map_err(|_| "resource_export_unavailable")?
}
