#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_paths;
mod article_markdown;
mod articles;
mod articles_config;
mod artifact_store;
mod automation_inventory;
mod automation_login_start;
mod automation_persistence;
mod automation_worker;
mod application_context;
mod backup_store;
mod blog_deploy;
mod clipboard_inbox;
mod credential_broker;
mod desktop_profile;
mod desktop_tray;
mod explorer_entry;
mod explorer_menu;
mod document_import;
mod e2ee;
mod habit_tracker;
mod host_data;
mod host_router;
mod host_server;
mod idphoto;
mod image_tools;
mod metadata_store;
mod model_tools;
mod native_pi_manager;
mod notes_vault;
mod ocr;
mod p2p;
mod pi_launch;
mod pi_rpc_bridge;
mod plugin_capabilities;
mod plugin_package;
mod plugin_registry;
mod plugin_worker;
mod process_command;
mod project_environment;
mod project_storage;
mod project_tasks;
mod project_terminal;
mod relay_client;
mod relay_protocol;
mod remote_access_config;
mod remote_auth;
mod remote_enrollment;
mod remote_tls;
mod runtime_coordinator;
mod runtime_isolation;
mod scene_profiles;
mod settings_store;
mod summary;
mod translation;
mod turn_probe;
mod web_extract;
mod web_watch;
mod wechat_publish;

use host_server::HostServer;
use metadata_store::MetadataStore;
use native_pi_manager::NativePiManager;
use pi_launch::{configure_bundled_tool_path, PiLaunchResolver};
use plugin_package::SignedPluginPreview;
use remote_auth::RemoteAuth;
use runtime_coordinator::RuntimeTarget;
use scene_profiles::{delete_scene_profile, list_scene_profiles, save_scene_profile};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::image::Image;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use explorer_menu::desktop_explorer_menu;
mod project_file_picker;
use project_file_picker::{get_project_resource_entry, select_project_resource_file};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_dialog::MessageDialogKind;
use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
fn store_scene_credential(
    scene_id: String,
    provider: String,
    secret: String,
) -> Result<(), String> {
    credential_broker::store_scene_credential(&scene_id, &provider, &secret)
}

/// Show a best-effort desktop notification for background work on supported
/// Windows, macOS and Linux notification backends.
/// Best-effort: failures are logged and never surface to the caller.
#[tauri::command]
fn send_desktop_notification(title: String, body: String) {
    let title: String = title.chars().take(120).collect();
    let body: String = body.chars().take(240).collect();
    if title.is_empty() {
        return;
    }
    let _ = std::thread::spawn(move || {
        if let Err(error) = notify_rust::Notification::new()
            .appname("ZiCode Studio Desktop")
            .summary(&title)
            .body(&body)
            .show()
        {
            log::warn!("[notification] failed to show desktop notification: {error}");
        }
    });
}

#[cfg(test)]
mod desktop_notification_tests {
    #[test]
    fn notification_backend_is_available_on_host() {
        // Smoke test: the Windows toast backend must accept a notification on
        // this machine. Failing here means the toast plumbing is broken (for
        // example no AppUserModelID), which the command would otherwise only
        // surface as a log warning at runtime.
        let result = notify_rust::Notification::new()
            .appname("ZiCode Studio Desktop")
            .summary("ZiCode Studio Desktop")
            .body("Desktop notification backend smoke test")
            .show();
        assert!(
            result.is_ok(),
            "desktop notification backend failed: {result:?}",
        );
    }
}

#[tauri::command]
fn delete_scene_credential(scene_id: String, provider: String) -> Result<(), String> {
    credential_broker::delete_scene_credential(&scene_id, &provider)
}

#[tauri::command]
fn scene_credential_status(
    scene_id: String,
    provider: String,
) -> Result<credential_broker::CredentialStatus, String> {
    credential_broker::scene_credential_status(&scene_id, &provider)
}

#[tauri::command]
async fn publish_notes_notebook(
    host: tauri::State<'_, HostServer>,
    workspace_id: String,
    notebook_id: String,
) -> Result<notes_vault::AstroPublishReport, String> {
    let vault = host
        .notes_vault()?
        .scoped(&workspace_id)
        .map_err(|error| error.message)?;
    tauri::async_runtime::spawn_blocking(move || vault.publish_astro(&notebook_id))
        .await
        .map_err(|error| format!("Astro publisher stopped unexpectedly: {error}"))?
        .map_err(|error| error.message)
}

type NativePiManagerState = NativePiManager;

#[derive(Default)]
struct BackgroundWorkerUpdateLease(
    tokio::sync::Mutex<Option<(String, automation_worker::UpdateLease)>>,
);

async fn reserve_background_worker_for_update(
    app: &AppHandle,
    window: &WebviewWindow,
) -> Result<(), String> {
    require_workspace_window(window)?;
    let state = app.state::<BackgroundWorkerUpdateLease>();
    let mut held = state.0.lock().await;
    if held.is_some() {
        return Err("An app update is already in progress".into());
    }
    let lease = automation_worker::stop_for_update().await?;
    *held = Some((window.label().to_owned(), lease));
    Ok(())
}

async fn release_background_worker_update_lease(
    app: &AppHandle,
    window: &WebviewWindow,
    restart_on_failure: bool,
) -> Result<(), String> {
    require_workspace_window(window)?;
    let state = app.state::<BackgroundWorkerUpdateLease>();
    let mut held = state.0.lock().await;
    let lease = if held
        .as_ref()
        .is_some_and(|(owner, _)| owner == window.label())
    {
        held.take().map(|(_, lease)| lease)
    } else {
        None
    };
    drop(held);
    if let Some(lease) = lease {
        let was_running = lease.was_running();
        drop(lease);
        if restart_on_failure && was_running {
            let public_dir = static_dir_for_resource(app.path().resource_dir().ok());
            tauri::async_runtime::spawn_blocking(move || {
                automation_worker::resume_after_update(&public_dir)
            })
            .await
            .map_err(|error| format!("Automation worker restart stopped: {error}"))??;
        }
    }
    Ok(())
}

const BETA_UPDATE_ENDPOINT: &str =
    "https://github.com/ax2/zicode-studio-desktop/releases/download/beta/latest.json";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BetaUpdateInfo {
    version: String,
    date: Option<String>,
    body: Option<String>,
}

fn beta_updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let endpoint = reqwest::Url::parse(BETA_UPDATE_ENDPOINT)
        .map_err(|error| format!("Invalid beta updater endpoint: {error}"))?;
    app.updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| format!("Invalid beta updater configuration: {error}"))?
        .build()
        .map_err(|error| format!("Failed to initialize beta updater: {error}"))
}

#[tauri::command]
async fn check_beta_update(app: AppHandle) -> Result<Option<BetaUpdateInfo>, String> {
    let updater = beta_updater(&app)?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("Beta update check failed: {error}"))?;
    Ok(update.map(|update| BetaUpdateInfo {
        version: update.version,
        date: update.date.map(|date| date.to_string()),
        body: update.body,
    }))
}

#[tauri::command]
async fn install_beta_update(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let updater = beta_updater(&app)?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("Beta update check failed: {error}"))?
        .ok_or_else(|| "No beta update is available".to_string())?;
    reserve_background_worker_for_update(&app, &window).await?;
    let result = update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| format!("Beta update installation failed: {error}"));
    if result.is_err() {
        if let Err(error) = release_background_worker_update_lease(&app, &window, true).await {
            log::warn!("[automation-worker] could not resume after beta update failure: {error}");
        }
    }
    result
}

/// Shared services needed to bring up an additional workspace window after
/// startup (when the user opens a folder as a new workspace).
struct WorkspaceLauncher {
    metadata: Arc<Mutex<MetadataStore>>,
    launch: PiLaunchResolver,
}

struct FocusedWorkspaceState(Mutex<Option<String>>);
struct WindowWorkspaceState(Mutex<HashMap<String, String>>);

/// Open the native folder picker and, if the user selects a directory, switch
/// the focused ZiCode Studio Desktop window to that workspace. Returns the chosen path, or
/// `None` if cancelled.
#[tauri::command]
async fn open_folder_as_workspace(
    app: AppHandle,
    window: WebviewWindow,
    plugin_id: Option<String>,
) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked
        .as_path()
        .ok_or_else(|| "Selected folder is not a local path".to_string())?
        .to_path_buf();
    open_workspace_at_path(&app, Some(&window), &path, None, plugin_id.as_deref())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Select a local developer plugin directory, validate and copy it into the
/// managed plugin registry. Cancelling the picker has no side effects.
#[tauri::command]
async fn select_and_install_developer_plugin(app: AppHandle) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let source = picked
        .as_path()
        .ok_or_else(|| "Selected plugin folder is not a local path".to_string())?;
    let host = app
        .try_state::<HostServer>()
        .ok_or_else(|| "Host server is not ready".to_string())?;
    host.install_developer_plugin(source).map(Some)
}

