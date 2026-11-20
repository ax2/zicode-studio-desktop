//! Window chrome is trusted Studio UI; webpage children cannot select a window.
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::WebviewWindow;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action { State, Minimize, ToggleMaximize, Close, Drag }

#[tauri::command]
pub async fn desktop_window_control(window: WebviewWindow, action: Action) -> Result<Value, String> {
    crate::require_workspace_window(&window)?;
    match action {
        Action::State => {},
        Action::Minimize => window.minimize().map_err(|error| error.to_string())?,
        Action::ToggleMaximize => {
            if window.is_fullscreen().map_err(|error| error.to_string())? {
                window.set_fullscreen(false).map_err(|error| error.to_string())?;
            } else if window.is_maximized().map_err(|error| error.to_string())? {
                window.unmaximize().map_err(|error| error.to_string())?;
            } else {
                window.unminimize().map_err(|error| error.to_string())?;
                window.maximize().map_err(|error| error.to_string())?;
            }
        },
        // Uses the existing CloseRequested handler (save state and close to tray).
        Action::Close => window.close().map_err(|error| error.to_string())?,
        Action::Drag => window.start_dragging().map_err(|error| error.to_string())?,
    }
    Ok(json!({
        "maximized": window.is_maximized().map_err(|error| error.to_string())?,
        "fullscreen": window.is_fullscreen().map_err(|error| error.to_string())?,
        "minimized": window.is_minimized().map_err(|error| error.to_string())?,
    }))
}
