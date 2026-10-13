//! Reusable Host-owned tool windows. Project selection never spawns Pi.
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::{
    explorer_launch_state::{EntryIntent, ExplorerLaunchState},
    HostServer, NativePiManagerState, RuntimeTarget, WorkspaceLauncher,
};

const LABEL: &str = "native-workspace-tools-center";

pub(crate) fn can_replace_window(label: &str) -> bool {
    label.starts_with("native-workspace-")
        && label != LABEL
        && !label.starts_with("native-workspace-tools-center-")
}

#[derive(Default)]
pub(crate) struct ToolCenter(Mutex<HashMap<String, RuntimeTarget>>);

/// Unknown/stopped pages must not silently become AI sessions.
pub(crate) fn source_is_tools(window: &WebviewWindow) -> Result<bool, String> {
    crate::require_workspace_window(window)?;
    let url = window.url().map_err(|error| error.to_string())?;
    let (workspace, session) = route_identity(url.path())?;
    let runtimes = window.state::<NativePiManagerState>();
    let targets: Vec<_> = runtimes
        .statuses()?
        .into_iter()
        .filter(|status| {
            status.target.workspace_id == workspace && status.target.session_id == session
        })
        .collect();
    if targets.len() != 1 {
        return Err("Current runtime is unavailable or ambiguous; reopen the workspace".into());
    }
    runtimes.is_tool_session(&targets[0].target)
}

pub(crate) fn project_navigation_source(
    source: Option<&WebviewWindow>,
) -> Result<Option<&WebviewWindow>, String> {
    let Some(window) = source else {
        return Ok(None);
    };
    crate::require_workspace_window(window)?;
    // This helper serves explicit AI/session actions: a stopped source must
    // still allow recovery, but its page must not be replaced on uncertainty.
    if !can_replace_window(window.label()) || source_is_tools(window).unwrap_or(true) {
        return Ok(None);
    }
    Ok(Some(window))
}

/// An Explorer tools window may own the traditional project label already.
/// Explicit AI opens use another label instead of replacing that tool window.
pub(crate) fn project_window_label(app: &AppHandle, workspace: &str) -> String {
    let label = format!("native-workspace-{workspace}");
    if app
        .get_webview_window(&label)
        .is_some_and(|window| source_is_tools(&window).unwrap_or(true))
    {
        format!("native-workspace-ai-{workspace}")
    } else {
        label
    }
}

pub(crate) fn route_identity(path: &str) -> Result<(&str, &str), String> {
    let parts: Vec<_> = path.split('/').collect();
    match parts.as_slice() {
        ["", "app", "workspaces", workspace, "sessions", session]
            if !workspace.is_empty() && !session.is_empty() =>
        {
            Ok((workspace, session))
        }
        _ => Err("Current workspace route is unavailable".into()),
    }
}

#[tauri::command]
pub(crate) async fn open_desktop_tool_center(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    open_project(
        app,
        crate::app_paths::global_workspace_root()?,
        Some("core.tools".into()),
    )
    .await
}

pub(crate) async fn open_project(
    app: AppHandle,
    root: PathBuf,
    app_param: Option<String>,
) -> Result<(), String> {
    // Serialize menu and IPC entry on the UI thread; never block that thread
    // on a background opener holding the singleton while building a WebView.
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = send.send(open_at(&handle, &root, app_param.as_deref()));
    })
    .map_err(|error| error.to_string())?;
    receive
        .await
        .map_err(|_| "Tool center request interrupted".to_string())?
}

pub(crate) fn open(app: &AppHandle) -> Result<(), String> {
    open_at(
        app,
        &crate::app_paths::global_workspace_root()?,
        Some("core.tools"),
    )
}

fn open_at(app: &AppHandle, root: &Path, app_param: Option<&str>) -> Result<(), String> {
    open_at_with_intent(app, root, app_param, None)
}

pub(crate) fn open_from_explorer(
    app: &AppHandle,
    root: &Path,
    intent: EntryIntent,
) -> Result<(), String> {
    open_at_with_intent(app, root, Some("core.tools"), Some(intent))
}

fn notify_entry_change(window: &WebviewWindow) -> Result<(), String> {
    window
        .eval("window.dispatchEvent(new Event('zicode:entry-changed'))")
        .map_err(|error| format!("Could not refresh Explorer entry: {error}"))
}

