pub(crate) mod capture;
pub(crate) mod reader;
pub(crate) mod selection;
mod bookmark_html;
pub(crate) mod bookmark_files;
#[cfg(windows)]
pub(crate) mod download_journal;
#[cfg(windows)]
mod download_commands;
#[cfg(windows)]
mod download_reveal;
pub(crate) mod history_worker;
pub(crate) mod startup;
use serde::Deserialize;
use serde_json::Value;
use tauri::WebviewWindow;
#[cfg(windows)]
use tauri::Manager;
#[cfg(windows)]
mod engine;
#[cfg(windows)]
mod policy;
#[cfg(windows)]
mod runtime;
#[cfg(windows)]
mod native_find;
#[cfg(windows)]
mod page_output;
#[cfg(windows)]
mod lifecycle;
#[cfg(windows)]
mod windows_policy;
#[cfg(windows)]
mod window_controls;

#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
// Keep the same deserialization contract on platforms without an engine.
#[cfg_attr(not(windows), allow(dead_code))]
pub struct Viewport {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
// Keep the same deserialization contract on platforms without an engine.
#[cfg_attr(not(windows), allow(dead_code))]
pub enum Request {
    Status,
    Fullscreen { enabled: Option<bool> },
    Downloads { before: Option<i64>, query: Option<String> },
    DownloadSave { id: String },
    DownloadChoose { id: String },
    DownloadCancel { id: String },
    DownloadPause { id: String },
    DownloadResume { id: String },
    DownloadRemove { id: String },
    DownloadReveal { id: String },
    #[serde(skip)]
    DownloadLive,
    #[serde(skip)]
    DownloadName { id: String },
    Snapshot { tab: String },
    SaveScreenshot { tab: String, #[serde(rename = "expectedUrl")] expected_url: String },
    SavePdf { tab: String, #[serde(rename = "expectedUrl")] expected_url: String },
    MenuLanguage { chinese: bool },
    CancelPopup { request: String },
    Create {
        url: String,
        bounds: Viewport,
        #[serde(rename = "tabId")]
        tab_id: Option<String>,
        #[serde(rename = "popupRequest")]
        popup_request: Option<String>,
        #[serde(default = "crate::browser_store::default_zoom")]
        zoom: f64,
        #[serde(default)]
        muted: bool,
    },
    Present {
        tab: Option<String>,
        bounds: Viewport,
        revision: u64,
        focus: bool,
    },
    Hide {
        revision: u64,
    },
    Navigate {
        tab: String,
        url: String,
    },
    Action {
        tab: String,
        action: String,
    },
    FindStart { tab: String, text: String, #[serde(rename = "caseSensitive")] case_sensitive: bool },
    FocusChrome { tab: String },
    FocusPage { tab: String },
    FindStatus { tab: String },
    FindStep { tab: String, backward: bool },
    FindStop { tab: String },
    PageSettings { tab: String },
    SetZoom { tab: String, zoom: f64 },
    SetMuted { tab: String, muted: bool },
    Close {
        tab: String,
    },
    Url {
        tab: String,
    },
}

#[tauri::command]
pub(crate) async fn browser_control(
    window: WebviewWindow,
    request: Request,
) -> Result<Value, String> {
    crate::require_workspace_window(&window)?;
    #[cfg(windows)]
    {
        let request = match request {
            Request::Downloads { before, query } => return download_commands::list(window, before, query).await,
            Request::DownloadChoose { id } => return download_commands::choose(window, id).await,
            Request::DownloadRemove { id } => return download_commands::remove(window, id).await,
            Request::DownloadReveal { id } => {
                return download_reveal::reveal(window, id).await;
            }
            Request::Snapshot { tab } => return page_output::snapshot(window, tab).await,
            Request::SaveScreenshot { tab, expected_url } => {
                return page_output::save(window, tab, expected_url, page_output::Format::Png).await;
            }
            Request::SavePdf { tab, expected_url } => {
                return page_output::save(window, tab, expected_url, page_output::Format::Pdf).await;
            }
            request => request,
        };
        let root = crate::app_paths::data_root()?.join("browser");
        let profile = if matches!(&request, Request::Create { .. }) {
            let owner = window.label().to_owned();
            Some(
                tauri::async_runtime::spawn_blocking(move || {
                    let state = crate::browser_store::Store::open(&root)?.state(&owner)?;
                    Ok::<_, String>(root.join("profiles").join(state.profile_id).join("engine"))
                })
                .await
                .map_err(|_| "Browser profile worker stopped")??,
            )
        } else {
            None
        };
        let is_find = matches!(&request, Request::FindStart { .. });
        let (tx, rx) = tokio::sync::oneshot::channel();
        let app = window.app_handle().clone();
        app.run_on_main_thread(move || {
            // Origin may have changed while the UI-thread job was queued.
            if let Err(error) = crate::require_workspace_window(&window) { let _ = tx.send(Err(error)); return; }
            match request {
                Request::FindStart { tab, text, case_sensitive } => runtime::start_find(&window, tab, text, case_sensitive, tx),
                request => { let _ = tx.send(runtime::execute(&window, profile, request)); }
            }
        })
        .map_err(|e| e.to_string())?;
        if is_find {
            tokio::time::timeout(std::time::Duration::from_secs(10), rx).await
                .map_err(|_| "Page search timed out")?.map_err(|_| "Browser UI thread stopped")?
        } else { rx.await.map_err(|_| "Browser UI thread stopped")? }
    }
    #[cfg(not(windows))]
    {
        let _ = request;
        Err("Integrated browser is currently available on Windows".into())
    }
}
#[cfg(windows)]
pub(crate) fn shutdown_downloads() {
    runtime::shutdown_downloads();
    if let Err(error) = download_journal::flush() { log::warn!("[browser-downloads] {error}"); }
}
pub(crate) fn forget_window(label: &str) {
    #[cfg(windows)]
    runtime::forget(label);
    #[cfg(not(windows))]
    let _ = label;
}

pub(crate) fn manifest() -> Value {
    serde_json::json!({"schemaVersion":1,"id":"com.zicode.browser","name":"Browser","description":"Browse the web inside Studio","version":"0.1.0","publisher":"zicode","engines":{"zicode":">=0.4.2 <1.0.0","pluginApi":"^1.0.0"},"activationEvents":["onView:browser.main"],"contributes":{"activities":[{"id":"browser","title":"Browser","order":-10}],"views":[{"id":"browser.main","activity":"browser","location":"main","title":"Browser"}]},"permissions":{"required":[],"optional":[]}})
}
