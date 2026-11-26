//! Persistence and multi-monitor restoration for the Studio workspace window.
use crate::app_paths;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, WebviewWindow};

const WINDOW_STATE_FILE: &str = "window-state.json";
pub(super) const MIN_WINDOW_WIDTH: u32 = 360;
pub(super) const MIN_WINDOW_HEIGHT: u32 = 600;

#[derive(Default, Debug, PartialEq)]
pub(super) struct WindowState {
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) x: Option<i32>,
    pub(super) y: Option<i32>,
    pub(super) maximized: bool,
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

pub(super) fn load_window_state() -> Option<WindowState> {
    let path = window_state_path().ok()?;
    parse_window_state(&fs::read_to_string(path).ok()?)
}

pub(super) fn save_window_state(state: &WindowState) {
    let Ok(path) = window_state_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(path, format_window_state(state));
}

pub(super) fn apply_window_state(window: &WebviewWindow, app: &AppHandle, state: &WindowState) {
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
    work_areas
        .iter()
        .filter(|(area_x, area_y, area_width, area_height)| {
            let area_right = area_x + *area_width as i32;
            let area_bottom = area_y + *area_height as i32;
            x < area_right - MIN_VISIBLE_WINDOW_EDGE
                && right > area_x + MIN_VISIBLE_WINDOW_EDGE
                && y < area_bottom - MIN_VISIBLE_WINDOW_EDGE
                && bottom > area_y + MIN_VISIBLE_WINDOW_EDGE
        })
        .max_by_key(|(ax, ay, aw, ah)| {
            i64::from(right.min(ax + *aw as i32) - x.max(*ax))
                * i64::from(bottom.min(ay + *ah as i32) - y.max(*ay))
        })
        .map(|(ax, ay, aw, ah)| {
            // Frameless controls live in the top right of the client area.
            // Old native-frame offsets and partially offscreen restores must
            // not leave the close button above or beyond the chosen monitor.
            let max_x = ax + aw.saturating_sub(width) as i32;
            let max_y = ay + ah.saturating_sub(height) as i32;
            (x.clamp(*ax, max_x), y.clamp(*ay, max_y))
        })
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

#[cfg(test)]
mod tests {
    use super::*;

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
        // Compact layouts must survive restart at the physical size we saved.
        let narrow = WindowState {
            width: 738,
            height: 1400,
            x: Some(-12),
            y: Some(-12),
            maximized: false,
        };
        assert_eq!(
            parse_window_state(&format_window_state(&narrow)),
            Some(narrow)
        );
        assert!(parse_window_state(r#"{"width":360,"height":600}"#).is_some());
        assert_eq!(parse_window_state(r#"{"width":359,"height":600}"#), None);
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
        // Keep the top-right controls accessible on a partially visible restore.
        assert_eq!(
            visible_position(1700, 0, 800, 600, &monitors),
            Some((1120, 0)),
        );
        assert_eq!(
            visible_position(-12, -12, 738, 800, &monitors),
            Some((0, 0))
        );
        let dual = vec![(-1920, 0, 1920, 1080), (0, 0, 1920, 1080)];
        assert_eq!(
            visible_position(-1700, 80, 800, 600, &dual),
            Some((-1700, 80))
        );
        // Off below the work area.
        assert_eq!(visible_position(100, 2000, 800, 600, &monitors), None);
    }
}