#[tauri::command]
async fn select_signed_plugin_package(
    app: AppHandle,
) -> Result<Option<SignedPluginPreview>, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("ZiCode plugin", &["zicode-plugin"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked
        .as_path()
        .ok_or_else(|| "Selected signed plugin is not a local file".to_string())?;
    let host = app
        .try_state::<HostServer>()
        .ok_or_else(|| "Host server is not ready".to_string())?;
    host.preview_signed_plugin(path).map(Some)
}

#[tauri::command]
async fn install_signed_plugin_package(
    app: AppHandle,
    package_path: String,
    trust_publisher: bool,
) -> Result<String, String> {
    let host = app
        .try_state::<HostServer>()
        .ok_or_else(|| "Host server is not ready".to_string())?;
    host.install_signed_plugin(Path::new(&package_path), trust_publisher)
}

#[tauri::command]
async fn rollback_signed_plugin_package(
    app: AppHandle,
    plugin_id: String,
    version: String,
) -> Result<(), String> {
    let host = app
        .try_state::<HostServer>()
        .ok_or_else(|| "Host server is not ready".to_string())?;
    host.rollback_signed_plugin(&plugin_id, &version)
}

#[tauri::command]
async fn revoke_plugin_publisher(app: AppHandle, key_id: String) -> Result<(), String> {
    let host = app
        .try_state::<HostServer>()
        .ok_or_else(|| "Host server is not ready".to_string())?;
    host.revoke_plugin_publisher(&key_id)
}

/// Open a brand-new session in the given workspace (identified by its
/// file-system path). If the workspace window is already open, spawn a fresh
/// runtime and navigate that window to the new temporary session; otherwise
/// open a new workspace window at the fresh session.
#[tauri::command]
async fn open_new_session_in_workspace(
    app: AppHandle,
    window: WebviewWindow,
    project_path: String,
    scene_id: Option<String>,
    plugin_id: Option<String>,
) -> Result<(), String> {
    let cwd = PathBuf::from(&project_path);
    if !cwd.is_dir() {
        return Err(format!("Project folder no longer exists: {project_path}"));
    }
    open_fresh_session_at_path(
        &app,
        Some(&window),
        &cwd,
        scene_id.as_deref(),
        plugin_id.as_deref(),
    )
}

/// Switch the current window to another registered workspace without leaving
/// the application the user is in: a fresh runtime is spawned for the target
/// project and the window navigates to the same app route (`?app=` preserves
/// the active plugin) instead of always landing on a new Chat session.
#[tauri::command]
async fn switch_window_workspace(
    app: AppHandle,
    window: WebviewWindow,
    project_path: String,
    plugin_id: Option<String>,
) -> Result<(), String> {
    let cwd = PathBuf::from(&project_path);
    if !cwd.is_dir() {
        return Err(format!("Project folder no longer exists: {project_path}"));
    }
    open_fresh_session_at_path(&app, Some(&window), &cwd, None, plugin_id.as_deref())
}

#[derive(serde::Serialize)]
struct WorkspaceInfo {
    id: String,
    path: String,
}

/// List every workspace registered in the metadata store so the desktop
/// workspace switcher can offer one-click navigation between opened projects.
#[tauri::command]
fn list_workspaces(app: AppHandle) -> Result<Vec<WorkspaceInfo>, String> {
    let launcher = app
        .try_state::<WorkspaceLauncher>()
        .ok_or_else(|| "Workspace launcher is not ready".to_string())?;
    let metadata = launcher
        .metadata
        .lock()
        .map_err(|_| "ZiCode Studio Desktop metadata store is unavailable".to_string())?;
    Ok(metadata
        .list_workspaces()?
        .into_iter()
        .map(|(id, path)| WorkspaceInfo { id, path })
        .collect())
}

/// Read-only visibility into automation rules in all registered workspaces.
/// Scanning is bounded and runs off the UI thread; it never dispatches tasks.
#[tauri::command]
async fn list_automation_workspaces(
    app: AppHandle,
) -> Result<Vec<automation_inventory::AutomationWorkspaceStatus>, String> {
    let launcher = app
        .try_state::<WorkspaceLauncher>()
        .ok_or_else(|| "Workspace launcher is not ready".to_string())?;
    let workspaces = launcher
        .metadata
        .lock()
        .map_err(|_| "ZiCode Studio Desktop metadata store is unavailable".to_string())?
        .list_workspaces()?;
    tauri::async_runtime::spawn_blocking(move || {
        automation_inventory::scan_registered_workspaces(workspaces)
    })
    .await
    .map_err(|error| format!("Automation inventory stopped unexpectedly: {error}"))
}

fn require_workspace_window(window: &WebviewWindow) -> Result<(), String> {
    if !window.label().starts_with("native-workspace-") {
        return Err("Automation worker controls require a desktop workspace window".into());
    }
    let host = window
        .try_state::<HostServer>()
        .ok_or_else(|| "Desktop host is unavailable".to_string())?;
    let expected = reqwest::Url::parse(host.origin())
        .map_err(|_| "Desktop host origin is invalid".to_string())?;
    let current = window
        .url()
        .map_err(|_| "Cannot inspect desktop window origin".to_string())?;
    if current.origin() != expected.origin() {
        return Err("Automation worker controls require the desktop host origin".into());
    }
    Ok(())
}

#[tauri::command]
fn background_automation_worker_status(window: WebviewWindow) -> Result<String, String> {
    require_workspace_window(&window)?;
    automation_worker::status().map(str::to_owned)
}

#[tauri::command]
async fn start_background_automation_worker(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<String, String> {
    require_workspace_window(&window)?;
    let public_dir = static_dir_for_resource(app.path().resource_dir().ok());
    tauri::async_runtime::spawn_blocking(move || automation_worker::start(&public_dir))
        .await
        .map_err(|error| format!("Automation worker launch stopped: {error}"))?
        .map(str::to_owned)
}

#[tauri::command]
async fn background_automation_login_start_enabled(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<bool, String> {
    require_workspace_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || automation_login_start::enabled(&app))
        .await
        .map_err(|error| format!("Background login start check stopped: {error}"))?
}

#[tauri::command]
async fn set_background_automation_login_start(
    app: AppHandle,
    window: WebviewWindow,
    enabled: bool,
) -> Result<bool, String> {
    require_workspace_window(&window)?;
    let public_dir = static_dir_for_resource(app.path().resource_dir().ok());
    if enabled && !public_dir.join("index.html").is_file() {
        return Err("Automation worker resources are unavailable".into());
    }
    tauri::async_runtime::spawn_blocking(move || automation_login_start::set(&app, enabled))
        .await
        .map_err(|error| format!("Background login start update stopped: {error}"))?
}

#[tauri::command]
fn stop_background_automation_worker(window: WebviewWindow) -> Result<String, String> {
    require_workspace_window(&window)?;
    automation_worker::request_stop_explicit()?;
    Ok("stopping".into())
}

#[tauri::command]
async fn prepare_background_automation_worker_for_update(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    reserve_background_worker_for_update(&app, &window).await
}

#[tauri::command]
async fn finish_background_automation_worker_update(
    app: AppHandle,
    window: WebviewWindow,
    restart_on_failure: bool,
) -> Result<(), String> {
    release_background_worker_update_lease(&app, &window, restart_on_failure).await
}

/// Read-only logical sizes for common generated directories in a registered workspace.
static PROJECT_STORAGE_SCAN_LIMIT: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();

#[tauri::command]
async fn inspect_project_storage(
    app: AppHandle,
    workspace_id: String,
    directory: String,
) -> Result<project_storage::StorageReport, String> {
    let root = resolve_workspace_root(&app, &workspace_id)?;
    let gate = PROJECT_STORAGE_SCAN_LIMIT
        .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(1)))
        .clone();
    let permit = gate
        .try_acquire_owned()
        .map_err(|_| "project_storage_busy".to_string())?;
    let worker = tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        project_storage::inspect(&root, &directory)
    });
    match tokio::time::timeout(std::time::Duration::from_secs(8), worker).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("project_storage_unavailable".into()),
        Err(_) => Err("project_storage_timeout".into()),
    }
}

/// Delete a workspace with recycle-bin semantics: the workspace's ZiCode app
/// data (`<root>/.zicode`) is moved into `%LOCALAPPDATA%\zicode\trash` so it
/// can be restored manually, the workspace is un-registered, and the user's
/// own project files are never touched. The global shared workspace and the
/// Agent Inbox workspace cannot be deleted.
#[tauri::command]
fn delete_workspace(app: AppHandle, workspace_id: String) -> Result<String, String> {
    let launcher = app
        .try_state::<WorkspaceLauncher>()
        .ok_or_else(|| "Workspace launcher is not ready".to_string())?;
    let workspace_root = resolve_workspace_root(&app, &workspace_id)?;
    if let Some(reason) = protected_workspace_reason(&workspace_root)? {
        return Err(reason);
    }
    let trash_root = crate::app_paths::data_root()?.join("trash");
    let trash_dir = move_workspace_app_data_to_trash(&workspace_root, &trash_root)?;
    let manifest = serde_json::json!({
        "workspaceId": workspace_id,
        "originalRoot": workspace_root.to_string_lossy(),
        "deletedAt": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or(0),
    });
    fs::write(
        trash_dir.join("manifest.json"),
        serde_json::to_string_pretty(&manifest)
            .map_err(|error| format!("Cannot serialize workspace trash manifest: {error}"))?,
    )
    .map_err(|error| format!("Cannot write workspace trash manifest: {error}"))?;

    {
        let metadata = launcher
            .metadata
            .lock()
            .map_err(|_| "ZiCode Studio Desktop metadata store is unavailable".to_string())?;
        metadata.remove_workspace(&workspace_id)?;
    }
    let host = app.state::<crate::host_data::HostDataPlane>();
    host.unregister_workspace(&workspace_id)
        .map_err(|error| format!("Cannot unregister workspace: {error:?}"))?;

    Ok(trash_dir
        .to_str()
        .map(str::to_string)
        .unwrap_or_else(|| "workspace trash".to_string()))
}

#[derive(serde::Serialize)]
struct WorkspaceTrashEntry {
    dir: String,
    name: String,
    original_root: String,
    deleted_at: i64,
}

const WORKSPACE_TRASH_RETENTION_SECS: i64 = 30 * 24 * 60 * 60;

/// A workspace trash entry is a direct child of the trash root that carries
/// a manifest. Arbitrary folders under the trash root are never treated as
/// entries, so cleanup and deletion can never touch unrelated data.
fn is_workspace_trash_entry(dir: &Path, trash_root: &Path) -> bool {
    dir.is_dir() && dir.parent() == Some(trash_root) && dir.join("manifest.json").is_file()
}

