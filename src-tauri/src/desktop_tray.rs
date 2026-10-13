//! Desktop lifecycle only; hiding never stops a workspace or starts a tool.
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

struct DesktopTray {
    icon: TrayIcon,
    tools: MenuItem<tauri::Wry>,
    show: MenuItem<tauri::Wry>,
    hide: MenuItem<tauri::Wry>,
    exit: MenuItem<tauri::Wry>,
    focused_window: Mutex<Option<String>>,
}

#[tauri::command]
pub fn set_desktop_tray_locale(window: tauri::WebviewWindow, locale: String) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    let labels = match locale.as_str() {
        "zh-CN" => ["打开工具中心", "显示 ZiCode Studio", "隐藏所有窗口（继续运行）", "退出 ZiCode Studio", "ZiCode Studio Desktop · 关闭窗口后继续运行"],
        "en" => ["Open tool center", "Show ZiCode Studio", "Hide all windows (keep running)", "Quit ZiCode Studio", "ZiCode Studio Desktop · Runs after windows close"],
        _ => return Err("Unsupported tray locale".into()),
    };
    let tray = window.try_state::<DesktopTray>().ok_or("Desktop tray is unavailable")?;
    tray.tools.set_text(labels[0]).map_err(|error| error.to_string())?;
    tray.show.set_text(labels[1]).map_err(|error| error.to_string())?;
    tray.hide.set_text(labels[2]).map_err(|error| error.to_string())?;
    tray.exit.set_text(labels[3]).map_err(|error| error.to_string())?;
    tray.icon.set_tooltip(Some(labels[4])).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn available(app: &AppHandle) -> bool {
    app.try_state::<DesktopTray>().is_some()
}

pub fn remember_focus(app: &AppHandle, label: &str) {
    if let Some(tray) = app.try_state::<DesktopTray>() {
        if let Ok(mut focused) = tray.focused_window.lock() {
            *focused = Some(label.to_string());
        }
    }
}

pub fn forget_window(app: &AppHandle, label: &str) {
    if let Some(tray) = app.try_state::<DesktopTray>() {
        if let Ok(mut focused) = tray.focused_window.lock() {
            if focused.as_deref() == Some(label) {
                *focused = None;
            }
        }
    }
}

fn focus_index(labels: &[String], preferred: Option<&str>) -> Option<usize> {
    preferred
        .and_then(|label| labels.iter().position(|candidate| candidate == label))
        .or_else(|| {
            labels
                .iter()
                .position(|label| label.starts_with("native-workspace-"))
        })
        .or_else(|| (!labels.is_empty()).then_some(0))
}

fn managed_window(label: &str) -> bool {
    label.starts_with("native-workspace-") || label == "bootstrap"
}

fn show_workspaces(app: &AppHandle) {
    let preferred = app.try_state::<DesktopTray>().and_then(|tray| {
        tray.focused_window
            .lock()
            .ok()
            .and_then(|focused| focused.clone())
    });
    let mut windows: Vec<_> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| managed_window(label))
        .collect();
    windows.sort_by(|a, b| a.0.cmp(&b.0));
    // Restore every project window; do not navigate or replace its current state.
    for (_, window) in &windows {
        if let Err(error) = window.show().and_then(|_| window.unminimize()) {
            log::warn!("[desktop-tray] restore failed: {error}");
        }
    }
    let labels: Vec<_> = windows.iter().map(|(label, _)| label.clone()).collect();
    if let Some(index) = focus_index(&labels, preferred.as_deref()) {
        if let Err(error) = windows[index].1.set_focus() {
            log::warn!("[desktop-tray] focus failed: {error}");
        }
    }
}

pub fn install(app: &tauri::App) -> tauri::Result<()> {
    let tools = MenuItem::with_id(app, "studio.tools", "打开工具中心", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "studio.show", "显示 ZiCode Studio", true, None::<&str>)?;
    let hide = MenuItem::with_id(
        app,
        "studio.hide",
        "隐藏所有窗口（继续运行）",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let exit = MenuItem::with_id(app, "studio.exit", "退出 ZiCode Studio", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&tools, &show, &hide, &separator, &exit])?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    let tray = TrayIconBuilder::with_id("zicode-studio-desktop")
        .icon(icon)
        .tooltip("ZiCode Studio Desktop · 关闭窗口后继续运行")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "studio.tools" => {
                if let Err(error) = crate::desktop_tools::open(app) {
                    log::warn!("[desktop-tray] tool center unavailable: {error}");
                    show_workspaces(app);
                }
            }
            "studio.show" => show_workspaces(app),
            "studio.hide" => {
                for (label, window) in app.webview_windows() {
                    if managed_window(&label) {
                        if let Err(error) = window.hide() {
                            log::warn!("[desktop-tray] hide failed: {error}");
                        }
                    }
                }
            }
            // Use the existing Host shutdown barrier and managed Pi cleanup.
            "studio.exit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_workspaces(tray.app_handle());
            }
        })
        .build(app)?;
    app.manage(DesktopTray {
        icon: tray,
        tools,
        show,
        hide,
        exit,
        focused_window: Mutex::new(None),
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{focus_index, managed_window};

    #[test]
    fn tray_restores_recent_window_and_keeps_bootstrap_as_fallback() {
        let labels = vec![
            "bootstrap".to_string(),
            "native-workspace-alpha".to_string(),
            "native-workspace-tools-center".to_string(),
        ];
        assert_eq!(
            focus_index(&labels, Some("native-workspace-tools-center")),
            Some(2)
        );
        assert_eq!(focus_index(&labels, Some("destroyed")), Some(1));
        assert_eq!(focus_index(&labels[..1], None), Some(0));
        assert_eq!(focus_index(&[], None), None);
        assert!(managed_window("bootstrap"));
        assert!(managed_window("native-workspace-tools-center"));
        assert!(!managed_window("plugin-popup"));
    }
}
