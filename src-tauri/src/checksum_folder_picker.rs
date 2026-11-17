//! Only the native dialog supplies the absolute directory path to the Host.
use crate::{host_server::HostServer, resource_export_picker::context};
use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub(crate) async fn select_checksum_folder(
    app: AppHandle,
    window: WebviewWindow,
    workspace_id: String,
    owner: Value,
    manifest: String,
) -> Result<Option<Value>, String> {
    let original = context(&window, &workspace_id)?;
    let initial = app
        .state::<HostServer>()
        .project_resource_root(&workspace_id)?;
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_directory(initial)
            .blocking_pick_folder()
    })
    .await
    .map_err(|_| "resource_directory_picker_unavailable")?;
    if context(&window, &workspace_id)? != original {
        return Err("resource_directory_window_changed".into());
    }
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| "resource_directory_path_invalid")?;
    let host = window.state::<HostServer>();
    let preview = host
        .prepare_native_checksum_folder(original.clone(), owner.clone(), manifest, path)
        .await?;
    accept_preview(&window, &workspace_id, original, owner, preview)
}

fn accept_preview(
    window: &WebviewWindow,
    workspace_id: &str,
    original: crate::host_server::ResourceExportContext,
    owner: Value,
    preview: Value,
) -> Result<Option<Value>, String> {
    if context(window, workspace_id).ok().as_ref() != Some(&original) {
        if let Some(grant) = preview["grantId"].as_str() {
            let _ = window.state::<HostServer>().cancel_native_checksum_folder(
                &original,
                owner,
                grant.to_owned(),
            );
        }
        return Err("resource_directory_window_changed".into());
    }
    Ok(Some(preview))
}

#[tauri::command]
pub(crate) async fn select_checksum_files(
    app: AppHandle,
    window: WebviewWindow,
    workspace_id: String,
    owner: Value,
) -> Result<Option<Value>, String> {
    let original = context(&window, &workspace_id)?;
    let initial = app
        .state::<HostServer>()
        .project_resource_root(&workspace_id)?;
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_directory(initial)
            .blocking_pick_files()
    })
    .await
    .map_err(|_| "resource_directory_picker_unavailable")?;
    if context(&window, &workspace_id)? != original {
        return Err("resource_directory_window_changed".into());
    }
    let Some(selected) = selected else {
        return Ok(None);
    };
    let selected = selected
        .into_iter()
        .map(|file| {
            file.into_path()
                .map_err(|_| "resource_directory_path_invalid")
        })
        .collect::<Result<Vec<_>, _>>()?;
    let host = window.state::<HostServer>();
    let preview = host
        .prepare_native_checksum_files(original.clone(), owner.clone(), selected)
        .await?;
    accept_preview(&window, &workspace_id, original, owner, preview)
}

#[tauri::command]
pub(crate) async fn commit_checksum_folder(
    window: WebviewWindow,
    workspace_id: String,
    owner: Value,
    grant_id: String,
    confirmed: bool,
) -> Result<Value, String> {
    let original = context(&window, &workspace_id)?;
    let report = window
        .state::<HostServer>()
        .commit_native_checksum_folder(original.clone(), owner, grant_id, confirmed)
        .await?;
    if context(&window, &workspace_id)? != original {
        return Err("resource_directory_window_changed".into());
    }
    Ok(report)
}

#[tauri::command]
pub(crate) fn checksum_folder_progress(
    window: WebviewWindow,
    workspace_id: String,
    owner: Value,
    grant_id: String,
) -> Result<Value, String> {
    window
        .state::<HostServer>()
        .native_checksum_folder_progress(&context(&window, &workspace_id)?, owner, &grant_id)
}

#[tauri::command]
pub(crate) fn cancel_checksum_folder(
    window: WebviewWindow,
    workspace_id: String,
    owner: Value,
    grant_id: String,
) -> Result<Value, String> {
    window.state::<HostServer>().cancel_native_checksum_folder(
        &context(&window, &workspace_id)?,
        owner,
        grant_id,
    )
}
