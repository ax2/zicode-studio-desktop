#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_paths;
mod artifact_store;
mod credential_broker;
mod e2ee;
mod host_data;
mod host_router;
mod host_server;
mod metadata_store;
mod native_pi_manager;
mod notes_vault;
mod p2p;
mod pi_launch;
mod pi_rpc_bridge;
mod plugin_capabilities;
mod plugin_package;
mod plugin_registry;
mod plugin_worker;
mod process_command;
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
use std::sync::{Arc, Mutex};
use tauri::image::Image;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
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
    notebook_id: String,
) -> Result<notes_vault::AstroPublishReport, String> {
    let vault = host.notes_vault()?;
    tauri::async_runtime::spawn_blocking(move || vault.publish_astro(&notebook_id))
        .await
        .map_err(|error| format!("Astro publisher stopped unexpectedly: {error}"))?
        .map_err(|error| error.message)
}

type NativePiManagerState = NativePiManager;

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
async fn install_beta_update(app: AppHandle) -> Result<(), String> {
    let updater = beta_updater(&app)?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("Beta update check failed: {error}"))?
        .ok_or_else(|| "No beta update is available".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| format!("Beta update installation failed: {error}"))
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
) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked
        .as_path()
        .ok_or_else(|| "Selected folder is not a local path".to_string())?
        .to_path_buf();
    open_workspace_at_path(&app, Some(&window), &path, None)?;
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
) -> Result<(), String> {
    let cwd = PathBuf::from(&project_path);
    if !cwd.is_dir() {
        return Err(format!("Project folder no longer exists: {project_path}"));
    }
    open_fresh_session_at_path(&app, Some(&window), &cwd, scene_id.as_deref())
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
    open_workspace_at_path(&app, Some(&window), &cwd, resume.as_deref())
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
        return navigate_workspace_window(app, window, host.origin(), &target, true);
    }
    let label = format!("native-workspace-{workspace_id}");
    if let Some(existing) = app.get_webview_window(&label) {
        return navigate_workspace_window(app, &existing, host.origin(), &target, true);
    }
    if let Err(error) = open_native_workspace_window(app, host.origin(), &target) {
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
            resume_session_id.is_none(),
        );
    }

    if let Err(error) = open_native_workspace_window(app, host.origin(), &target) {
        if resume_session_id.is_none() {
            let _ = runtimes.stop(&target);
        }
        return Err(error);
    }
    Ok(())
}