/// Remove workspace trash entries older than the 30-day retention window.
/// Only directories carrying a manifest are considered, so arbitrary folders
/// under the trash root are never touched. Returns the number purged.
fn purge_expired_workspace_trash(trash_root: &Path, now_secs: i64) -> Result<usize, String> {
    if !trash_root.is_dir() {
        return Ok(0);
    }
    let mut purged = 0;
    for entry in
        fs::read_dir(trash_root).map_err(|error| format!("Cannot read workspace trash: {error}"))?
    {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        if !is_workspace_trash_entry(&path, trash_root) {
            continue;
        }
        let Ok(bytes) = fs::read(path.join("manifest.json")) else {
            continue;
        };
        let Ok(manifest) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
            continue;
        };
        let Some(deleted_at) = manifest
            .get("deletedAt")
            .and_then(serde_json::Value::as_i64)
        else {
            continue;
        };
        if now_secs - deleted_at >= WORKSPACE_TRASH_RETENTION_SECS
            && fs::remove_dir_all(&path).is_ok()
        {
            purged += 1;
        }
    }
    Ok(purged)
}

/// Permanently remove every recoverable recycle bin entry immediately.
/// Only manifested direct children of the trash root are touched. Returns the
/// number of entries removed.
fn purge_all_workspace_trash(trash_root: &Path) -> Result<usize, String> {
    if !trash_root.is_dir() {
        return Ok(0);
    }
    let mut removed = 0;
    for entry in
        fs::read_dir(trash_root).map_err(|error| format!("Cannot read workspace trash: {error}"))?
    {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        if is_workspace_trash_entry(&path, trash_root) && fs::remove_dir_all(&path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// Permanently remove one recycle bin entry, refusing anything that is not a
/// manifested direct child of the trash root. This cannot be undone.
fn remove_workspace_trash_entry(dir: &Path, trash_root: &Path) -> Result<(), String> {
    if !is_workspace_trash_entry(dir, trash_root) {
        return Err("Not a workspace trash entry".to_string());
    }
    fs::remove_dir_all(dir).map_err(|error| format!("Cannot delete workspace trash entry: {error}"))
}

/// List recoverable workspace trash entries (directories under
/// `%LOCALAPPDATA%\zicode\trash` that carry a manifest), newest first.
#[tauri::command]
fn list_workspace_trash() -> Result<Vec<WorkspaceTrashEntry>, String> {
    let trash_root = crate::app_paths::data_root()?.join("trash");
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    let _ = purge_expired_workspace_trash(&trash_root, now_secs)?;
    if !trash_root.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(&trash_root)
        .map_err(|error| format!("Cannot read workspace trash: {error}"))?
    {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        if !manifest_path.is_file() {
            continue;
        }
        let manifest: serde_json::Value = serde_json::from_slice(
            &fs::read(&manifest_path)
                .map_err(|error| format!("Cannot read workspace trash manifest: {error}"))?,
        )
        .map_err(|error| format!("Cannot parse workspace trash manifest: {error}"))?;
        entries.push(WorkspaceTrashEntry {
            dir: path.to_string_lossy().to_string(),
            name: entry.file_name().to_string_lossy().to_string(),
            original_root: manifest
                .get("originalRoot")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .to_string(),
            deleted_at: manifest
                .get("deletedAt")
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(0),
        });
    }
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.deleted_at));
    Ok(entries)
}

/// Permanently delete one recycle bin entry after explicit user confirmation.
#[tauri::command]
fn delete_workspace_trash_entry(trash_dir: String) -> Result<(), String> {
    let trash_root = crate::app_paths::data_root()?.join("trash");
    remove_workspace_trash_entry(&PathBuf::from(&trash_dir), &trash_root)
}

/// Empty the whole recycle bin immediately. Returns the number of entries
/// removed.
#[tauri::command]
fn empty_workspace_trash() -> Result<usize, String> {
    let trash_root = crate::app_paths::data_root()?.join("trash");
    purge_all_workspace_trash(&trash_root)
}

/// Restore a deleted workspace from the recycle bin: moves the workspace's
/// app data back into its original project folder and re-registers it. Refuses
/// to restore when the original folder is gone or already has app data.
#[tauri::command]
fn restore_workspace(app: AppHandle, trash_dir: String) -> Result<String, String> {
    let trash_root = crate::app_paths::data_root()?.join("trash");
    let dir = PathBuf::from(&trash_dir);
    let original_root = restore_app_data_from_trash(&dir, &trash_root)?;

    let launcher = app
        .try_state::<WorkspaceLauncher>()
        .ok_or_else(|| "Workspace launcher is not ready".to_string())?;
    let restored_id = {
        let mut metadata = launcher
            .metadata
            .lock()
            .map_err(|_| "ZiCode Studio Desktop metadata store is unavailable".to_string())?;
        metadata.workspace_id_for_path(&original_root)?
    };
    let host = app.state::<crate::host_data::HostDataPlane>();
    host.register_workspace(&restored_id, original_root)
        .map_err(|error| format!("Cannot re-register workspace: {error:?}"))?;

    let _ = fs::remove_dir_all(&dir);
    Ok(restored_id)
}

/// Read a trash manifest and move the workspace app data back into its
/// original project folder. Returns the original root on success.
fn restore_app_data_from_trash(trash_dir: &Path, trash_root: &Path) -> Result<PathBuf, String> {
    if !trash_dir.starts_with(trash_root) {
        return Err("Not a workspace trash entry".to_string());
    }
    let manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(trash_dir.join("manifest.json"))
            .map_err(|_| "Workspace trash manifest is missing".to_string())?,
    )
    .map_err(|error| format!("Cannot parse workspace trash manifest: {error}"))?;
    let original_root = PathBuf::from(
        manifest
            .get("originalRoot")
            .and_then(serde_json::Value::as_str)
            .unwrap_or(""),
    );
    if !original_root.is_dir() {
        return Err("The original project folder no longer exists".to_string());
    }
    let dest = original_root.join(".zicode");
    if dest.exists() {
        return Err("The project already has a .zicode folder".to_string());
    }
    let app_data = trash_dir.join(".zicode");
    if app_data.is_dir() {
        fs::rename(&app_data, &dest)
            .map_err(|error| format!("Cannot restore workspace app data: {error}"))?;
    }
    Ok(original_root)
}

/// A workspace root that must never be deleted is protected: the global shared
/// workspace (`~/.zicode`) or the Agent Inbox workspace. Returns the reason
/// when protected, `None` when deletable.
fn protected_workspace_reason(root: &Path) -> Result<Option<String>, String> {
    let global = crate::app_paths::global_workspace_root()?;
    let inbox = crate::app_paths::agent_inbox_workspace()?;
    if root == global {
        return Ok(Some(
            "The global shared workspace cannot be deleted".to_string(),
        ));
    }
    if root == inbox {
        return Ok(Some(
            "The Agent Inbox workspace cannot be deleted".to_string(),
        ));
    }
    Ok(None)
}

/// Move a workspace's ZiCode app data (`<root>/.zicode`) into a timestamped
/// trash directory so the delete is recoverable. Never touches the user's own
/// project files outside `.zicode`.
fn move_workspace_app_data_to_trash(root: &Path, trash_root: &Path) -> Result<PathBuf, String> {
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("workspace");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let trash_dir = trash_root.join(format!("{name}-{stamp}"));
    fs::create_dir_all(&trash_dir)
        .map_err(|error| format!("Cannot create workspace trash directory: {error}"))?;
    let app_data = root.join(".zicode");
    if app_data.is_dir() {
        fs::rename(&app_data, trash_dir.join(".zicode"))
            .map_err(|error| format!("Cannot move workspace app data to trash: {error}"))?;
    }
    Ok(trash_dir)
}

/// Snapshot the workspace's `.zicode` app data into `~/.zicode/backups`.
#[tauri::command]
fn create_workspace_backup(
    app: AppHandle,
    workspace_id: String,
) -> Result<crate::backup_store::WorkspaceBackup, String> {
    let workspace_root = resolve_workspace_root(&app, &workspace_id)?;
    crate::backup_store::create_workspace_backup(&workspace_id, &workspace_root)
}

fn resolve_workspace_root(app: &AppHandle, workspace_id: &str) -> Result<PathBuf, String> {
    let launcher = app
        .try_state::<WorkspaceLauncher>()
        .ok_or_else(|| "Workspace launcher is not ready".to_string())?;
    let metadata = launcher
        .metadata
        .lock()
        .map_err(|_| "ZiCode Studio Desktop metadata store is unavailable".to_string())?;
    let workspace_root = metadata
        .list_workspaces()?
        .into_iter()
        .find(|(id, _)| id == workspace_id)
        .map(|(_, path)| path)
        .ok_or_else(|| "Workspace is not registered".to_string())?;
    Ok(PathBuf::from(workspace_root))
}

/// List available workspace snapshots, newest first.
#[tauri::command]
fn list_workspace_backups(
    workspace_id: String,
) -> Result<Vec<crate::backup_store::WorkspaceBackup>, String> {
    crate::backup_store::list_workspace_backups(&workspace_id)
}

/// Permanently remove one workspace snapshot.
#[tauri::command]
fn delete_workspace_backup(workspace_id: String, backup_id: String) -> Result<(), String> {
    crate::backup_store::delete_workspace_backup(&workspace_id, &backup_id)
}

/// Replace the workspace's app data from a snapshot; the current state is
/// snapshotted first.
#[tauri::command]
fn restore_workspace_backup(
    app: AppHandle,
    workspace_id: String,
    backup_id: String,
) -> Result<crate::backup_store::RestoreReport, String> {
    let workspace_root = resolve_workspace_root(&app, &workspace_id)?;
    crate::backup_store::restore_workspace_backup(&workspace_id, &workspace_root, &backup_id)
}

/// Switch the focused ZiCode Studio Desktop window to `projectPath` and resume the given saved
/// session in it. Used by the sidebar to jump to a session that belongs to a
/// different project without opening a second project window.
#[tauri::command]
async fn open_session_in_project(
    app: AppHandle,
    window: WebviewWindow,
    project_path: String,
    session_id: String,
) -> Result<(), String> {
    let cwd = PathBuf::from(&project_path);
    if !cwd.is_dir() {
        return Err(format!("Project folder no longer exists: {project_path}"));
    }
    let session = session_id.trim();
    let resume = if session.is_empty() {
        None
    } else {
        Some(session.to_string())
    };
    open_workspace_at_path(&app, Some(&window), &cwd, resume.as_deref(), None)
}