fn open_at_with_intent(
    app: &AppHandle,
    root: &Path,
    app_param: Option<&str>,
    intent: Option<EntryIntent>,
) -> Result<(), String> {
    let state = app
        .try_state::<ToolCenter>()
        .ok_or("Tool center is not ready")?;
    let host = app
        .try_state::<HostServer>()
        .ok_or("Desktop host is not ready")?;
    let runtimes = app
        .try_state::<NativePiManagerState>()
        .ok_or("Runtime manager is not ready")?;
    let mut retained = state
        .0
        .lock()
        .map_err(|_| "Tool center state is unavailable")?;
    let root = root.canonicalize().map_err(|_| "Project is unavailable")?;
    if !root.is_dir() {
        return Err("Choose a project directory".into());
    }
    let launcher = app
        .try_state::<WorkspaceLauncher>()
        .ok_or("Workspace launcher is not ready")?;
    let workspace_id = launcher
        .metadata
        .lock()
        .map_err(|_| "Workspace metadata is unavailable")?
        .workspace_id_for_path(&root)?;
    let global = crate::app_paths::global_workspace_root()?
        .canonicalize()
        .map_err(|_| "Default workspace is unavailable")?;
    let label = if root == global {
        LABEL.to_string()
    } else {
        format!("{LABEL}-{workspace_id}")
    };
    let title = root
        .file_name()
        .map(|name| format!("ZiCode Studio Desktop · 工具 · {}", name.to_string_lossy()));
    let existing = app.get_webview_window(&label);
    if let (Some(target), Some(window)) = (retained.get(&label), existing.as_ref()) {
        if runtimes.is_tool_session(target).unwrap_or(false) {
            if let Some(intent) = intent {
                app.state::<ExplorerLaunchState>().bind(
                    &label,
                    &target.workspace_id,
                    &target.session_id,
                    intent,
                )?;
                restore(window)?;
                return notify_entry_change(window);
            }
            return restore(window);
        }
    }
    host.register_workspace(&workspace_id, root)?;
    let target = new_target(workspace_id);
    host.start_tool_session(target.clone())?;
    if let Some(intent) = intent.clone() {
        if let Err(error) = app.state::<ExplorerLaunchState>().bind(
            &label,
            &target.workspace_id,
            &target.session_id,
            intent,
        ) {
            let _ = runtimes.stop(&target);
            return Err(error);
        }
    }
    let opened = if let Some(window) = existing {
        crate::native_workspace_url(host.origin(), &target, app_param.or(Some("core.tools")))
            .and_then(|url| window.navigate(url).map_err(|error| error.to_string()))
            .and_then(|_| {
                crate::set_window_workspace(app, &label, &target.workspace_id);
                restore(&window)
            })
    } else {
        crate::open_native_workspace_window_named(
            app,
            &host,
            &target,
            app_param.or(Some("core.tools")),
            &label,
        )
    };
    if let Err(error) = opened {
        app.state::<ExplorerLaunchState>().forget(&label);
        let _ = runtimes.stop(&target);
        return Err(error);
    }
    if intent.is_some() {
        if let Some(window) = app.get_webview_window(&label) {
            // A new page can still be loading; its initial query reads the
            // bound state. An existing page needs an explicit refresh.
            let _ = notify_entry_change(&window);
        }
    } else {
        app.state::<ExplorerLaunchState>().forget(&label);
    }
    if let (Some(window), Some(title)) = (app.get_webview_window(&label), title) {
        if let Err(error) = window.set_title(&title) {
            log::warn!("[desktop-tools] title unavailable: {error}");
        }
    }
    // An externally destroyed window may leave a tool lifetime behind.
    if let Some(previous) = retained.insert(label, target) {
        let _ = runtimes.stop(&previous);
    }
    Ok(())
}

fn restore(window: &WebviewWindow) -> Result<(), String> {
    window
        .show()
        .and_then(|_| window.unminimize())
        .and_then(|_| window.set_focus())
        .map_err(|error| error.to_string())
}

fn new_target(workspace_id: String) -> RuntimeTarget {
    RuntimeTarget::new(
        workspace_id,
        format!("tools-{}", uuid::Uuid::new_v4().simple()),
        format!("instance-{}", uuid::Uuid::new_v4().simple()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_tools_identity_is_unique_and_stays_in_its_workspace() {
        let first = new_target("workspace".into());
        let second = new_target("workspace".into());
        assert_eq!(first.workspace_id, "workspace");
        assert!(first.session_id.starts_with("tools-"));
        assert_ne!(first.session_id, second.session_id);
        assert_ne!(first.instance_id, second.instance_id);
        assert!(LABEL.starts_with("native-workspace-"));
        assert!(!can_replace_window(LABEL));
        assert!(!can_replace_window("bootstrap"));
        assert!(can_replace_window("native-workspace-project"));
        assert!(!can_replace_window("native-workspace-tools-center-project"));
    }

    #[test]
    fn route_identity_requires_exact_workspace_session_route() {
        assert_eq!(
            route_identity("/app/workspaces/w/sessions/s").unwrap(),
            ("w", "s")
        );
        for path in [
            "/",
            "/app/workspaces/w",
            "/app/workspaces//sessions/s",
            "/app/workspaces/w/sessions/",
            "/app/workspaces/w/sessions/s/extra",
        ] {
            assert!(route_identity(path).is_err());
        }
    }
}
