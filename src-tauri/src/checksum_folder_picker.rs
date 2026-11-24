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
    let selected = pick_local_folder(app, initial).await?;
    if context(&window, &workspace_id).ok().as_ref() != Some(&original) {
        return Err("resource_directory_window_changed".into());
    }
    let Some(path) = selected else {
        return Ok(None);
    };
    let host = window.state::<HostServer>();
    let preview = host
        .prepare_native_checksum_folder(original.clone(), owner.clone(), manifest, path)
        .await?;
    accept_preview(&window, &workspace_id, original, owner, preview)
}

#[tauri::command]
pub(crate) async fn select_directory_usage(
    app: AppHandle,
    window: WebviewWindow,
    workspace_id: String,
    owner: Value,
) -> Result<Option<Value>, String> {
    let original = context(&window, &workspace_id)?;
    let initial = app
        .state::<HostServer>()
        .project_resource_root(&workspace_id)?;
    let selected = pick_local_folder(app, initial).await?;
    if context(&window, &workspace_id).ok().as_ref() != Some(&original) {
        return Err("resource_directory_window_changed".into());
    }
    let Some(path) = selected else {
        return Ok(None);
    };
    let preview = window
        .state::<HostServer>()
        .prepare_native_directory_usage(original.clone(), owner.clone(), path)
        .await?;
    accept_preview(&window, &workspace_id, original, owner, preview)
}

#[tauri::command]
pub(crate) async fn prepare_explorer_directory_usage(
    window: WebviewWindow,
    workspace_id: String,
    owner: Value,
) -> Result<Option<Value>, String> {
    let original = context(&window, &workspace_id)?;
    let (_, session) = crate::desktop_tools::route_identity(&original.route)?;
    if owner.get("sessionId").and_then(Value::as_str) != Some(session) {
        return Err("resource_authorization_changed".into());
    }
    let Some(path) = window
        .state::<crate::explorer_launch_state::ExplorerLaunchState>()
        .take_directory_usage(&original.window, &original.route)?
    else {
        return Ok(None);
    };
    let preview = window
        .state::<HostServer>()
        .prepare_native_directory_usage(original.clone(), owner.clone(), path)
        .await?;
    accept_preview(&window, &workspace_id, original, owner, preview)
}

async fn pick_local_folder(
    app: AppHandle,
    initial: std::path::PathBuf,
) -> Result<Option<std::path::PathBuf>, String> {
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_directory(initial)
            .blocking_pick_folder()
    })
    .await
    .map_err(|_| "resource_directory_picker_unavailable")?;
    selected
        .map(|folder| {
            folder
                .into_path()
                .map_err(|_| "resource_directory_path_invalid".to_owned())
        })
        .transpose()
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
            let _ = window.state::<HostServer>().cancel_native_plugin_directory(
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
    let selected = pick_local_files(app, initial).await?;
    if context(&window, &workspace_id)? != original {
        return Err("resource_directory_window_changed".into());
    }
    let Some(selected) = selected else {
        return Ok(None);
    };
    let host = window.state::<HostServer>();
    let preview = host
        .prepare_native_checksum_files(original.clone(), owner.clone(), selected)
        .await?;
    accept_preview(&window, &workspace_id, original, owner, preview)
}

async fn pick_local_files(
    app: AppHandle,
    initial: std::path::PathBuf,
) -> Result<Option<Vec<std::path::PathBuf>>, String> {
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_directory(initial)
            .blocking_pick_files()
    })
    .await
    .map_err(|_| "resource_directory_picker_unavailable")?;
    selected
        .map(|files| {
            files
                .into_iter()
                .map(|file| {
                    file.into_path()
                        .map_err(|_| "resource_directory_path_invalid".to_owned())
                })
                .collect()
        })
        .transpose()
}

#[tauri::command]
pub(crate) async fn select_digest_files(
    app: AppHandle,
    window: WebviewWindow,
    workspace_id: String,
    owner: Value,
) -> Result<Option<Value>, String> {
    let original = context(&window, &workspace_id)?;
    let initial = app
        .state::<HostServer>()
        .project_resource_root(&workspace_id)?;
    let selected = pick_local_files(app, initial).await?;
    if context(&window, &workspace_id).ok().as_ref() != Some(&original) {
        return Err("resource_directory_window_changed".into());
    }
    let Some(selected) = selected else {
        return Ok(None);
    };
    let host = window.state::<HostServer>();
    let preview = host
        .prepare_native_digest_files(original.clone(), owner.clone(), selected)
        .await?;
    if context(&window, &workspace_id).ok().as_ref() != Some(&original) {
        if let Some(files) = preview["files"].as_array() {
            for id in files.iter().filter_map(|file| file["grantId"].as_str()) {
                let _ = host.cancel_native_digest_file(&original, owner.clone(), id.to_owned());
            }
        }
        return Err("resource_directory_window_changed".into());
    }
    Ok(Some(preview))
}

