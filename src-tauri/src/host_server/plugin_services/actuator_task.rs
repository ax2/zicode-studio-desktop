//! Task-center metadata for a confirmed Spring Actuator read.
use super::{ApiError, Grant, PROFILE_VERSION};
use crate::host_server::{plugin_task_center, HostState};
use crate::plugin_registry::PluginRegistry;
use crate::plugin_task_store::{Owner as TaskOwner, State, Store};
use std::sync::Arc;

pub(super) struct ActuatorTask {
    state: Arc<HostState>,
    store: Arc<Store>,
    owner: TaskOwner,
    task_ref: String,
    grant_version: (u64, u64),
    pending: bool,
}

impl ActuatorTask {
    pub(super) async fn start(
        state: Arc<HostState>,
        grant: &Grant,
        grant_id: &str,
    ) -> Option<Self> {
        if grant.owner.plugin_id != "com.zicode.devtools.spring-actuator" {
            return None;
        }
        let workspace_id = grant.owner.workspace_id.clone();
        let plugin_id = grant.owner.plugin_id.clone();
        let scene_id = grant.scene.clone();
        let operation_id = format!("actuator.{}", grant.endpoint.name());
        let grant_id = grant_id.to_owned();
        let grant_version = (grant.revision, grant.generation);
        let request_id = grant.operation_id.clone();
        match tokio::task::spawn_blocking(move || -> Result<Option<Self>, &'static str> {
            let gate = state
                .workspace_write_gates
                .gate(&workspace_id)
                .map_err(|_| "task_workspace_unavailable")?;
            let closed = gate.lock().map_err(|_| "task_workspace_unavailable")?;
            if *closed {
                return Ok(None);
            }
            let registry = state.plugins.lock().map_err(|_| "registry_unavailable")?;
            let Some(package_version) = authorized_package(&registry, &scene_id, &plugin_id) else {
                return Ok(None);
            };
            let grants = state
                .http_get_grants
                .lock()
                .map_err(|_| "http_service_unavailable")?;
            if grant_version != (grants.revision_for(&plugin_id), grants.generation)
                || !grants.operations.get(&request_id).is_some_and(|operation| {
                    !operation.finished && !operation.cancellation.is_cancelled()
                })
            {
                return Ok(None);
            }
            let owner = TaskOwner {
                workspace_id,
                scene_id,
                plugin_id,
                package_version,
                profile_version: PROFILE_VERSION.into(),
                operation_id,
            };
            let store = plugin_task_center::task_store(&state)?;
            let queued = store.submit(&owner, &grant_id, &serde_json::Value::Null)?;
            store.transition(&owner, &queued.task_ref, State::Running)?;
            Ok(Some(Self {
                state: Arc::clone(&state),
                store,
                owner,
                task_ref: queued.task_ref,
                grant_version,
                pending: true,
            }))
        })
        .await
        {
            Ok(Ok(task)) => task,
            Ok(Err(error)) => {
                log::warn!("Could not track the Actuator task: {error}");
                None
            }
            Err(error) => {
                log::warn!("Could not start the Actuator task record: {error}");
                None
            }
        }
    }

    pub(super) fn finish(mut self, failure: Option<&ApiError>) {
        let next = match failure {
            None => State::Succeeded,
            Some(error) => match error.1 .0["error"]["code"].as_str() {
                Some("http_service_request_cancelled") => State::Cancelled,
                Some("http_service_authorization_changed" | "permission_denied") => State::Revoked,
                _ => State::Failed,
            },
        };
        self.pending = false;
        self.schedule_update(next);
    }

    // Journal metadata independently so serving a captured response does not
    // introduce another await after the Host's final authorization check.
    fn schedule_update(&self, outcome: State) {
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return;
        };
        let state = Arc::clone(&self.state);
        let store = Arc::clone(&self.store);
        let owner = self.owner.clone();
        let task_ref = self.task_ref.clone();
        let grant_version = self.grant_version;
        runtime.spawn_blocking(move || {
            let result = (|| {
                let gate = state
                    .workspace_write_gates
                    .gate(&owner.workspace_id)
                    .map_err(|_| "task_workspace_unavailable")?;
                let closed = gate.lock().map_err(|_| "task_workspace_unavailable")?;
                let registry = state.plugins.lock().map_err(|_| "registry_unavailable")?;
                let grants = state
                    .http_get_grants
                    .lock()
                    .map_err(|_| "http_service_unavailable")?;
                let next = if *closed {
                    State::Interrupted
                } else if grant_version
                    != (grants.revision_for(&owner.plugin_id), grants.generation)
                    || authorized_package(&registry, &owner.scene_id, &owner.plugin_id).as_ref()
                        != Some(&owner.package_version)
                {
                    State::Revoked
                } else {
                    outcome
                };
                store.transition(&owner, &task_ref, next)
            })();
            match result {
                Ok(_) | Err("task_transition_invalid") => {}
                Err(error) => log::warn!("Could not update the Actuator task record: {error}"),
            }
        });
    }
}

impl Drop for ActuatorTask {
    fn drop(&mut self) {
        if self.pending {
            self.schedule_update(State::Interrupted);
        }
    }
}

fn authorized_package(
    registry: &PluginRegistry,
    scene_id: &str,
    plugin_id: &str,
) -> Option<String> {
    registry
        .execution_plugin(scene_id, plugin_id)
        .filter(|plugin| {
            plugin.enabled && plugin.permission_grants.get("service.http.read") == Some(&true)
        })
        .map(|plugin| plugin.manifest.version.clone())
}
