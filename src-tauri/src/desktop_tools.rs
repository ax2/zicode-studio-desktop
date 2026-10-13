//! One reusable, Host-owned tool window. Never navigate a project or spawn Pi.
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::{HostServer, NativePiManagerState, RuntimeTarget, WorkspaceLauncher};

const LABEL: &str = "native-workspace-tools-center";

pub(crate) fn can_replace_window(label: &str) -> bool {
    label.starts_with("native-workspace-") && label != LABEL
}

#[derive(Default)]
pub(crate) struct ToolCenter(Mutex<Option<RuntimeTarget>>);

#[tauri::command]
pub(crate) async fn open_desktop_tool_center(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    // Serialize menu and IPC entry on the UI thread; never block that thread
    // on a background opener holding the singleton while building a WebView.
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = send.send(open(&handle));
    })
    .map_err(|error| error.to_string())?;
    receive
        .await
        .map_err(|_| "Tool center request interrupted".to_string())?
}

pub(crate) fn open(app: &AppHandle) -> Result<(), String> {
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
    let existing = app.get_webview_window(LABEL);
    if let (Some(target), Some(window)) = (retained.as_ref(), existing.as_ref()) {
        if runtimes.is_tool_session(target).unwrap_or(false) {
            // Preserve search, open tools, drafts, grants and in-flight calls.
            return restore(window);
        }
    }

    // The default workspace has Studio's own data scope; no Explorer path,
    // active AI session, history or producer configuration is inherited.
    let root = crate::app_paths::global_workspace_root()?;
    let launcher = app
        .try_state::<WorkspaceLauncher>()
        .ok_or("Workspace launcher is not ready")?;
    let workspace_id = launcher
        .metadata
        .lock()
        .map_err(|_| "Workspace metadata is unavailable")?
        .workspace_id_for_path(&root)?;
    host.register_workspace(&workspace_id, root)?;
    let target = new_target(workspace_id);
    host.start_tool_session(target.clone())?;
    let opened = if let Some(window) = existing {
        crate::native_workspace_url(host.origin(), &target, Some("core.tools"))
            .and_then(|url| window.navigate(url).map_err(|error| error.to_string()))
            .and_then(|_| {
                crate::set_window_workspace(app, LABEL, &target.workspace_id);
                restore(&window)
            })
    } else {
        crate::open_native_workspace_window_named(app, &host, &target, Some("core.tools"), LABEL)
    };
    if let Err(error) = opened {
        let _ = runtimes.stop(&target);
        return Err(error);
    }
    // An externally destroyed window may leave a tool lifetime behind.
    if let Some(previous) = retained.replace(target) {
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
    }
}