#[tauri::command]
pub(crate) async fn commit_digest_file(
    window: WebviewWindow,
    workspace_id: String,
    owner: Value,
    grant_id: String,
    confirmed: bool,
) -> Result<Value, String> {
    let original = context(&window, &workspace_id)?;
    let host = window.state::<HostServer>();
    let result = host
        .commit_native_digest_file(original.clone(), owner, grant_id, confirmed)
        .await?;
    if context(&window, &workspace_id).ok().as_ref() != Some(&original) {
        host.discard_native_resource(&result);
        return Err("resource_directory_window_changed".into());
    }
    Ok(result)
}

#[tauri::command]
pub(crate) fn cancel_digest_file(
    window: WebviewWindow,
    workspace_id: String,
    owner: Value,
    grant_id: String,
) -> Result<Value, String> {
    window.state::<HostServer>().cancel_native_digest_file(
        &context(&window, &workspace_id)?,
        owner,
        grant_id,
    )
}

#[tauri::command]
pub(crate) async fn select_digest_stream_files(
    app: AppHandle, window: WebviewWindow, workspace_id: String, owner: Value,
) -> Result<Option<Value>, String> {
    let original = context(&window, &workspace_id)?;
    let initial = app.state::<HostServer>().project_resource_root(&workspace_id)?;
    let selected = pick_local_files(app, initial).await?;
    if context(&window, &workspace_id).ok().as_ref() != Some(&original) {
        return Err("resource_directory_window_changed".into());
    }
    let Some(selected) = selected else { return Ok(None); };
    let host = window.state::<HostServer>();
    let preview = host.prepare_native_digest_stream(original.clone(), owner.clone(), selected).await?;
    if context(&window, &workspace_id).ok().as_ref() != Some(&original) {
        if let Some(id) = preview["grantId"].as_str() {
            let _ = host.cancel_native_digest_stream(&original, owner, id);
        }
        return Err("resource_directory_window_changed".into());
    }
    Ok(Some(preview))
}

#[tauri::command]
pub(crate) async fn run_digest_stream_files(
    window: WebviewWindow, workspace_id: String, owner: Value, grant_id: String, confirmed: bool, expected: String,
) -> Result<Value, String> {
    let original = context(&window, &workspace_id)?;
    let result = window.state::<HostServer>().run_native_digest_stream(original.clone(), owner, grant_id, confirmed, expected).await?;
    if context(&window, &workspace_id).ok().as_ref() != Some(&original) {
        window.state::<HostServer>().discard_native_resource(&serde_json::json!({"access":result["reportAccess"]}));
        return Err("resource_directory_window_changed".into());
    }
    Ok(result)
}

#[tauri::command]
pub(crate) fn prepare_digest_stream_original(
    window: WebviewWindow, workspace_id: String, report: Value, index: usize,
) -> Result<Value, String> {
    window.state::<HostServer>().prepare_native_digest_stream_original(&context(&window, &workspace_id)?, report, index)
}

#[tauri::command]
pub(crate) fn digest_stream_progress(
    window: WebviewWindow, workspace_id: String, owner: Value, grant_id: String,
) -> Result<Value, String> {
    window.state::<HostServer>().native_digest_stream_progress(&context(&window, &workspace_id)?, owner, &grant_id)
}

#[tauri::command]
pub(crate) fn cancel_digest_stream(
    window: WebviewWindow, workspace_id: String, owner: Value, grant_id: String,
) -> Result<(), String> {
    window.state::<HostServer>().cancel_native_digest_stream(&context(&window, &workspace_id)?, owner, &grant_id)
}

#[tauri::command]
pub(crate) async fn commit_plugin_directory(
    window: WebviewWindow,
    workspace_id: String,
    owner: Value,
    grant_id: String,
    confirmed: bool,
) -> Result<Value, String> {
    let original = context(&window, &workspace_id)?;
    let host = window.state::<HostServer>();
    let result = host
        .commit_native_plugin_directory(original.clone(), owner, grant_id, confirmed)
        .await?;
    if context(&window, &workspace_id).ok().as_ref() != Some(&original) {
        host.discard_native_resource(&result);
        return Err("resource_directory_window_changed".into());
    }
    Ok(result)
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
pub(crate) fn cancel_plugin_directory(
    window: WebviewWindow,
    workspace_id: String,
    owner: Value,
    grant_id: String,
) -> Result<Value, String> {
    window.state::<HostServer>().cancel_native_plugin_directory(
        &context(&window, &workspace_id)?,
        owner,
        grant_id,
    )
}
