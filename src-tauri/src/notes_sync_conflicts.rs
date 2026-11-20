//! Only the trusted, workspace-bound Studio shell can read or apply reviews.
use crate::notes_vault::conflicts::{Choice, CopyLocale};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Manager, WebviewWindow};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Decision {
    pub id: String,
    pub choice: Choice,
}
#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Request {
    #[serde(rename_all = "camelCase")]
    List {
        workspace_id: String,
        scene_id: String,
        run_id: String,
        revision: String,
        #[serde(default)]
        cursor: usize,
    },
    #[serde(rename_all = "camelCase")]
    Detail {
        workspace_id: String,
        scene_id: String,
        run_id: String,
        revision: String,
        id: String,
    },
    #[serde(rename_all = "camelCase")]
    Apply {
        workspace_id: String,
        scene_id: String,
        run_id: String,
        revision: String,
        confirmed: bool,
        locale: CopyLocale,
        choices: Vec<Decision>,
    },
}
impl Request {
    pub(crate) fn scope(&self) -> (&str, &str, &str, &str) {
        match self {
            Self::List {
                workspace_id,
                scene_id,
                run_id,
                revision,
                ..
            }
            | Self::Detail {
                workspace_id,
                scene_id,
                run_id,
                revision,
                ..
            }
            | Self::Apply {
                workspace_id,
                scene_id,
                run_id,
                revision,
                ..
            } => (workspace_id, scene_id, run_id, revision),
        }
    }
}
#[tauri::command]
pub(crate) async fn notes_sync_conflicts(
    window: WebviewWindow,
    request: Request,
) -> Result<Value, String> {
    crate::notes_sync_task::require_scope(&window, request.scope().0)?;
    let host = window
        .try_state::<crate::host_server::HostServer>()
        .ok_or("notes_sync_workspace_unavailable")?;
    host.notes_sync_conflicts(
        request,
        crate::app_paths::system_root()?,
        crate::desktop_profile::test_profile_name().map(str::to_owned),
        crate::desktop_profile::system_credentials_enabled(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_frontend_requests_roundtrip_and_reject_secret_or_destination_overrides() {
        let value: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/notes-sync-conflicts/contract.json"
        ))
        .unwrap();
        for request in value["requests"].as_object().unwrap().values() {
            let parsed: Request = serde_json::from_value(request.clone()).unwrap();
            assert_eq!(
                parsed.scope(),
                ("workspace-a", "programming", "run-owned", "revision-a")
            );
            assert_eq!(serde_json::to_value(parsed).unwrap(), *request);
        }
        for request in value["rejectedRequests"].as_array().unwrap() {
            assert!(serde_json::from_value::<Request>(request.clone()).is_err());
        }
    }
}
