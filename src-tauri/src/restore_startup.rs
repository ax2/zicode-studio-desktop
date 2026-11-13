//! Keep failed offline restores out of the normal Host/Pi startup path.
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};

const KEEP_REQUEST: &str = "保留请求 / Keep request";
const CANCEL_RESTORE: &str = "撤销恢复 / Cancel restore";
const DISMISS: &str = "关闭 / Close";

#[derive(Clone)]
struct PendingCancellation {
    request_id: String,
    workspaces: Vec<(String, String)>,
    error: String,
}

pub(crate) fn apply(app: &AppHandle, workspaces: &[(String, String)]) -> Result<(), String> {
    if !crate::backup_store::startup_restore_needed(workspaces)? {
        return Ok(());
    }
    let _maintenance =
        tauri::async_runtime::block_on(crate::automation_worker::stop_for_restore())?;
    if let Err(error) = crate::backup_store::apply_startup_restore(workspaces) {
        // Inspect while still holding maintenance. The backend reconciles any
        // uncommitted swap and rejects committed or ambiguous transactions.
        match crate::backup_store::cancellable_startup_restore(workspaces) {
            Ok(Some(request_id)) => {
                app.manage(PendingCancellation {
                    request_id,
                    workspaces: workspaces.to_vec(),
                    error: error.clone(),
                });
            }
            Ok(None) => {}
            Err(reason) => log::warn!("[restore] cannot offer safe cancellation: {reason}"),
        }
        return Err(error);
    }
    Ok(())
}

/// Called once, after the startup error window exists. No web command grants
/// access to this operation; only this native confirmation can authorize it.
pub(crate) fn offer_cancellation(app: &AppHandle) {
    let Some(pending) = app.try_state::<PendingCancellation>() else {
        return;
    };
    let pending = pending.inner().clone();
    let callback_app = app.clone();
    let mut dialog = app
        .dialog()
        .message(format!(
            "无法应用排队的备份恢复。当前资料已保留，未启动工作区。\n\n{}\n\n是否撤销这次恢复请求？快照将保留。撤销成功后请退出并重新打开 Studio。\n\nThe queued restore failed. Cancel this request and keep the current data and backup? Restart Studio manually after cancellation.",
            pending.error
        ))
        .title("备份恢复未完成 / Restore incomplete")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            KEEP_REQUEST.into(),
            CANCEL_RESTORE.into(),
            DISMISS.into(),
        ));
    if let Some(window) = app.get_webview_window("bootstrap") {
        dialog = dialog.parent(&window);
    }
    dialog.show_with_result(move |result| {
        if !explicit_cancellation(result) {
            return;
        }
        tauri::async_runtime::spawn(async move {
            let result = cancel(&pending).await;
            let (message, kind) = match result {
                Ok(()) => (
                    "已撤销恢复请求，保留了当前资料和快照。请退出并重新打开 Studio。\n\nRestore request cancelled. Current data and backups were kept. Quit and reopen Studio.".to_owned(),
                    MessageDialogKind::Info,
                ),
                Err(error) => {
                    log::error!("[restore] cancellation failed: {error}");
                    (
                        format!("未能撤销恢复。已保留请求和恢复现场，请勿删除资料。\n\nRestore could not be cancelled; the request and recovery files were kept.\n\n{error}"),
                        MessageDialogKind::Error,
                    )
                }
            };
            let mut dialog = callback_app.dialog().message(message)
                .title("备份恢复 / Backup restore").kind(kind);
            if let Some(window) = callback_app.get_webview_window("bootstrap") {
                dialog = dialog.parent(&window);
            }
            dialog.show(|_| {});
        });
    });
}

async fn cancel(pending: &PendingCancellation) -> Result<(), String> {
    // The first lease ended before the dialog. Reacquire it and revalidate the
    // exact request, including commit state, after the user has responded.
    let _maintenance = crate::automation_worker::stop_for_restore().await?;
    crate::backup_store::cancel_startup_restore(&pending.request_id, &pending.workspaces)
}

// Tauri maps window-close to the custom Cancel label on every desktop platform.
// Keep that label separate from the No-position destructive action.
// The first/default button keeps the queued request, so Enter is non-destructive.
fn explicit_cancellation(result: MessageDialogResult) -> bool {
    matches!(result, MessageDialogResult::Custom(label) if label == CANCEL_RESTORE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_explicit_restore_cancellation_button_authorizes_changes() {
        for result in [
            MessageDialogResult::Cancel,
            MessageDialogResult::Ok,
            MessageDialogResult::Yes,
            MessageDialogResult::No,
            MessageDialogResult::Custom(KEEP_REQUEST.into()),
            MessageDialogResult::Custom(DISMISS.into()),
            MessageDialogResult::Custom("unknown".into()),
        ] {
            assert!(!explicit_cancellation(result));
        }
        assert!(explicit_cancellation(MessageDialogResult::Custom(
            CANCEL_RESTORE.into()
        )));
    }
}
