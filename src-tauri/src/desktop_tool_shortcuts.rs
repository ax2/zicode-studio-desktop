//! Bounded navigation shortcuts projected from existing Host favorites.
//! No inputs, credentials or results are stored here, and clicks never execute.
use serde::Deserialize;
use std::sync::Mutex;
use tauri::{
    menu::{MenuItem, Submenu},
    AppHandle, Manager, WebviewWindow,
};

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Shortcut {
    id: String,
    title: String,
}

struct QuickTools {
    menu: Submenu<tauri::Wry>,
    manage: MenuItem<tauri::Wry>,
    source: Mutex<Option<String>>,
    items: Mutex<Vec<Shortcut>>,
}

fn validate(items: &[Shortcut]) -> Result<(), String> {
    let mut seen = std::collections::HashSet::new();
    if items.len() > 8 {
        return Err("At most eight quick tools are supported".into());
    }
    for item in items {
        if item.id.is_empty()
            || item.id.len() > 256
            || item.id.trim() != item.id
            || item.id.chars().any(char::is_control)
            || !seen.insert(&item.id)
            || item.title.trim().is_empty()
            || item.title.len() > 256
            || item.title.chars().any(char::is_control)
        {
            return Err("Invalid quick tool".into());
        }
    }
    Ok(())
}

pub(crate) fn install(app: &tauri::App) -> tauri::Result<Submenu<tauri::Wry>> {
    let menu = Submenu::new(app, "快捷工具", true)?;
    let manage = MenuItem::with_id(
        app,
        "studio.quick.manage",
        "添加 / 管理快捷工具…",
        true,
        None::<&str>,
    )?;
    menu.append(&manage)?;
    app.manage(QuickTools {
        menu: menu.clone(),
        manage,
        source: Mutex::new(None),
        items: Mutex::new(Vec::new()),
    });
    Ok(menu)
}

#[tauri::command]
pub(crate) fn set_desktop_tool_shortcuts(
    window: WebviewWindow,
    shortcuts: Vec<Shortcut>,
) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    validate(&shortcuts)?;
    let shortcuts: Vec<_> = shortcuts.into_iter().filter(|item| crate::workspace_mode::application_visible(&item.id)).collect();
    let Some(state) = window.try_state::<QuickTools>() else {
        return Ok(());
    };
    let mut source = state
        .source
        .lock()
        .map_err(|_| "Quick tools are unavailable")?;
    // Background pages must not replace the focused workspace's menu.
    if source.is_some()
        && source.as_deref() != Some(window.label())
        && !window.is_focused().unwrap_or(false)
    {
        return Ok(());
    }
    let mut items = state
        .items
        .lock()
        .map_err(|_| "Quick tools are unavailable")?;
    if *items != shortcuts {
        let app = window.app_handle();
        let entries = shortcuts
            .iter()
            .enumerate()
            .map(|(index, item)| {
                MenuItem::with_id(
                    app,
                    format!("studio.quick.tool.{index}"),
                    item.title.replace('&', "&&"),
                    true,
                    None::<&str>,
                )
            })
            .collect::<tauri::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;
        for _ in 0..state.menu.items().map_err(|error| error.to_string())?.len() {
            state.menu.remove_at(0).map_err(|error| error.to_string())?;
        }
        for entry in entries {
            state
                .menu
                .append(&entry)
                .map_err(|error| error.to_string())?;
        }
        state
            .menu
            .append(&state.manage)
            .map_err(|error| error.to_string())?;
        *items = shortcuts;
    }
    *source = Some(window.label().to_string());
    Ok(())
}

pub(crate) fn set_locale(app: &AppHandle, locale: &str) -> Result<(), String> {
    if let Some(state) = app.try_state::<QuickTools>() {
        state
            .manage
            .set_text(if locale == "en" {
                "Choose quick tools…"
            } else {
                "添加 / 管理快捷工具…"
            })
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn handle_menu(app: &AppHandle, id: &str) -> bool {
    if !id.starts_with("studio.quick.") {
        return false;
    }
    let Some(state) = app.try_state::<QuickTools>() else {
        return true;
    };
    let source = state.source.lock().ok().and_then(|source| source.clone());
    let Some(window) = source.and_then(|label| app.get_webview_window(&label)) else {
        let _ = crate::desktop_tools::open(app);
        return true;
    };
    let event = if id == "studio.quick.manage" {
        "window.dispatchEvent(new Event('zicode:manage-quick-tools'))".to_string()
    } else {
        let item = id
            .strip_prefix("studio.quick.tool.")
            .and_then(|value| value.parse::<usize>().ok())
            .and_then(|index| state.items.lock().ok()?.get(index).cloned());
        let Some(item) = item else {
            return true;
        };
        let detail = serde_json::to_string(&item.id).unwrap_or_default();
        format!(
            "window.dispatchEvent(new CustomEvent('zicode:open-quick-tool',{{detail:{detail}}}))"
        )
    };
    if let Err(error) = window
        .show()
        .and_then(|_| window.unminimize())
        .and_then(|_| window.set_focus())
        .and_then(|_| window.eval(event))
    {
        log::warn!("[quick-tools] could not open shortcut: {error}");
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quick_tools_are_bounded_navigation_metadata() {
        let item = Shortcut {
            id: "plugin:tool".into(),
            title: "Base64 解码".into(),
        };
        assert!(validate(std::slice::from_ref(&item)).is_ok());
        assert!(validate(&[item.clone(), item.clone()]).is_err());
        assert!(validate(&vec![item; 9]).is_err());
        for id in ["", "x\n", " x", "x\u{7f}"] {
            assert!(validate(&[Shortcut {
                id: id.into(),
                title: "Tool".into()
            }])
            .is_err());
        }
        assert!(validate(&[Shortcut {
            id: "tool".into(),
            title: "Tool\tlabel".into()
        }])
        .is_err());
    }
}
