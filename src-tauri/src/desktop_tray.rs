//! Desktop lifecycle only; hiding never stops a workspace or starts a tool.
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

struct DesktopTray {
    _icon: TrayIcon,
}

pub fn available(app: &AppHandle) -> bool {
    app.try_state::<DesktopTray>().is_some()
}

fn show_workspaces(app: &AppHandle) {
    let mut windows: Vec<_> = app.webview_windows().into_iter()
        .filter(|(label, _)| label.starts_with("native-workspace-") || label == "bootstrap")
        .collect();
    windows.sort_by(|a, b| a.0.cmp(&b.0));
    // Restore every project window; do not navigate or replace its current state.
    for (_, window) in &windows {
        if let Err(error) = window.show().and_then(|_| window.unminimize()) {
            log::warn!("[desktop-tray] restore failed: {error}");
        }
    }
    if let Some((_, window)) = windows.first() {
        let _ = window.set_focus();
    }
}

pub fn install(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "studio.show", "显示 ZiCode Studio", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "studio.hide", "隐藏所有窗口（继续运行）", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let exit = MenuItem::with_id(app, "studio.exit", "退出 ZiCode Studio", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &separator, &exit])?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    let tray = TrayIconBuilder::with_id("zicode-studio-desktop")
        .icon(icon)
        .tooltip("ZiCode Studio Desktop · 关闭窗口后继续运行")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "studio.show" => show_workspaces(app),
            "studio.hide" => {
                for (label, window) in app.webview_windows() {
                    if label.starts_with("native-workspace-") {
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
            if matches!(event, TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }) {
                show_workspaces(tray.app_handle());
            }
        })
        .build(app)?;
    app.manage(DesktopTray { _icon: tray });
    Ok(())
}