/// Ensure the fixed Agent Inbox workspace exists, has a sidebar-visible saved
/// session, and has a background runtime running. Unlike normal project opens,
/// this command intentionally keeps the current window in place; the frontend
/// decides whether to navigate after the refreshed session list is available.
#[tauri::command]
async fn ensure_agent_inbox_session(app: AppHandle) -> Result<(), String> {
    let cwd = agent_inbox_path()?;
    fs::create_dir_all(&cwd)
        .map_err(|error| format!("Cannot create Agent Inbox folder: {error}"))?;
    ensure_agent_inbox_placeholder_session(&cwd)?;

    let launcher = app
        .try_state::<WorkspaceLauncher>()
        .ok_or_else(|| "Workspace launcher is not ready".to_string())?;
    let host = app
        .try_state::<HostServer>()
        .ok_or_else(|| "Host server is not ready".to_string())?;
    let runtimes = app
        .try_state::<NativePiManagerState>()
        .ok_or_else(|| "Native runtime manager is not ready".to_string())?;
    let workspace_id = launcher
        .metadata
        .lock()
        .map_err(|_| "ZiCode Studio Desktop metadata store is unavailable".to_string())?
        .workspace_id_for_path(&cwd)?;

    host.register_workspace(&workspace_id, cwd.clone())?;
    if runtimes
        .statuses()
        .map(|statuses| {
            statuses
                .iter()
                .any(|status| status.target.workspace_id == workspace_id)
        })
        .unwrap_or(false)
    {
        return Ok(());
    }
    let _ = spawn_fresh_runtime(
        &runtimes,
        &launcher.launch,
        &host,
        &cwd,
        workspace_id,
        Some("programming"),
    )?;
    Ok(())
}

fn spawn_fresh_runtime(
    runtimes: &NativePiManagerState,
    launch: &PiLaunchResolver,
    host: &HostServer,
    cwd: &Path,
    workspace_id: String,
    scene_id: Option<&str>,
) -> Result<RuntimeTarget, String> {
    let session_id = format!("temporary-{}", uuid::Uuid::new_v4().simple());
    let instance_id = format!("instance-{}", uuid::Uuid::new_v4().simple());
    let target = RuntimeTarget::new(workspace_id, session_id, instance_id)
        .with_scene(scene_id.unwrap_or("programming"));
    let cwd_str = cwd.to_string_lossy().into_owned();
    let mut launch_spec = launch.native_launch_spec(&cwd_str, None, &target)?;
    host.configure_plugin_broker(&target, &mut launch_spec)?;
    runtimes.spawn(target.clone(), launch_spec)?;
    Ok(target)
}

fn open_fresh_session_at_path(
    app: &AppHandle,
    source_window: Option<&WebviewWindow>,
    cwd: &Path,
    scene_id: Option<&str>,
    app_param: Option<&str>,
) -> Result<(), String> {
    let launcher = app
        .try_state::<WorkspaceLauncher>()
        .ok_or_else(|| "Workspace launcher is not ready".to_string())?;
    let host = app
        .try_state::<HostServer>()
        .ok_or_else(|| "Host server is not ready".to_string())?;
    let runtimes = app
        .try_state::<NativePiManagerState>()
        .ok_or_else(|| "Native runtime manager is not ready".to_string())?;
    let workspace_id = launcher
        .metadata
        .lock()
        .map_err(|_| "ZiCode Studio Desktop metadata store is unavailable".to_string())?
        .workspace_id_for_path(cwd)?;

    host.register_workspace(&workspace_id, cwd.to_path_buf())?;
    let target = spawn_fresh_runtime(
        &runtimes,
        &launcher.launch,
        &host,
        cwd,
        workspace_id.clone(),
        scene_id,
    )?;
    if let Some(window) =
        source_window.filter(|window| window.label().starts_with("native-workspace-"))
    {
        return navigate_workspace_window(app, window, host.origin(), &target, app_param, true);
    }
    let label = format!("native-workspace-{workspace_id}");
    if let Some(existing) = app.get_webview_window(&label) {
        return navigate_workspace_window(app, &existing, host.origin(), &target, app_param, true);
    }
    if let Err(error) = open_native_workspace_window(app, &host, &target) {
        let _ = runtimes.stop(&target);
        return Err(error);
    }
    Ok(())
}

fn open_workspace_at_path(
    app: &AppHandle,
    source_window: Option<&WebviewWindow>,
    cwd: &Path,
    resume_session_id: Option<&str>,
    app_param: Option<&str>,
) -> Result<(), String> {
    let launcher = app
        .try_state::<WorkspaceLauncher>()
        .ok_or_else(|| "Workspace launcher is not ready".to_string())?;
    let host = app
        .try_state::<HostServer>()
        .ok_or_else(|| "Host server is not ready".to_string())?;
    let runtimes = app
        .try_state::<NativePiManagerState>()
        .ok_or_else(|| "Native runtime manager is not ready".to_string())?;

    let workspace_id = launcher
        .metadata
        .lock()
        .map_err(|_| "ZiCode Studio Desktop metadata store is unavailable".to_string())?
        .workspace_id_for_path(cwd)?;

    host.register_workspace(&workspace_id, cwd.to_path_buf())?;

    // When resuming a saved session, navigate directly to that session id so
    // its history loads; otherwise start a fresh temporary session.
    let target = match resume_session_id {
        Some(id) => {
            let scene_id = host
                .scene_id_for_session(&workspace_id, id)?
                .unwrap_or_else(|| "programming".to_string());
            RuntimeTarget::new(
                workspace_id.clone(),
                id.to_string(),
                format!("instance-{}", uuid::Uuid::new_v4().simple()),
            )
            .with_scene(scene_id)
        }
        None => spawn_fresh_runtime(
            &runtimes,
            &launcher.launch,
            &host,
            cwd,
            workspace_id.clone(),
            Some("programming"),
        )?,
    };

    if let Some(window) =
        source_window.filter(|window| window.label().starts_with("native-workspace-"))
    {
        return navigate_workspace_window(
            app,
            window,
            host.origin(),
            &target,
            app_param,
            resume_session_id.is_none(),
        );
    }

    let label = format!("native-workspace-{workspace_id}");
    if let Some(existing) = app.get_webview_window(&label) {
        return navigate_workspace_window(
            app,
            &existing,
            host.origin(),
            &target,
            app_param,
            resume_session_id.is_none(),
        );
    }

    if let Err(error) = open_native_workspace_window(app, &host, &target) {
        if resume_session_id.is_none() {
            let _ = runtimes.stop(&target);
        }
        return Err(error);
    }
    Ok(())
}

fn native_workspace_url(
    host_origin: &str,
    target: &RuntimeTarget,
    app_param: Option<&str>,
) -> Result<tauri::Url, String> {
    let mut url = format!(
        "{}/app/workspaces/{}/sessions/{}",
        host_origin, target.workspace_id, target.session_id
    );
    if let Some(app) = app_param.filter(|value| !value.trim().is_empty()) {
        url.push_str(&format!("?app={}", app.trim()));
    }
    url.parse()
        .map_err(|error| format!("Invalid native Host URL: {error}"))
}

fn set_window_workspace(app: &AppHandle, label: &str, workspace_id: &str) {
    if let Some(state) = app.try_state::<WindowWorkspaceState>() {
        if let Ok(mut windows) = state.0.lock() {
            windows.insert(label.to_string(), workspace_id.to_string());
        }
    }
    if let Some(state) = app.try_state::<FocusedWorkspaceState>() {
        if let Ok(mut focused_workspace) = state.0.lock() {
            *focused_workspace = Some(workspace_id.to_string());
        }
    }
}

fn navigate_workspace_window(
    app: &AppHandle,
    window: &WebviewWindow,
    host_origin: &str,
    target: &RuntimeTarget,
    app_param: Option<&str>,
    stop_target_on_error: bool,
) -> Result<(), String> {
    let url = native_workspace_url(host_origin, target, app_param)?;
    if let Err(error) = window.navigate(url) {
        if stop_target_on_error {
            if let Some(runtimes) = app.try_state::<NativePiManagerState>() {
                let _ = runtimes.stop(target);
            }
        }
        return Err(error.to_string());
    }
    set_window_workspace(app, window.label(), &target.workspace_id);
    let _ = window.set_focus();
    Ok(())
}

fn open_native_workspace_window(
    app: &AppHandle,
    host: &HostServer,
    target: &RuntimeTarget,
) -> Result<(), String> {
    open_native_workspace_window_with_app(app, host, target, None)
}

fn open_native_workspace_window_with_app(
    app: &AppHandle,
    host: &HostServer,
    target: &RuntimeTarget,
    app_param: Option<&str>,
) -> Result<(), String> {
    let label = format!("native-workspace-{}", target.workspace_id);
    let url = native_workspace_url(host.origin(), target, app_param)?;
    // The script is injected only into the native WebView and never served by
    // the HTTP Host. Guard its origin because WebViews can navigate elsewhere.
    let desktop_init = format!(
        "if (window.top === window && window.location.origin === {}) {{ Object.defineProperty(window, '__zicodeDesktopToken', {{ value: {}, configurable: false, writable: false }}); }}",
        serde_json::to_string(host.origin()).map_err(|error| error.to_string())?,
        serde_json::to_string(host.desktop_token()).map_err(|error| error.to_string())?,
    );
    let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))
        .map_err(|error| format!("Failed to load window icon: {error}"))?;
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
        .initialization_script(desktop_init)
        .data_directory(app_paths::webview_root()?)
        .title("ZiCode Studio Desktop")
        .enable_clipboard_access()
        .inner_size(1440.0, 900.0)
        .min_inner_size(800.0, 600.0)
        .icon(icon)
        .map_err(|error| error.to_string())?;

    // Plain native title bar on every platform. The overlay title bar
    // (`TitleBarStyle::Overlay` + `hidden_title(true)`) extended the WebView
    // under the traffic lights so the custom header/sidebar could render
    // there, but it also made three-finger/click-drag window moves
    // unreliable — reverted in favor of the guaranteed-to-work native title
    // bar drag behavior.
    let builder = builder.decorations(true);
    let window = builder.build().map_err(|error| error.to_string())?;
    if let Some(state) = load_window_state() {
        apply_window_state(&window, app, &state);
    }
    set_window_workspace(app, window.label(), &target.workspace_id);
    Ok(())
}

