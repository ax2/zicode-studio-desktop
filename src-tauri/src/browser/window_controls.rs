//! Trusted chrome window controls; no webpage or caller-selected window handle.
use serde_json::{json, Value};
use tauri::WebviewWindow;

pub(super) fn fullscreen(window: &WebviewWindow, enabled: Option<bool>) -> Result<Value, String> {
    crate::require_workspace_window(window)?;
    let current = window.is_fullscreen().map_err(|error| error.to_string())?;
    if let Some(target) = enabled.filter(|target| *target != current) {
        if target {
            // Keep a normal restore size even if the user closes while fullscreen.
            let size = window.inner_size().map_err(|error| error.to_string())?;
            let position = window.outer_position().ok();
            crate::save_window_state(&crate::WindowState {
                width: size.width, height: size.height,
                x: position.map(|point| point.x), y: position.map(|point| point.y),
                maximized: window.is_maximized().map_err(|error| error.to_string())?,
            });
        }
        window.set_fullscreen(target).map_err(|error| error.to_string())?;
    }
    Ok(json!({ "fullscreen": window.is_fullscreen().map_err(|error| error.to_string())? }))
}
