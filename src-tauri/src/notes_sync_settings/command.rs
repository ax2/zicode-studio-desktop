use super::{secrets::SystemSecrets, Save, Status};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{Manager, WebviewWindow};

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Request {
    #[serde(rename_all = "camelCase")]
    Status { workspace_id: String },
    #[serde(rename_all = "camelCase")]
    History { workspace_id: String },
    #[serde(rename_all = "camelCase")]
    Restore {
        workspace_id: String,
        expected_revision: String,
        revision: String,
    },
    #[serde(rename_all = "camelCase")]
    Save {
        workspace_id: String,
        settings: Save,
    },
    #[serde(rename_all = "camelCase")]
    NewRecoveryCode { workspace_id: String },
}

#[tauri::command]
pub(crate) async fn notes_sync_settings(
    window: WebviewWindow,
    request: Request,
) -> std::result::Result<Value, String> {
    crate::require_workspace_window(&window)?;
    let workspace = match &request {
        Request::Status { workspace_id }
        | Request::History { workspace_id }
        | Request::Restore { workspace_id, .. }
        | Request::Save { workspace_id, .. }
        | Request::NewRecoveryCode { workspace_id } => workspace_id,
    };
    {
        let windows = window
            .try_state::<crate::WindowWorkspaceState>()
            .ok_or("notes_sync_workspace_unavailable")?;
        if windows
            .0
            .lock()
            .map_err(|_| "notes_sync_workspace_unavailable")?
            .get(window.label())
            != Some(workspace)
        {
            return Err("notes_sync_workspace_unavailable".into());
        }
    }
    super::workspace_key(workspace).map_err(str::to_owned)?;
    let enabled = crate::desktop_profile::system_credentials_enabled();
    let root = crate::app_paths::system_root()?;
    let test_name = crate::desktop_profile::test_profile_name().map(str::to_owned);
    tauri::async_runtime::spawn_blocking(move || {
        let status: Status = match request {
            Request::History { workspace_id } => {
                let entries = super::history(&root, test_name.as_deref(), &workspace_id)
                    .map_err(str::to_owned)?;
                return serde_json::to_value(entries)
                    .map_err(|_| "notes_sync_settings_unavailable".to_owned());
            }
            Request::Restore {
                workspace_id,
                expected_revision,
                revision,
            } => {
                if !enabled {
                    return Err("notes_sync_credentials_disabled".to_owned());
                }
                super::restore(
                    &root,
                    test_name.as_deref(),
                    &workspace_id,
                    &expected_revision,
                    &revision,
                )
                .map_err(str::to_owned)?;
                super::status(
                    &root,
                    test_name.as_deref(),
                    &workspace_id,
                    enabled,
                    &SystemSecrets,
                )
            }
            Request::Status { workspace_id } => super::status(
                &root,
                test_name.as_deref(),
                &workspace_id,
                enabled,
                &SystemSecrets,
            ),
            Request::Save {
                workspace_id,
                settings,
            } => super::save(
                &root,
                test_name.as_deref(),
                &workspace_id,
                enabled,
                &SystemSecrets,
                settings,
            ),
            Request::NewRecoveryCode { .. } => {
                if !enabled {
                    return Err("notes_sync_credentials_disabled".to_owned());
                }
                return Ok(json!({ "recoveryCode": crate::notes_sync::SyncKey::generate().1 }));
            }
        }
        .map_err(str::to_owned)?;
        serde_json::to_value(status).map_err(|_| "notes_sync_settings_unavailable".to_owned())
    })
    .await
    .map_err(|_| "notes_sync_settings_unavailable".to_owned())?
}