fn open_bootstrap_window(app: &AppHandle, startup_error: &str) -> Result<(), String> {
    let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))
        .map_err(|error| format!("Failed to load window icon: {error}"))?;
    let encoded_error = startup_error
        .replace('&', "%26")
        .replace(' ', "%20")
        .replace('\n', "%0A");
    let url = format!("bootstrap.html?startupError={encoded_error}");
    let builder = WebviewWindowBuilder::new(app, "bootstrap", WebviewUrl::App(url.into()))
        .data_directory(app_paths::webview_root()?)
        .title("ZiCode Studio Desktop")
        .inner_size(900.0, 640.0)
        .min_inner_size(700.0, 480.0)
        .icon(icon)
        .map_err(|error| error.to_string())?;

    // See open_native_workspace_window() — plain native title bar, no overlay.
    let builder = builder.decorations(true);
    builder.build().map_err(|error| error.to_string())?;
    Ok(())
}

const WINDOW_STATE_FILE: &str = "window-state.json";
const MIN_WINDOW_WIDTH: u32 = 800;
const MIN_WINDOW_HEIGHT: u32 = 600;

#[derive(Default, Debug, PartialEq)]
struct WindowState {
    width: u32,
    height: u32,
    x: Option<i32>,
    y: Option<i32>,
    maximized: bool,
}

fn window_state_path() -> Result<PathBuf, String> {
    Ok(app_paths::data_root()?.join(WINDOW_STATE_FILE))
}

fn parse_window_state(content: &str) -> Option<WindowState> {
    let value: serde_json::Value = serde_json::from_str(content).ok()?;
    let width = value.get("width")?.as_u64()? as u32;
    let height = value.get("height")?.as_u64()? as u32;
    if width < MIN_WINDOW_WIDTH || height < MIN_WINDOW_HEIGHT {
        return None;
    }
    Some(WindowState {
        width,
        height,
        x: value
            .get("x")
            .and_then(|entry| entry.as_i64())
            .map(|entry| entry as i32),
        y: value
            .get("y")
            .and_then(|entry| entry.as_i64())
            .map(|entry| entry as i32),
        maximized: value
            .get("maximized")
            .and_then(|entry| entry.as_bool())
            .unwrap_or(false),
    })
}

fn format_window_state(state: &WindowState) -> String {
    serde_json::json!({
        "width": state.width,
        "height": state.height,
        "x": state.x,
        "y": state.y,
        "maximized": state.maximized,
    })
    .to_string()
}

fn load_window_state() -> Option<WindowState> {
    let path = window_state_path().ok()?;
    parse_window_state(&fs::read_to_string(path).ok()?)
}

fn save_window_state(state: &WindowState) {
    let Ok(path) = window_state_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(path, format_window_state(state));
}

fn apply_window_state(window: &WebviewWindow, app: &AppHandle, state: &WindowState) {
    let _ = window.set_size(tauri::PhysicalSize::new(state.width, state.height));
    if let (Some(x), Some(y)) = (state.x, state.y) {
        let work_areas = app
            .available_monitors()
            .unwrap_or_default()
            .iter()
            .map(|monitor| {
                (
                    monitor.position().x,
                    monitor.position().y,
                    monitor.size().width,
                    monitor.size().height,
                )
            })
            .collect::<Vec<_>>();
        let (x, y) = visible_position(x, y, state.width, state.height, &work_areas)
            .unwrap_or_else(|| centered_position(app, state.width, state.height));
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    }
    if state.maximized {
        let _ = window.maximize();
    }
}

const MIN_VISIBLE_WINDOW_EDGE: i32 = 48;

fn visible_position(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    work_areas: &[(i32, i32, u32, u32)],
) -> Option<(i32, i32)> {
    let right = x + width as i32;
    let bottom = y + height as i32;
    let visible = work_areas
        .iter()
        .any(|(area_x, area_y, area_width, area_height)| {
            let area_right = area_x + *area_width as i32;
            let area_bottom = area_y + *area_height as i32;
            x < area_right - MIN_VISIBLE_WINDOW_EDGE
                && right > area_x + MIN_VISIBLE_WINDOW_EDGE
                && y < area_bottom - MIN_VISIBLE_WINDOW_EDGE
                && bottom > area_y + MIN_VISIBLE_WINDOW_EDGE
        });
    visible.then_some((x, y))
}

fn centered_position(app: &AppHandle, width: u32, height: u32) -> (i32, i32) {
    match app.primary_monitor().ok().flatten() {
        Some(monitor) => {
            let position = monitor.position();
            let size = monitor.size();
            (
                position.x + (size.width.saturating_sub(width) / 2) as i32,
                position.y + (size.height.saturating_sub(height) / 2) as i32,
            )
        }
        None => (0, 0),
    }
}

fn canonical_if_exists(dir: PathBuf) -> Option<PathBuf> {
    if dir.join("index.html").exists() {
        Some(fs::canonicalize(&dir).unwrap_or(dir))
    } else {
        None
    }
}

fn resolve_static_dir(
    resource_dir: Option<PathBuf>,
    workspace_public: PathBuf,
    current_dir: Option<PathBuf>,
    debug_assertions: bool,
) -> PathBuf {
    let bundled_public = resource_dir.as_ref().map(|dir| dir.join("public"));
    let current_public = current_dir.unwrap_or_default().join("public");

    if debug_assertions {
        if let Some(dir) = canonical_if_exists(workspace_public) {
            return dir;
        }
        if let Some(dir) = canonical_if_exists(current_public.clone()) {
            return dir;
        }
        return current_public;
    }

    if let Some(dir) = bundled_public.and_then(canonical_if_exists) {
        return dir;
    }

    resource_dir
        .map(|dir| dir.join("public"))
        .unwrap_or_else(|| PathBuf::from("public"))
}

fn static_dir_for_resource(resource_dir: Option<PathBuf>) -> PathBuf {
    resolve_static_dir(
        resource_dir,
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("public"),
        std::env::current_dir().ok(),
        cfg!(debug_assertions),
    )
}

fn find_static_dir(app: &tauri::App) -> PathBuf {
    static_dir_for_resource(app.path().resource_dir().ok())
}

fn agent_inbox_path() -> Result<PathBuf, String> {
    app_paths::agent_inbox_workspace()
}

fn session_dir_name(cwd: &Path) -> String {
    // Windows forbids `: * ? " < > |` and control characters in directory
    // names; drive letters (C:) and UNC prefixes must be sanitized too or the
    // Agent Inbox placeholder session folder cannot be created.
    let sanitized: String = cwd
        .to_string_lossy()
        .chars()
        .map(|ch| {
            if ch.is_ascii_control()
                || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            {
                '-'
            } else {
                ch
            }
        })
        .collect();
    let truncated: String = sanitized.chars().take(120).collect();
    format!("--{truncated}--")
}

fn now_unix_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn now_iso_timestamp() -> String {
    let millis = now_unix_millis();
    let seconds = millis / 1000;
    let sub_millis = millis % 1000;
    format!("{seconds}.{sub_millis:03}Z")
}

fn ensure_agent_inbox_placeholder_session(cwd: &Path) -> Result<(), String> {
    if find_latest_session_for_cwd(cwd).is_some() {
        return Ok(());
    }
    let sessions_root = app_paths::sessions_root()?.join(session_dir_name(cwd));
    fs::create_dir_all(&sessions_root)
        .map_err(|error| format!("Cannot create Agent Inbox session folder: {error}"))?;
    let id = uuid::Uuid::new_v4().to_string();
    let path = sessions_root.join(format!("{}_{}.jsonl", now_unix_millis(), id));
    let timestamp = now_iso_timestamp();
    let cwd_json = serde_json::to_string(&cwd.to_string_lossy().into_owned())
        .map_err(|error| format!("Cannot encode Agent Inbox path: {error}"))?;
    let mut file = File::create(&path)
        .map_err(|error| format!("Cannot create Agent Inbox session file: {error}"))?;
    writeln!(
        file,
        "{{\"type\":\"session\",\"version\":3,\"id\":\"{id}\",\"timestamp\":\"{timestamp}\",\"cwd\":{cwd_json}}}"
    )
    .map_err(|error| format!("Cannot write Agent Inbox session header: {error}"))?;
    writeln!(
        file,
        "{{\"type\":\"session_info\",\"id\":\"{}\",\"parentId\":null,\"timestamp\":\"{timestamp}\",\"name\":\"Agent Inbox\"}}",
        uuid::Uuid::new_v4().simple()
    )
    .map_err(|error| format!("Cannot write Agent Inbox session name: {error}"))?;
    Ok(())
}

fn find_latest_session_for_cwd(cwd: &Path) -> Option<PathBuf> {
    let sessions_root = app_paths::sessions_root().ok()?;
    list_session_files(&sessions_root)
        .into_iter()
        .filter(|path| {
            extract_session_cwd(path)
                .map(|session_cwd| same_dir(Path::new(&session_cwd), cwd))
                .unwrap_or(false)
        })
        .filter_map(|path| {
            let mtime = fs::metadata(&path).ok()?.modified().ok()?;
            Some((mtime, path))
        })
        .max_by_key(|(mtime, _)| *mtime)
        .map(|(_, path)| path)
}

