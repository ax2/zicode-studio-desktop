use serde::Deserialize;
use serde_json::Value;
use tauri::WebviewWindow;

#[derive(Deserialize)]
#[cfg_attr(not(windows), allow(dead_code))]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Request {
    Settings,
    Preview {
        provider: String,
        model: String,
    },
    Enable {
        provider: String,
        model: String,
        identity: String,
        preferred: String,
        alternate: String,
    },
    Disable,
    Snapshot,
    Retry {
        revision: u64,
        source: Option<String>,
        target: String,
    },
    Workbench {
        revision: u64,
    },
    Close,
    TakeHandoff,
}

#[tauri::command]
pub(crate) async fn clipboard_translation(
    window: WebviewWindow,
    request: Request,
) -> Result<Value, String> {
    #[cfg(windows)]
    return platform::command(window, request);
    #[cfg(not(windows))]
    {
        let _ = (window, request);
        Err("Global clipboard translation is available on Windows".into())
    }
}

#[cfg(windows)]
pub(crate) use platform::{destroyed, install, shutdown, POPUP_LABEL};

#[cfg(windows)]
mod platform;
