//! Explicit desktop-only saved-note sync. No automatic startup or timer.
mod state;
use serde::{Deserialize, Serialize};
pub(crate) use state::{Runs, Status};
use tauri::{Manager, WebviewWindow};

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Request {
    #[serde(rename_all = "camelCase")]
    Status {
        workspace_id: String,
        scene_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Start {
        workspace_id: String,
        scene_id: String,
        revision: String,
        confirmed: bool,
    },
    #[serde(rename_all = "camelCase")]
    Cancel {
        workspace_id: String,
        scene_id: String,
        run_id: String,
    },
}
impl Request {
    pub(crate) fn scope(&self) -> (&str, &str) {
        match self {
            Self::Status {
                workspace_id,
                scene_id,
            }
            | Self::Start {
                workspace_id,
                scene_id,
                ..
            }
            | Self::Cancel {
                workspace_id,
                scene_id,
                ..
            } => (workspace_id, scene_id),
        }
    }
}

#[tauri::command]
pub(crate) async fn notes_sync_task(
    window: WebviewWindow,
    request: Request,
) -> Result<Status, String> {
    crate::require_workspace_window(&window)?;
    let workspace = request.scope().0;
    {
        let windows = window
            .try_state::<crate::WindowWorkspaceState>()
            .ok_or("notes_sync_workspace_unavailable")?;
        if windows
            .0
            .lock()
            .map_err(|_| "notes_sync_workspace_unavailable")?
            .get(window.label())
            .map(String::as_str)
            != Some(workspace)
        {
            return Err("notes_sync_workspace_unavailable".into());
        }
    }
    let host = window
        .try_state::<crate::host_server::HostServer>()
        .ok_or("notes_sync_workspace_unavailable")?;
    host.notes_sync_task(
        request,
        crate::app_paths::system_root()?,
        crate::desktop_profile::test_profile_name().map(str::to_owned),
        crate::desktop_profile::system_credentials_enabled(),
    )
    .await
}

#[cfg(test)]
mod contract_tests {
    use super::*;
    #[test]
    fn frontend_contract_requests_roundtrip_and_reject_unexpected_destination_or_secret_fields() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/notes-sync-task/contract.json"
        ))
        .unwrap();
        for request in fixture["requests"].as_object().unwrap().values() {
            let parsed: Request = serde_json::from_value(request.clone()).unwrap();
            assert_eq!(parsed.scope(), ("workspace-a", "programming"));
            assert_eq!(&serde_json::to_value(parsed).unwrap(), request);
        }
        for rejected in fixture["rejectedRequests"].as_array().unwrap() {
            assert!(
                serde_json::from_value::<Request>(rejected.clone()).is_err(),
                "unexpected request accepted: {rejected}"
            );
        }
    }
}