fn same_dir(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn list_session_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let Ok(entries) = fs::read_dir(root) else {
        return files;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Ok(inner_entries) = fs::read_dir(path) else {
            continue;
        };
        for inner in inner_entries.flatten() {
            let session_path = inner.path();
            if session_path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
                files.push(session_path);
            }
        }
    }
    files
}

fn extract_session_cwd(session_path: &Path) -> Option<String> {
    let file = File::open(session_path).ok()?;
    let reader = BufReader::new(file);
    for line in reader.lines().take(200).flatten() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) != Some("session") {
            continue;
        }
        let cwd = value.get("cwd").and_then(Value::as_str)?.trim();
        if cwd.is_empty() {
            return None;
        }
        return Some(cwd.to_string());
    }
    None
}

/// Collect every `.jsonl` session file below a directory (recursive). Works
/// for both the legacy app-data layout (`instances/<key>/sessions/*.jsonl`)
/// and the workspace `.zicode/sessions` layout.
fn collect_jsonl_files(root: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, files);
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
}

fn find_latest_session_boot_target(extra_roots: &[PathBuf]) -> Option<(String, String)> {
    let sessions_root = app_paths::sessions_root().ok()?;
    let mut candidates: Vec<PathBuf> = Vec::new();
    if sessions_root.exists() {
        collect_jsonl_files(&sessions_root, &mut candidates);
    } else {
        log::info!(
            "[picot-native] startup target skipped: sessions dir not found at {}",
            sessions_root.display()
        );
    }
    if let Ok(instances_root) = app_paths::data_root().map(|root| root.join("instances")) {
        if instances_root.is_dir() {
            collect_jsonl_files(&instances_root, &mut candidates);
        }
    }
    for root in extra_roots {
        collect_jsonl_files(root, &mut candidates);
    }

    let latest = candidates
        .into_iter()
        .filter_map(|path| {
            let mtime = fs::metadata(&path).ok()?.modified().ok()?;
            Some((mtime, path))
        })
        .max_by_key(|(mtime, _)| *mtime)?;
    let session_path = latest.1;
    let cwd = extract_session_cwd(&session_path)?;
    Some((cwd, session_path.to_string_lossy().to_string()))
}

fn select_fresh_startup_target(
    home_cwd: String,
    latest_session: Option<(String, String)>,
) -> (String, Option<String>) {
    let cwd = latest_session
        .map(|(session_cwd, _session_path)| session_cwd)
        .unwrap_or(home_cwd);
    (cwd, None)
}

