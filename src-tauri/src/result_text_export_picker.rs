//! Workspace-owned result exports. Raw paths stay inside the native save picker.
use crate::{host_server::HostServer, resource_export_picker::context};
use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
#[tauri::command]
pub(crate) async fn select_result_text_export(app: AppHandle, window: WebviewWindow, workspace_id: String, source: Value) -> Result<Option<Value>, String> {
    let original = context(&window,&workspace_id)?;
    app.state::<HostServer>().result_text_export_metadata(&original,source.clone())?;
    let initial = app.state::<HostServer>().project_resource_root(&workspace_id)?;
    let picked = tauri::async_runtime::spawn_blocking(move || app.dialog().file().set_directory(initial)
        .set_file_name("result.txt").add_filter("Text", &["txt"]).blocking_save_file()).await.map_err(|_| "result_export_picker_unavailable")?;
    if context(&window,&workspace_id)? != original { return Err("result_export_window_changed".into()); }
    picked.map(|file| window.state::<HostServer>().prepare_result_text_export(original,source,
        file.into_path().map_err(|_| "result_export_path_invalid")?)).transpose()
}
#[tauri::command]
pub(crate) async fn commit_result_text_export(window: WebviewWindow, workspace_id: String, source: Value, grant_id: String, confirmed: bool) -> Result<Value, String> {
    let original = context(&window,&workspace_id)?;
    tauri::async_runtime::spawn_blocking(move || window.state::<HostServer>().commit_result_text_export(original,source,grant_id,confirmed))
        .await.map_err(|_| "result_export_unavailable")?
}
#[tauri::command]
pub(crate) fn cancel_result_text_export(window: WebviewWindow, workspace_id: String, source: Value, grant_id: String) -> Result<(), String> {
    window.state::<HostServer>().cancel_result_text_export(context(&window,&workspace_id)?,source,grant_id)
}
#[tauri::command]
pub(crate) async fn verify_result_text_export(window: WebviewWindow, workspace_id: String, source: Value, grant_id: String) -> Result<Value, String> {
    let original = context(&window,&workspace_id)?;
    tauri::async_runtime::spawn_blocking(move || window.state::<HostServer>().verify_result_text_export(original,source,grant_id))
        .await.map_err(|_| "result_export_unavailable")?
}
