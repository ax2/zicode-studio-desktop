use crate::{browser_store::Store, HostServer, NativePiManagerState, RuntimeTarget};
use serde::Deserialize;
use tauri::{AppHandle, Manager, WebviewWindow};

const PREFIX: &str = "native-workspace-browser-window-";
pub(crate) const PRIVATE: &str = "native-workspace-private-browser-";
pub(crate) fn private(label: &str) -> bool {
    label
        .strip_prefix(PRIVATE)
        .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok_and(|u| u.to_string() == id))
}

pub(crate) fn secondary(label: &str) -> bool {
    private(label)
        || label
            .strip_prefix(PREFIX)
            .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok_and(|uuid| uuid.to_string() == id))
}
fn catalog() -> Result<Store, String> {
    Store::open(&crate::app_paths::data_root()?.join("browser"))
}

fn open(
    app: &AppHandle,
    host: &HostServer,
    target: &RuntimeTarget,
    label: &str,
) -> Result<(), String> {
    if !secondary(label) {
        return Err("Invalid browser window identity".into());
    }
    if app.get_webview_window(label).is_some() {
        return Ok(());
    }
    crate::open_native_workspace_window_named(app, host, target, Some("com.zicode.browser"), label)
}

pub(crate) fn restore(
    app: &AppHandle,
    host: &HostServer,
    target: &RuntimeTarget,
    parent: &str,
) -> Result<(), String> {
    crate::browser_private::cleanup_previous();
    for label in catalog()?.open_browser_windows(parent)? {
        if let Err(e) = open(app, host, target, &label) {
            log::warn!("Cannot restore browser window {label}: {e}");
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Action {
    New,
    Private,
    OpenProfile,
    CreateProfile,
    Reopen,
    CanReopen,
    Close,
}

#[tauri::command]
pub(crate) async fn browser_window_command(
    window: WebviewWindow,
    action: Action,
    profile_id: Option<String>,
    profile_name: Option<String>,
) -> Result<bool, String> {
    crate::require_workspace_window(&window)?;
    let app = window.app_handle().clone();
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = send.send(execute(&handle, &window, action, profile_id, profile_name));
    })
    .map_err(|e| e.to_string())?;
    receive
        .await
        .map_err(|_| "Browser window request interrupted".to_owned())?
}

fn execute(
    app: &AppHandle,
    window: &WebviewWindow,
    action: Action,
    profile_id: Option<String>,
    profile_name: Option<String>,
) -> Result<bool, String> {
    // Both the owner and the workspace route come from the authenticated caller.
    crate::require_workspace_window(window)?;
    let store = catalog()?;
    let caller = window.label();
    let is_private = private(caller);
    let parent = if secondary(caller) && !is_private {
        store.browser_parent(caller)?
    } else {
        caller.to_owned()
    };
    match action {
        Action::CanReopen => return Ok(!is_private && store.last_closed_window(&parent)?.is_some()),
        Action::Close => {
            if !secondary(caller) {
                return Err("Only additional browser windows can be closed here".into());
            }
            if !is_private {
                store.mark_browser_window(caller, false)?;
            }
            if let Err(e) = window.destroy() {
                if !is_private {
                    store.mark_browser_window(caller, true)?;
                }
                return Err(e.to_string());
            }
            return Ok(true);
        }
        _ => {}
    }
    let url = window.url().map_err(|e| e.to_string())?;
    let (workspace, session) = crate::desktop_tools::route_identity(url.path())?;
    let target = app
        .state::<NativePiManagerState>()
        .statuses()?
        .into_iter()
        .find(|s| s.target.workspace_id == workspace && s.target.session_id == session)
        .ok_or("Browser workspace is unavailable")?
        .target;
    let host = app.state::<HostServer>();
    if matches!(action, Action::Private) || (is_private && matches!(action, Action::New)) {
        let label = format!("{PRIVATE}{}", uuid::Uuid::new_v4());
        crate::browser_private::begin(&label)?;
        if let Err(error) = open(app, &host, &target, &label) {
            crate::browser_private::finish(&label);
            return Err(error);
        }
        return Ok(true);
    }
    if is_private {
        return Err("Open browser profiles from a regular window".into());
    }
    let label = match action {
        Action::New | Action::OpenProfile | Action::CreateProfile => {
            let label = format!("{PREFIX}{}", uuid::Uuid::new_v4());
            let profile = match action {
                Action::CreateProfile => {
                    Some(store.add_profile(profile_name.as_deref().unwrap_or(""))?)
                }
                Action::OpenProfile => profile_id,
                _ => store.profile_for_window(caller)?.map(|p| p.id),
            };
            if let Some(profile) = profile {
                store.bind_profile(&label, &profile)?;
            }
            store.insert_browser_window(&parent, &label)?;
            label
        }
        Action::Reopen => {
            let Some(label) = store.last_closed_window(&parent)? else {
                return Ok(false);
            };
            store.mark_browser_window(&label, true)?;
            label
        }
        _ => unreachable!(),
    };
    if let Err(e) = open(app, &host, &target, &label) {
        store.mark_browser_window(&label, false)?;
        return Err(e);
    }
    Ok(true)
}