fn setup_native_runtime(app: &mut tauri::App, static_dir: PathBuf) -> Result<(), String> {
    configure_bundled_tool_path(&static_dir)?;
    notes_vault::configure_bundled_bun(&static_dir)?;
    let system_root = app_paths::system_root()?;
    fs::create_dir_all(&system_root)
        .map_err(|error| format!("Cannot create {}: {error}", system_root.display()))?;
    app_paths::migrate_metadata_into_system_root()?;
    app_paths::migrate_legacy_pi_agent()?;
    app_paths::migrate_legacy_scene_agents()?;
    app_paths::migrate_legacy_credentials_index()?;
    let data_root = app_paths::data_root()?;
    let scene_profiles = list_scene_profiles()?;
    let scene_ids: Vec<&str> = scene_profiles
        .iter()
        .map(|profile| profile.id.as_str())
        .collect();
    let mut credential_migration = credential_broker::migrate_registered_scene_credentials(
        &system_root,
        scene_ids.iter().copied(),
    )?;
    // Clean up legacy scene auth documents from the previous data root too.
    let legacy_migration = credential_broker::migrate_registered_scene_credentials(
        &data_root,
        scene_ids.iter().copied(),
    )?;
    credential_migration.migrated += legacy_migration.migrated;
    credential_migration.removed_orphans += legacy_migration.removed_orphans;
    if credential_migration.migrated > 0 || credential_migration.removed_orphans > 0 {
        log::info!(
            "[picot-native] migrated {} legacy scene credential documents and removed {} orphan plaintext documents",
            credential_migration.migrated,
            credential_migration.removed_orphans
        );
    }
    let removed_instances = app_paths::cleanup_empty_instances()?;
    if removed_instances > 0 {
        log::info!("[picot-native] removed {removed_instances} abandoned empty runtime instances");
    }
    let default_cwd = app_paths::global_workspace_root()?;
    fs::create_dir_all(&default_cwd)
        .map_err(|error| format!("Cannot create {}: {error}", default_cwd.display()))?;
    let legacy_metadata_path = app
        .path()
        .app_data_dir()
        .map_err(|error| {
            format!("Cannot resolve ZiCode Studio Desktop app data directory: {error}")
        })?
        .join("picot.sqlite3");
    let metadata_path = app_paths::metadata_path()?;
    app_paths::migrate_legacy_metadata(&legacy_metadata_path, &metadata_path)?;
    let metadata = Arc::new(Mutex::new(MetadataStore::open(&metadata_path)?));
    {
        let mut metadata = metadata
            .lock()
            .map_err(|_| "ZiCode Studio Desktop metadata store is unavailable".to_string())?;
        // Pre-register the global shared workspace (`~/.zicode`) so the
        // switcher always offers it as the default workspace.
        metadata.workspace_id_for_path(&default_cwd)?;
    }
    // Include every registered workspace's `.zicode/sessions` when resuming
    // the most recently used session (legacy app-data roots still apply).
    let tools_only = explorer_entry::tools_only();
    let workspace_session_roots: Vec<PathBuf> = if tools_only {
        Vec::new()
    } else {
        let metadata = metadata
            .lock()
            .map_err(|_| "ZiCode Studio Desktop metadata store is unavailable".to_string())?;
        let mut roots = Vec::new();
        for (_, path) in metadata.list_workspaces()? {
            let root = PathBuf::from(&path);
            if root.is_dir() {
                roots.push(app_paths::workspace_app_dir(&root, &system_root).join("sessions"));
            }
        }
        roots
    };
    let (cwd, session_path) = if tools_only {
        let root = explorer_entry::file().and_then(Path::parent).unwrap_or(&default_cwd);
        (root.to_string_lossy().into_owned(), None)
    } else {
        match explorer_entry::folder() {
            Some(folder) => (folder.to_string_lossy().into_owned(), None),
            None => select_fresh_startup_target(
                default_cwd.to_string_lossy().into_owned(),
                find_latest_session_boot_target(&workspace_session_roots),
            ),
        }
    };
    let workspace_id = metadata
        .lock()
        .map_err(|_| "ZiCode Studio Desktop metadata store is unavailable".to_string())?
        .workspace_id_for_path(Path::new(&cwd))?;
    // Snapshot the resumed workspace's app data on startup (at most once per
    // day per workspace) so accidental data loss has a recovery path.
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    if !tools_only {
        match crate::backup_store::backup_if_due(&workspace_id, Path::new(&cwd), now_secs) {
            Ok(Some(backup)) => log::info!(
                "[picot-native] created workspace backup {} ({} apps, {} bytes)",
                backup.id,
                backup.apps.len(),
                backup.size_bytes
            ),
            Ok(None) => {}
            Err(error) => log::warn!("[picot-native] workspace backup skipped: {error}"),
        }
    }
    let session_id = format!(
        "{}-{}",
        if tools_only { "tools" } else { "temporary" },
        uuid::Uuid::new_v4().simple()
    );
    let target = RuntimeTarget::new(
        workspace_id,
        session_id,
        format!("instance-{}", uuid::Uuid::new_v4().simple()),
    );
    let launch_resolver = PiLaunchResolver::new(static_dir.clone());
    let runtimes = NativePiManager::new(256);
    let remote_auth = Arc::new(Mutex::new(RemoteAuth::new(metadata.clone())));
    let mut seeded_workspace_roots =
        std::collections::HashMap::from([(target.workspace_id.clone(), PathBuf::from(&cwd))]);
    if let Ok(all) = metadata
        .lock()
        .map_err(|_| "ZiCode Studio Desktop metadata store is unavailable".to_string())
        .and_then(|store| store.list_workspaces())
    {
        for (workspace_id, path) in all {
            let candidate = PathBuf::from(&path);
            if candidate.is_dir() {
                seeded_workspace_roots
                    .entry(workspace_id)
                    .or_insert(candidate);
            }
        }
    }
    let host = tauri::async_runtime::block_on(async {
        let host = HostServer::start_with_workspaces(
            static_dir,
            runtimes.clone(),
            remote_auth,
            seeded_workspace_roots,
        )
        .await?;
        if tools_only {
            host.start_tool_session(target.clone())?;
        } else {
            let mut launch =
                launch_resolver.native_launch_spec(&cwd, session_path.as_deref(), &target)?;
            host.configure_plugin_broker(&target, &mut launch)?;
            runtimes.spawn(target.clone(), launch)?;
        }
        Ok::<HostServer, String>(host)
    })?;
    if let Err(error) = open_native_workspace_window_with_app(
        app.handle(),
        &host,
        &target,
        tools_only.then_some("core.tools"),
    ) {
        runtimes.stop_all();
        return Err(error);
    }
    log::info!(
        "[picot-native] started workspace_id={} session_id={} instance_id={} origin={}",
        target.workspace_id,
        target.session_id,
        target.instance_id,
        host.origin()
    );
    app.manage(runtimes);
    app.manage(host);
    app.manage(WorkspaceLauncher {
        metadata,
        launch: launch_resolver,
    });
    app.manage(FocusedWorkspaceState(Mutex::new(Some(
        target.workspace_id.clone(),
    ))));
    let window_workspaces = HashMap::from([(
        format!("native-workspace-{}", target.workspace_id),
        target.workspace_id.clone(),
    )]);
    app.manage(WindowWorkspaceState(Mutex::new(window_workspaces)));
    Ok(())
}

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--zicode-plugin-worker") {
        std::process::exit(plugin_worker::run_stdio());
    }
    if std::env::args().nth(1).as_deref() == Some("--zicode-automation-worker") {
        let arguments: Vec<std::ffi::OsString> = std::env::args_os().skip(2).collect();
        if let Err(error) = automation_worker::run(&arguments) {
            log::error!("[automation-worker] {error}");
            eprintln!("[automation-worker] {error}");
            std::process::exit(1);
        }
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--zicode-automation-worker-stop") {
        if let Err(error) = automation_worker::request_stop_cli() {
            log::error!("[automation-worker] {error}");
            eprintln!("[automation-worker] {error}");
            std::process::exit(1);
        }
        return;
    }
    if let Err(error) = desktop_profile::initialize(std::env::args_os().skip(1)) {
        eprintln!("[desktop-profile] {error}");
        std::process::exit(1);
    }
    let explorer_action = match explorer_entry::configure(std::env::args_os().skip(1)) {
        Ok(action) => action,
        Err(error) => { eprintln!("[desktop-entry] {error}"); std::process::exit(2); }
    };
    if let Some(action) = explorer_action {
        match explorer_menu::execute(action) {
            Ok(status) => { println!("{status}"); return; }
            Err(error) => { eprintln!("[explorer-menu] {error}"); std::process::exit(2); }
        }
    }
    if !desktop_profile::is_isolated() {
        if let Err(error) = fix_path_env::fix() {
            eprintln!("[picot] failed to sync PATH from login shell: {error}");
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            desktop_explorer_menu,
            select_project_resource_file,
            get_project_resource_entry,
            open_folder_as_workspace,
            select_and_install_developer_plugin,
            select_signed_plugin_package,
            install_signed_plugin_package,
            rollback_signed_plugin_package,
            revoke_plugin_publisher,
            open_new_session_in_workspace,
            switch_window_workspace,
            open_session_in_project,
            list_workspaces,
            list_automation_workspaces,
            background_automation_worker_status,
            start_background_automation_worker,
            stop_background_automation_worker,
            background_automation_login_start_enabled,
            set_background_automation_login_start,
            prepare_background_automation_worker_for_update,
            finish_background_automation_worker_update,
            inspect_project_storage,
            delete_workspace,
            list_workspace_trash,
            delete_workspace_trash_entry,
            empty_workspace_trash,
            restore_workspace,
            create_workspace_backup,
            list_workspace_backups,
            delete_workspace_backup,
            restore_workspace_backup,
            ensure_agent_inbox_session,
            list_scene_profiles,
            save_scene_profile,
            delete_scene_profile,
            store_scene_credential,
            delete_scene_credential,
            scene_credential_status,
            send_desktop_notification,
            publish_notes_notebook,
            check_beta_update,
            install_beta_update
        ])
        .plugin(
            tauri_plugin_log::Builder::new()
                .clear_targets()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Folder {
                        path: app_paths::logs_root()
                            .unwrap_or_else(|_| std::env::temp_dir().join("zicode-logs")),
                        file_name: Some("ZiCode Studio Desktop".into()),
                    },
                ))
                .level(log::LevelFilter::Info)
                .level_for("tokio_util", log::LevelFilter::Warn)
                .level_for("hyper", log::LevelFilter::Warn)
                .build(),
        )
        .setup(|app| {
            app.manage(BackgroundWorkerUpdateLease::default());
            if let Err(error) = desktop_tray::install(app) {
                log::warn!("[desktop-tray] unavailable; normal window closing retained: {error}");
            }
            // Best-effort cleanup: drop workspace trash entries older than 30 days.
            if let Ok(trash_root) = crate::app_paths::data_root().map(|root| root.join("trash")) {
                let now_secs = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|duration| duration.as_secs() as i64)
                    .unwrap_or(0);
                if let Err(error) = purge_expired_workspace_trash(&trash_root, now_secs) {
                    log::error!("[projects] startup trash purge failed: {error}");
                }
            }
            let static_dir = find_static_dir(app);
            let worker_public_dir = static_dir.clone();
            if let Err(error) = setup_native_runtime(app, static_dir) {
                log::error!("[picot-native] startup failed: {error}");
                if let Err(window_error) = open_bootstrap_window(&app.handle().clone(), &error) {
                    log::error!(
                        "[picot-native] failed to open bootstrap window after startup error: {window_error}"
                    );
                    app.dialog()
                        .message(format!(
                            "ZiCode Studio Desktop could not start the embedded Pi runtime.\n\n{error}\n\nThe installation may be incomplete or corrupted. Please reinstall the app and try again."
                        ))
                        .title("ZiCode Studio Desktop startup failed")
                        .kind(MessageDialogKind::Error)
                        .show(|_| {});
                }
            } else if !desktop_profile::is_isolated() {
                let login_app = app.handle().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    if let Err(error) = automation_login_start::repair_existing(&login_app) {
                        log::warn!("[automation-worker] login start repair failed: {error}");
                    }
                });
                tauri::async_runtime::spawn_blocking(move || {
                    if let Err(error) = automation_worker::resume_after_update(&worker_public_dir) {
                        log::warn!("[automation-worker] pending update resume failed: {error}");
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label();
            match event {
                tauri::WindowEvent::CloseRequested { api, .. }
                    if label.starts_with("native-workspace-") =>
                {
                    if let Ok(size) = window.inner_size() {
                        let state = WindowState {
                            width: size.width,
                            height: size.height,
                            x: window.outer_position().ok().map(|position| position.x),
                            y: window.outer_position().ok().map(|position| position.y),
                            maximized: window.is_maximized().unwrap_or(false),
                        };
                        save_window_state(&state);
                    }
                    // Preserve the WebView, pending confirmations and running tools.
                    // Never hide without a working tray from which to restore it.
                    if desktop_tray::available(window.app_handle()) {
                        match window.hide() {
                            Ok(()) => api.prevent_close(),
                            Err(error) => log::warn!("[desktop-tray] could not hide window: {error}"),
                        }
                    }
                }
                tauri::WindowEvent::Focused(true) if label.starts_with("native-workspace-") => {
                    let workspace_id = window
                        .try_state::<WindowWorkspaceState>()
                        .and_then(|state| {
                            state
                                .0
                                .lock()
                                .ok()
                                .and_then(|windows| windows.get(label).cloned())
                        })
                        .or_else(|| label.strip_prefix("native-workspace-").map(str::to_string));
                    if let (Some(workspace_id), Some(state)) =
                        (workspace_id, window.try_state::<FocusedWorkspaceState>())
                    {
                        if let Ok(mut focused_workspace) = state.0.lock() {
                            *focused_workspace = Some(workspace_id);
                        }
                    }
                }
                tauri::WindowEvent::Destroyed if label.starts_with("native-workspace-") => {
                    let workspace_id = window
                        .try_state::<WindowWorkspaceState>()
                        .and_then(|state| {
                            state
                                .0
                                .lock()
                                .ok()
                                .and_then(|mut windows| windows.remove(label))
                        })
                        .or_else(|| label.strip_prefix("native-workspace-").map(str::to_string));
                    if let Some(workspace_id) = workspace_id {
                        if let Some(state) = window.try_state::<FocusedWorkspaceState>() {
                            if let Ok(mut focused_workspace) = state.0.lock() {
                                if focused_workspace.as_deref() == Some(workspace_id.as_str()) {
                                    *focused_workspace = None;
                                }
                            }
                        }
                        if let Some(manager) = window.try_state::<NativePiManagerState>() {
                            manager.stop_workspace(&workspace_id);
                        }
                    }
                }
                _ => {}
            }
        })
        .build(application_context::create())
        .expect("error while building tauri application")
        .run(|app_handle: &tauri::AppHandle, event| {
            match event {
                // The builder's initial size is applied when the window is
                // first shown, which can override an early set_size call.
                // Re-apply the remembered size once all windows are ready so
                // restore works deterministically on every launch.
                tauri::RunEvent::Ready => {
                    if let Some(state) = load_window_state() {
                        for window in app_handle.webview_windows().values() {
                            if window.label().starts_with("native-workspace-") {
                                apply_window_state(window, app_handle, &state);
                            }
                        }
                    }
                }
                tauri::RunEvent::Exit => {
                    if let Some(host) = app_handle.try_state::<HostServer>() {
                        host.request_shutdown();
                        if let Err(error) = tauri::async_runtime::block_on(host.wait_for_shutdown()) {
                            log::warn!("[host-shutdown] {error}");
                        }
                    }
                    if let Some(manager) = app_handle.try_state::<NativePiManagerState>() {
                        manager.stop_all();
                    }
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{
        format_window_state, move_workspace_app_data_to_trash, parse_window_state,
        protected_workspace_reason, purge_all_workspace_trash, purge_expired_workspace_trash,
        remove_workspace_trash_entry, resolve_static_dir, restore_app_data_from_trash,
        select_fresh_startup_target, session_dir_name, visible_position, WindowState,
        WORKSPACE_TRASH_RETENTION_SECS,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "zicode-delete-ws-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&root).expect("temp dir");
        root
    }

    #[test]
    fn moves_app_data_to_trash_without_touching_project_files() {
        let root = temp_dir("move");
        let trash_root = root.join("trash");
        let app_data = root.join(".zicode").join("notes");
        fs::create_dir_all(&app_data).expect("app data");
        fs::write(app_data.join("note.md"), "content").expect("note");
        fs::write(root.join("README.md"), "user file").expect("readme");

        let trash = move_workspace_app_data_to_trash(&root, &trash_root).expect("move");
        assert!(trash.join(".zicode").join("notes").join("note.md").exists());
        assert!(!root.join(".zicode").exists());
        assert!(root.join("README.md").exists());
        fs::remove_dir_all(&root).expect("cleanup");
    }

    #[test]
    fn trash_move_is_optional_when_no_app_data_exists() {
        let root = temp_dir("empty");
        let trash_root = root.join("trash");
        let trash = move_workspace_app_data_to_trash(&root, &trash_root).expect("move");
        assert!(trash.is_dir());
        fs::remove_dir_all(&root).expect("cleanup");
    }

    #[test]
    fn protects_global_and_inbox_workspaces() {
        let root = temp_dir("protect");
        assert!(protected_workspace_reason(&root).expect("reason").is_none());
        let global = crate::app_paths::global_workspace_root().expect("global");
        assert!(protected_workspace_reason(&global)
            .expect("reason")
            .is_some());
        fs::remove_dir_all(&root).expect("cleanup");
    }

    #[test]
    fn restores_app_data_from_trash_into_original_root() {
        let base = temp_dir("restore");
        let original = base.join("project");
        fs::create_dir_all(&original).expect("project");
        fs::write(original.join("README.md"), "user file").expect("readme");
        let trash_root = base.join("trash");
        fs::create_dir_all(&trash_root).expect("trash root");
        let trash = trash_root.join("project-123");
        fs::create_dir_all(trash.join(".zicode").join("notes")).expect("app data");
        fs::write(
            trash.join(".zicode").join("notes").join("note.md"),
            "content",
        )
        .expect("note");
        fs::write(
            trash.join("manifest.json"),
            serde_json::json!({ "originalRoot": original.to_string_lossy() }).to_string(),
        )
        .expect("manifest");

        let restored = restore_app_data_from_trash(&trash, &trash_root).expect("restore");
        assert_eq!(restored, original);
        assert!(original
            .join(".zicode")
            .join("notes")
            .join("note.md")
            .exists());
        assert!(original.join("README.md").exists());
        fs::remove_dir_all(&base).expect("cleanup");
    }

    #[test]
    fn restore_refuses_when_original_folder_has_app_data() {
        let base = temp_dir("restore-conflict");
        let original = base.join("project");
        fs::create_dir_all(original.join(".zicode")).expect("existing app data");
        let trash_root = base.join("trash");
        fs::create_dir_all(&trash_root).expect("trash root");
        let trash = trash_root.join("project-123");
        fs::create_dir_all(&trash).expect("trash entry");
        fs::write(
            trash.join("manifest.json"),
            serde_json::json!({ "originalRoot": original.to_string_lossy() }).to_string(),
        )
        .expect("manifest");

        assert!(restore_app_data_from_trash(&trash, &trash_root).is_err());
        fs::remove_dir_all(&base).expect("cleanup");
    }

    #[test]
    fn restore_refuses_entries_outside_the_trash_root() {
        let base = temp_dir("restore-outside");
        let outside = base.join("elsewhere");
        fs::create_dir_all(&outside).expect("outside");
        fs::write(outside.join("manifest.json"), "{}").expect("manifest");
        assert!(restore_app_data_from_trash(&outside, &base.join("trash")).is_err());
        fs::remove_dir_all(&base).expect("cleanup");
    }

    #[test]
    fn purges_only_expired_manifested_trash_entries() {
        let base = temp_dir("purge");
        let trash_root = base.join("trash");
        fs::create_dir_all(&trash_root).expect("trash root");
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or(0);
        let retention = WORKSPACE_TRASH_RETENTION_SECS;

        let write_manifest = |dir: &std::path::Path, deleted_at: i64| {
            fs::create_dir_all(dir).expect("trash entry");
            fs::write(
                dir.join("manifest.json"),
                serde_json::json!({ "deletedAt": deleted_at }).to_string(),
            )
            .expect("manifest");
        };
        let expired = trash_root.join("project-old");
        write_manifest(&expired, now - retention - 86_400);
        let fresh = trash_root.join("project-recent");
        write_manifest(&fresh, now - 86_400);
        let no_manifest = trash_root.join("unrelated-folder");
        fs::create_dir_all(&no_manifest).expect("unrelated folder");

        let purged = purge_expired_workspace_trash(&trash_root, now).expect("purge");
        assert_eq!(purged, 1);
        assert!(!expired.exists());
        assert!(fresh.exists());
        assert!(no_manifest.exists());
        fs::remove_dir_all(&base).expect("cleanup");
    }

    #[test]
    fn purge_handles_missing_trash_root_gracefully() {
        let base = temp_dir("purge-missing");
        assert_eq!(
            purge_expired_workspace_trash(&base.join("no-trash"), 0).expect("purge"),
            0
        );
        fs::remove_dir_all(&base).expect("cleanup");
    }

    #[test]
    fn permanently_deletes_only_direct_manifested_trash_entries() {
        let base = temp_dir("trash-delete");
        let trash_root = base.join("trash");
        fs::create_dir_all(&trash_root).expect("trash root");
        let entry = trash_root.join("project-1");
        fs::create_dir_all(entry.join(".zicode")).expect("app data");
        fs::write(entry.join("manifest.json"), r#"{"deletedAt":1}"#).expect("manifest");
        let plain = trash_root.join("plain-folder");
        fs::create_dir_all(&plain).expect("plain folder");
        let nested = plain.join("nested");
        fs::create_dir_all(&nested).expect("nested");
        fs::write(nested.join("manifest.json"), "{}").expect("nested manifest");

        remove_workspace_trash_entry(&entry, &trash_root).expect("delete");
        assert!(!entry.exists());
        assert!(plain.exists());
        assert!(nested.exists());

        assert!(remove_workspace_trash_entry(&plain, &trash_root).is_err());
        assert!(plain.exists());
        assert!(remove_workspace_trash_entry(&nested, &trash_root).is_err());
        assert!(nested.exists());
        fs::remove_dir_all(&base).expect("cleanup");
    }

    #[test]
    fn emptying_trash_removes_only_manifested_direct_entries() {
        let base = temp_dir("trash-empty");
        let trash_root = base.join("trash");
        fs::create_dir_all(&trash_root).expect("trash root");
        for name in ["project-a", "project-b"] {
            let dir = trash_root.join(name);
            fs::create_dir_all(&dir).expect("entry");
            fs::write(dir.join("manifest.json"), r#"{"deletedAt":1}"#).expect("manifest");
        }
        let plain = trash_root.join("plain-folder");
        fs::create_dir_all(&plain).expect("plain folder");

        assert_eq!(purge_all_workspace_trash(&trash_root).expect("empty"), 2);
        assert!(!trash_root.join("project-a").exists());
        assert!(!trash_root.join("project-b").exists());
        assert!(plain.exists());
        fs::remove_dir_all(&base).expect("cleanup");
    }

    #[test]
    fn session_dir_names_are_valid_windows_folder_names() {
        let drive_path = PathBuf::from(r"C:\Users\ax2\AppData\Local\zicode\workspaces\agent-inbox");
        let name = session_dir_name(&drive_path);
        assert!(!name.contains(':'));
        assert!(!name.contains(['*', '?', '"', '<', '>', '|']));
        assert!(!name.is_empty());

        let long = PathBuf::from(format!("C:\\{}\\workspace", "a".repeat(300)));
        let long_name = session_dir_name(&long);
        assert!(long_name.chars().count() <= 124);
    }

    fn unique_temp_dir(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("picot-{label}-{suffix}"))
    }

    #[test]
    fn debug_build_prefers_workspace_public_over_bundled_copy() {
        let root = unique_temp_dir("static-dir-debug");
        let workspace_public = root.join("workspace").join("public");
        let bundled_public = root.join("bundled").join("public");

        fs::create_dir_all(&workspace_public).unwrap();
        fs::create_dir_all(&bundled_public).unwrap();
        fs::write(workspace_public.join("index.html"), "workspace").unwrap();
        fs::write(bundled_public.join("index.html"), "bundled").unwrap();

        let resolved = resolve_static_dir(
            Some(root.join("bundled")),
            workspace_public.clone(),
            Some(root.join("workspace")),
            true,
        );

        assert_eq!(resolved, fs::canonicalize(&workspace_public).unwrap());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn window_state_round_trips_and_rejects_undersized_sizes() {
        let state = WindowState {
            width: 1600,
            height: 1000,
            x: Some(120),
            y: Some(80),
            maximized: true,
        };
        let parsed = parse_window_state(&format_window_state(&state)).unwrap();
        assert_eq!(parsed.width, 1600);
        assert_eq!(parsed.height, 1000);
        assert_eq!(parsed.x, Some(120));
        assert_eq!(parsed.y, Some(80));
        assert!(parsed.maximized);
        assert_eq!(parse_window_state("{}"), None);
        assert_eq!(parse_window_state("not json"), None);
        assert_eq!(parse_window_state(r#"{"width":400,"height":300}"#), None);
        let minimal = parse_window_state(&format_window_state(&WindowState {
            width: 800,
            height: 600,
            ..WindowState::default()
        }))
        .unwrap();
        assert_eq!((minimal.width, minimal.height), (800, 600));
        assert!(!minimal.maximized);
    }

    #[test]
    fn visible_position_rejects_off_screen_saved_positions() {
        let monitors = vec![(0, 0, 1920u32, 1080u32)];
        assert_eq!(
            visible_position(100, 80, 1600, 1000, &monitors),
            Some((100, 80))
        );
        // Completely off to the left (right edge never reaches the screen).
        assert_eq!(visible_position(-2000, 0, 1600, 1000, &monitors), None);
        // Completely off to the right (left edge beyond the work area).
        assert_eq!(visible_position(2000, 0, 800, 600, &monitors), None);
        // A partial sliver on the right edge stays put (48px visible).
        assert_eq!(
            visible_position(1700, 0, 800, 600, &monitors),
            Some((1700, 0)),
        );
        // Off below the work area.
        assert_eq!(visible_position(100, 2000, 800, 600, &monitors), None);
    }

    #[test]
    fn keeps_the_latest_workspace_but_never_resumes_its_session_on_app_start() {
        let selected = select_fresh_startup_target(
            "/home/user".to_string(),
            Some((
                "/work/project".to_string(),
                "/sessions/old-session.jsonl".to_string(),
            )),
        );
        assert_eq!(selected, ("/work/project".to_string(), None));
    }
}
