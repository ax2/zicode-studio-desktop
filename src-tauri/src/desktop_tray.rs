//! Desktop lifecycle only; hiding never stops a workspace or starts a tool.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

struct DesktopTray {
    icon: TrayIcon,
    tools: MenuItem<tauri::Wry>,
    project_tools: MenuItem<tauri::Wry>,
    favorite_tools: MenuItem<tauri::Wry>,
    recent_tools: MenuItem<tauri::Wry>,
    show: MenuItem<tauri::Wry>,
    hide: MenuItem<tauri::Wry>,
    exit: MenuItem<tauri::Wry>,
    focused_window: Mutex<Option<String>>,
    locale: Mutex<String>,
    exit_prompt_open: AtomicBool,
}

fn exit_prompt_labels(locale: &str) -> (&'static str, &'static str, &'static str) {
    if locale == "en" {
        (
            "Quit Studio? Running tools will stop and unsaved results may be lost.",
            "Quit Studio",
            "Keep running",
        )
    } else {
        (
            "退出 Studio？正在运行的工具将停止，尚未保存的结果可能丢失。",
            "退出 Studio",
            "继续运行",
        )
    }
}

fn confirm_exit(app: &AppHandle) {
    let Some(tray) = app.try_state::<DesktopTray>() else {
        return;
    };
    if tray.exit_prompt_open.swap(true, Ordering::AcqRel) {
        return;
    }
    let locale = tray
        .locale
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    let (message, quit, keep) = exit_prompt_labels(&locale);
    let callback_app = app.clone();
    app.dialog()
        .message(message)
        .title("ZiCode Studio Desktop")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            quit.into(),
            keep.into(),
        ))
        .show(move |confirmed| {
            if confirmed {
                callback_app.exit(0);
            } else if let Some(tray) = callback_app.try_state::<DesktopTray>() {
                tray.exit_prompt_open.store(false, Ordering::Release);
            }
        });
}

#[tauri::command]
pub fn set_desktop_tray_locale(window: tauri::WebviewWindow, locale: String) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    let labels = match locale.as_str() {
        "zh-CN" => [
            "打开工具中心",
            "打开当前项目工具",
            "收藏工具",
            "最近使用的工具",
            "显示 ZiCode Studio",
            "隐藏所有窗口（继续运行）",
            "退出 ZiCode Studio",
            "ZiCode Studio Desktop · 关闭窗口后继续运行",
        ],
        "en" => [
            "Open tool center",
            "Open current project tools",
            "Favorite tools",
            "Recently used tools",
            "Show ZiCode Studio",
            "Hide all windows (keep running)",
            "Quit ZiCode Studio",
            "ZiCode Studio Desktop · Runs after windows close",
        ],
        _ => return Err("Unsupported tray locale".into()),
    };
    let tray = window
        .try_state::<DesktopTray>()
        .ok_or("Desktop tray is unavailable")?;
    tray.tools
        .set_text(labels[0])
        .map_err(|error| error.to_string())?;
    tray.project_tools
        .set_text(labels[1])
        .map_err(|error| error.to_string())?;
    tray.favorite_tools
        .set_text(labels[2])
        .map_err(|error| error.to_string())?;
    tray.recent_tools
        .set_text(labels[3])
        .map_err(|error| error.to_string())?;
    tray.show
        .set_text(labels[4])
        .map_err(|error| error.to_string())?;
    tray.hide
        .set_text(labels[5])
        .map_err(|error| error.to_string())?;
    tray.exit
        .set_text(labels[6])
        .map_err(|error| error.to_string())?;
    tray.icon
        .set_tooltip(Some(labels[7]))
        .map_err(|error| error.to_string())?;
    *tray
        .locale
        .lock()
        .map_err(|_| "Desktop tray locale is unavailable")? = locale;
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
        let _ = tray
            .project_tools
            .set_enabled(crate::desktop_tools::project_context_window(label));
    }
}

