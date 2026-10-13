//! Receive secondary desktop launches without trusting their raw arguments.
//! The callback can arrive before Host setup, so requests wait in memory.
use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::explorer_launch_state::{EntryIntent, ExplorerLaunchState};
use crate::{desktop_tools, explorer_entry, WorkspaceLauncher};

const MAX_PENDING: usize = 32;

#[derive(Default)]
pub struct SecondaryLaunchQueue {
    pending: Mutex<VecDeque<Vec<String>>>,
    ready: AtomicBool,
    overflowed: AtomicBool,
}

impl SecondaryLaunchQueue {
    pub fn enqueue(self: &Arc<Self>, app: &AppHandle, args: Vec<String>) {
        let queued = self.pending.lock().map(|mut pending| {
            if pending.len() >= MAX_PENDING {
                false
            } else {
                pending.push_back(args);
                true
            }
        });
        if !matches!(queued, Ok(true)) {
            log::warn!("[desktop-entry] secondary launch queue unavailable or full");
            self.overflowed.store(true, Ordering::Release);
            if self.ready.load(Ordering::Acquire) {
                self.schedule(app);
            }
            return;
        }
        if self.ready.load(Ordering::Acquire) {
            self.schedule(app);
        }
    }

    pub fn mark_ready(self: &Arc<Self>, app: &AppHandle) {
        self.ready.store(true, Ordering::Release);
        self.schedule(app);
    }

    fn schedule(self: &Arc<Self>, app: &AppHandle) {
        let queue = Arc::clone(self);
        let handle = app.clone();
        if let Err(error) = app.run_on_main_thread(move || queue.drain(&handle)) {
            log::error!("[desktop-entry] could not schedule secondary launch: {error}");
            notify_failure(
                app,
                "Studio could not receive the Explorer request. Try again.",
            );
        }
    }

    fn drain(&self, app: &AppHandle) {
        if self.overflowed.swap(false, Ordering::AcqRel) {
            notify_failure(
                app,
                "Too many pending Studio launches. Try again after startup.",
            );
        }
        loop {
            let args = match self.pending.lock() {
                Ok(mut pending) => pending.pop_front(),
                Err(_) => {
                    notify_failure(app, "Studio launch queue is unavailable.");
                    return;
                }
            };
            let Some(args) = args else { return };
            if let Err(error) = dispatch(app, &args) {
                log::warn!("[desktop-entry] secondary launch rejected: {error}");
                notify_failure(app, &error);
            }
        }
    }
}

fn notify_failure(app: &AppHandle, message: &str) {
    app.dialog()
        .message(message.to_string())
        .title("ZiCode Studio Desktop")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

fn bind_visible(
    app: &AppHandle,
    window: &WebviewWindow,
    expected_workspace: &str,
    intent: EntryIntent,
) -> Result<(), String> {
    let url = window.url().map_err(|error| error.to_string())?;
    let (workspace, session) = desktop_tools::route_identity(url.path())?;
    if workspace != expected_workspace {
        return Err("Explorer project window changed; reopen the selected folder".into());
    }
    app.state::<ExplorerLaunchState>()
        .bind(window.label(), workspace, session, intent)?;
    window
        .show()
        .and_then(|_| window.unminimize())
        .and_then(|_| window.set_focus())
        .map_err(|error| error.to_string())?;
    window
        .eval("window.dispatchEvent(new Event('zicode:entry-changed'))")
        .map_err(|error| format!("Could not refresh Explorer entry: {error}"))
}

fn open_folder(app: &AppHandle, folder: &Path) -> Result<(), String> {
    let launcher = app
        .try_state::<WorkspaceLauncher>()
        .ok_or("Workspace launcher is not ready")?;
    let workspace_id = launcher
        .metadata
        .lock()
        .map_err(|_| "Workspace metadata is unavailable")?
        .workspace_id_for_path(folder)?;
    let runtimes = app
        .try_state::<crate::NativePiManagerState>()
        .ok_or("Native runtime manager is not ready")?;
    for window in app.webview_windows().into_values() {
        let Ok(url) = window.url() else { continue };
        let Ok((workspace, session)) = desktop_tools::route_identity(url.path()) else {
            continue;
        };
        if workspace != workspace_id {
            continue;
        }
        let Some(target) = runtimes.target_for_session(workspace, session) else {
            continue;
        };
        if runtimes.is_discovery_disabled_ai_session(&target) != Ok(true) {
            continue;
        }
        return bind_visible(
            app,
            &window,
            &workspace_id,
            EntryIntent::Folder(folder.to_path_buf()),
        );
    }
    // An ordinary AI window may have loaded user extensions. Keep its draft
    // and start an Explorer-owned session with discovery disabled instead.
    let label = format!(
        "native-workspace-explorer-{workspace_id}-{}",
        uuid::Uuid::new_v4().simple()
    );
    crate::open_workspace_at_path_from_explorer(app, folder, &label)?;
    let window = app
        .get_webview_window(&label)
        .ok_or("Explorer project window was not created")?;
    // The state was bound before WebView creation. Its URL can still be
    // about:blank here; the initial page query will read the bound intent.
    window
        .show()
        .and_then(|_| window.unminimize())
        .and_then(|_| window.set_focus())
        .map_err(|error| error.to_string())
}

fn dispatch(app: &AppHandle, args: &[String]) -> Result<(), String> {
    let intent = explorer_entry::forwarded_intent(args)?;
    log::info!(
        "[desktop-entry] receiving secondary launch: {}",
        intent.as_ref().map_or("regular", EntryIntent::mode)
    );
    match intent {
        Some(EntryIntent::File(file)) => {
            let root = file
                .parent()
                .ok_or("Selected file has no project directory")?
                .to_path_buf();
            desktop_tools::open_from_explorer(app, &root, EntryIntent::File(file))
        }
        Some(EntryIntent::Folder(folder)) => open_folder(app, &folder),
        Some(EntryIntent::Drive) => desktop_tools::open_from_explorer(
            app,
            &crate::app_paths::global_workspace_root()?,
            EntryIntent::Drive,
        ),
        Some(EntryIntent::Tools) => desktop_tools::open_from_explorer(
            app,
            &crate::app_paths::global_workspace_root()?,
            EntryIntent::Tools,
        ),
        None => {
            crate::desktop_tray::show_workspaces(app);
            Ok(())
        }
    }
}
