//! Trusted Studio chrome only; callers cannot choose a data path or another window.
use crate::browser_store::{SavedTab, Session, StartupMode, State, Store};
use tauri::WebviewWindow;
fn context(window: &WebviewWindow) -> Result<(std::path::PathBuf, String), String> {
    crate::require_workspace_window(window)?;
    Ok((
        crate::app_paths::data_root()?.join("browser"),
        window.label().to_owned(),
    ))
}
#[tauri::command]
pub(crate) async fn browser_get_state(window: WebviewWindow) -> Result<State, String> {
    let (root, owner) = context(&window)?;
    tauri::async_runtime::spawn_blocking(move || Store::open(&root)?.state(&owner))
        .await
        .map_err(|_| "Browser metadata worker stopped")?
}
#[tauri::command]
pub(crate) async fn browser_set_startup_mode(
    window: WebviewWindow,
    mode: StartupMode,
) -> Result<(), String> {
    let (root, _) = context(&window)?;
    tauri::async_runtime::spawn_blocking(move || Store::open(&root)?.set_startup(mode))
        .await
        .map_err(|_| "Browser metadata worker stopped")?
}
#[tauri::command]
pub(crate) async fn browser_save_session(
    window: WebviewWindow,
    expected_revision: i64,
    tabs: Vec<SavedTab>,
    active_tab: Option<String>,
) -> Result<Session, String> {
    let (root, owner) = context(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        Store::open(&root)?.save(&owner, expected_revision, tabs, active_tab)
    })
    .await
    .map_err(|_| "Browser metadata worker stopped")?
}

#[tauri::command]
pub(crate) async fn browser_bookmarks(
    window: WebviewWindow,
    request: crate::browser_store::bookmarks::Request,
) -> Result<crate::browser_store::bookmarks::Library, String> {
    let (root, owner) = context(&window)?;
    tauri::async_runtime::spawn_blocking(move || Store::open(&root)?.bookmarks(&owner, request))
        .await
        .map_err(|_| "Bookmark worker stopped")?
}

#[tauri::command]
pub(crate) async fn browser_history(window: WebviewWindow, request: crate::browser_store::history::Request) -> Result<crate::browser_store::history::Page,String> {
    let (_,owner) = context(&window)?;
    crate::browser::history_worker::request(owner,request).await
}