pub fn forget_window(app: &AppHandle, label: &str) {
    if let Some(tray) = app.try_state::<DesktopTray>() {
        if let Ok(mut focused) = tray.focused_window.lock() {
            if focused.as_deref() == Some(label) {
                *focused = None;
                let _ = tray.project_tools.set_enabled(false);
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

pub(crate) fn show_workspaces(app: &AppHandle) {
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
    let project_tools = MenuItem::with_id(
        app,
        "studio.project.tools",
        "打开当前项目工具",
        false,
        None::<&str>,
    )?;
    let favorite_tools = MenuItem::with_id(
        app,
        "studio.tools.favorites",
        "收藏工具",
        true,
        None::<&str>,
    )?;
    let recent_tools = MenuItem::with_id(
        app,
        "studio.tools.recent",
        "最近使用的工具",
        true,
        None::<&str>,
    )?;
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
    let menu = Menu::with_items(
        app,
        &[
            &project_tools,
            &tools,
            &favorite_tools,
            &recent_tools,
            &show,
            &hide,
            &separator,
            &exit,
        ],
    )?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    let tray = TrayIconBuilder::with_id("zicode-studio-desktop")
        .icon(icon)
        .tooltip("ZiCode Studio Desktop · 关闭窗口后继续运行")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "studio.project.tools" => {
                let focused = app.try_state::<DesktopTray>().and_then(|tray| {
                    tray.focused_window
                        .lock()
                        .ok()
                        .and_then(|value| value.clone())
                });
                let result = focused
                    .and_then(|label| app.get_webview_window(&label))
                    .ok_or("No project window is focused".to_string())
                    .and_then(|window| crate::desktop_tools::open_for_project_window(app, &window));
                if let Err(error) = result {
                    log::warn!("[desktop-tray] current project tools unavailable: {error}");
                    app.dialog()
                        .message("当前项目工具暂时无法打开。请重新打开项目后重试。")
                        .title("ZiCode Studio Desktop")
                        .kind(MessageDialogKind::Error)
                        .show(|_| {});
                }
            }
            "studio.tools" => {
                if let Err(error) = crate::desktop_tools::open(app) {
                    log::warn!("[desktop-tray] tool center unavailable: {error}");
                    show_workspaces(app);
                }
            }
            "studio.tools.favorites" | "studio.tools.recent" => {
                let view = if event.id.as_ref() == "studio.tools.favorites" {
                    crate::desktop_tools::ToolDirectoryView::Favorites
                } else {
                    crate::desktop_tools::ToolDirectoryView::Recent
                };
                if let Err(error) = crate::desktop_tools::open_view(app, view) {
                    log::warn!("[desktop-tray] filtered tool center unavailable: {error}");
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
            // Confirmation covers all tool types; keep the existing Host shutdown
            // barrier and managed Pi cleanup after an explicit exit decision.
            "studio.exit" => confirm_exit(app),
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
        project_tools,
        favorite_tools,
        recent_tools,
        show,
        hide,
        exit,
        focused_window: Mutex::new(None),
        locale: Mutex::new("zh-CN".into()),
        exit_prompt_open: AtomicBool::new(false),
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{exit_prompt_labels, focus_index, managed_window};

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
        assert!(crate::desktop_tools::project_context_window(
            "native-workspace-alpha"
        ));
        assert!(crate::desktop_tools::project_context_window(
            "native-workspace-tools-center-alpha"
        ));
        assert!(!crate::desktop_tools::project_context_window(
            "native-workspace-tools-center"
        ));
        assert!(!crate::desktop_tools::project_context_window("bootstrap"));
    }

    #[test]
    fn exit_prompt_explains_running_work_in_both_languages() {
        let chinese = exit_prompt_labels("zh-CN");
        let english = exit_prompt_labels("en");
        assert!(chinese.0.contains("尚未保存"));
        assert!(english.0.contains("unsaved results"));
        assert_ne!(chinese.1, chinese.2);
        assert_ne!(english.1, english.2);
    }
}