fn native_workspace_url(host_origin: &str, target: &RuntimeTarget) -> Result<tauri::Url, String> {
    format!(
        "{}/app/workspaces/{}/sessions/{}",
        host_origin, target.workspace_id, target.session_id
    )
    .parse()
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
    stop_target_on_error: bool,
) -> Result<(), String> {
    let url = native_workspace_url(host_origin, target)?;
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
    host_origin: &str,
    target: &RuntimeTarget,
) -> Result<(), String> {
    let label = format!("native-workspace-{}", target.workspace_id);
    let url = native_workspace_url(host_origin, target)?;
    let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))
        .map_err(|error| format!("Failed to load window icon: {error}"))?;
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
        .data_directory(app_paths::webview_root()?)
        .title("ZiCode Studio Desktop")
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
    if let Some((width, height)) = load_window_state() {
        let _ = window.set_size(tauri::PhysicalSize::new(width, height));
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

fn window_state_path() -> Result<PathBuf, String> {
    Ok(app_paths::data_root()?.join(WINDOW_STATE_FILE))
}

fn parse_window_state(content: &str) -> Option<(u32, u32)> {
    let value: serde_json::Value = serde_json::from_str(content).ok()?;
    let width = value.get("width")?.as_u64()? as u32;
    let height = value.get("height")?.as_u64()? as u32;
    (width >= MIN_WINDOW_WIDTH && height >= MIN_WINDOW_HEIGHT).then_some((width, height))
}

fn format_window_state(width: u32, height: u32) -> String {
    serde_json::json!({ "width": width, "height": height }).to_string()
}

fn load_window_state() -> Option<(u32, u32)> {
    let path = window_state_path().ok()?;
    parse_window_state(&fs::read_to_string(path).ok()?)
}

fn save_window_state(width: u32, height: u32) {
    let Ok(path) = window_state_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(path, format_window_state(width, height));
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

fn find_static_dir(app: &tauri::App) -> PathBuf {
    resolve_static_dir(
        app.path().resource_dir().ok(),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("public"),
        std::env::current_dir().ok(),
        cfg!(debug_assertions),
    )
}

fn agent_inbox_path() -> Result<PathBuf, String> {
    app_paths::agent_inbox_workspace()
}

fn session_dir_name(cwd: &Path) -> String {
    format!("--{}--", cwd.to_string_lossy().replace(['/', '\\'], "-"))
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

fn find_latest_session_boot_target() -> Option<(String, String)> {
    let sessions_root = app_paths::sessions_root().ok()?;
    if !sessions_root.exists() {
        log::info!(
            "[picot-native] startup target skipped: sessions dir not found at {}",
            sessions_root.display()
        );
        return None;
    }

    let latest = list_session_files(&sessions_root)
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
    let data_root = app_paths::data_root()?;
    let scene_profiles = list_scene_profiles()?;
    let credential_migration = credential_broker::migrate_registered_scene_credentials(
        &data_root,
        scene_profiles.iter().map(|profile| profile.id.as_str()),
    )?;
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
    let home_cwd = dirs::home_dir()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let (cwd, session_path) =
        select_fresh_startup_target(home_cwd, find_latest_session_boot_target());
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
    let workspace_id = metadata
        .lock()
        .map_err(|_| "ZiCode Studio Desktop metadata store is unavailable".to_string())?
        .workspace_id_for_path(Path::new(&cwd))?;
    let session_id = format!("temporary-{}", uuid::Uuid::new_v4().simple());
    let target = RuntimeTarget::new(
        workspace_id,
        session_id,
        format!("instance-{}", uuid::Uuid::new_v4().simple()),
    );
    let launch_resolver = PiLaunchResolver::new(static_dir.clone());
    let mut launch = launch_resolver.native_launch_spec(&cwd, session_path.as_deref(), &target)?;
    let runtimes = NativePiManager::new(256);
    let remote_auth = Arc::new(Mutex::new(RemoteAuth::new(metadata.clone())));
    let host = tauri::async_runtime::block_on(async {
        let host = HostServer::start_with_workspaces(
            static_dir,
            runtimes.clone(),
            remote_auth,
            std::collections::HashMap::from([(target.workspace_id.clone(), PathBuf::from(&cwd))]),
        )
        .await?;
        host.configure_plugin_broker(&target, &mut launch)?;
        runtimes.spawn(target.clone(), launch)?;
        Ok::<HostServer, String>(host)
    })?;
    if let Err(error) = open_native_workspace_window(app.handle(), host.origin(), &target) {
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
    if let Err(error) = fix_path_env::fix() {
        eprintln!("[picot] failed to sync PATH from login shell: {error}");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            open_folder_as_workspace,
            select_and_install_developer_plugin,
            select_signed_plugin_package,
            install_signed_plugin_package,
            rollback_signed_plugin_package,
            revoke_plugin_publisher,
            open_new_session_in_workspace,
            open_session_in_project,
            ensure_agent_inbox_session,
            list_scene_profiles,
            save_scene_profile,
            delete_scene_profile,
            store_scene_credential,
            delete_scene_credential,
            scene_credential_status,
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
            let static_dir = find_static_dir(app);
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
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label();
            match event {
                tauri::WindowEvent::CloseRequested { .. }
                    if label.starts_with("native-workspace-") =>
                {
                    if let Ok(size) = window.inner_size() {
                        save_window_state(size.width, size.height);
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle: &tauri::AppHandle, event| {
            match event {
                // The builder's initial size is applied when the window is
                // first shown, which can override an early set_size call.
                // Re-apply the remembered size once all windows are ready so
                // restore works deterministically on every launch.
                tauri::RunEvent::Ready => {
                    if let Some((width, height)) = load_window_state() {
                        for window in app_handle.webview_windows().values() {
                            if window.label().starts_with("native-workspace-") {
                                let _ =
                                    window.set_size(tauri::PhysicalSize::new(width, height));
                            }
                        }
                    }
                }
                tauri::RunEvent::Exit => {
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
        format_window_state, parse_window_state, resolve_static_dir, select_fresh_startup_target,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

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
        let content = format_window_state(1600, 1000);
        assert_eq!(parse_window_state(&content), Some((1600, 1000)));
        assert_eq!(parse_window_state("{}"), None);
        assert_eq!(parse_window_state("not json"), None);
        assert_eq!(parse_window_state(r#"{"width":400,"height":300}"#), None);
        assert_eq!(
            parse_window_state(&format_window_state(800, 600)),
            Some((800, 600)),
        );
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
