use super::*;
use crate::notes_sync_task::{Request, Status};

impl HostServer {
    pub(crate) async fn notes_sync_task(
        &self,
        request: Request,
        root: PathBuf,
        test_name: Option<String>,
        enabled: bool,
    ) -> Result<Status, String> {
        let (workspace, _) = request.scope();
        if self.state.lifecycle.stopping() {
            return Err("notes_sync_task_unavailable".into());
        }
        let gate = self.state.workspace_write_gates.gate(workspace)?;
        if *gate
            .lock()
            .map_err(|_| "notes_sync_workspace_unavailable")?
        {
            return Err("notes_sync_workspace_unavailable".into());
        }
        match request {
            Request::Status { workspace_id, .. } => {
                self.state.notes_sync_runs.status(&workspace_id)
            }
            Request::Cancel {
                workspace_id,
                run_id,
                ..
            } => self.state.notes_sync_runs.cancel(&workspace_id, &run_id),
            Request::Start {
                workspace_id,
                scene_id,
                revision,
                confirmed,
            } => {
                ensure_notes_authorized(&self.state, &scene_id, true)
                    .map_err(|_| "notes_sync_permission_denied".to_owned())?;
                if !confirmed {
                    return Err("notes_sync_confirmation_required".into());
                }
                let scene_for_launch = scene_id.clone();
                let state = Arc::downgrade(&self.state);
                let scope = workspace_id.clone();
                let repository = self
                    .state
                    .lifecycle
                    .blocking(move || {
                        let repository = crate::notes_sync_settings::resolve_for_sync(
                            &root,
                            test_name.as_deref(),
                            &scope,
                            enabled,
                            &revision,
                        )
                        .map_err(str::to_owned)?;
                        Ok::<_, String>(repository.with_guard(move || {
                            let state = state
                                .upgrade()
                                .ok_or(crate::notes_sync::SyncError::Cancelled)?;
                            if state.lifecycle.stopping() {
                                return Err(crate::notes_sync::SyncError::Cancelled);
                            }
                            ensure_notes_authorized(&state, &scene_id, true)
                                .map_err(|_| crate::notes_sync::SyncError::ConfigurationChanged)?;
                            let gate = state
                                .workspace_write_gates
                                .gate(&scope)
                                .map_err(|_| crate::notes_sync::SyncError::ConfigurationChanged)?;
                            if *gate
                                .lock()
                                .map_err(|_| crate::notes_sync::SyncError::ConfigurationChanged)?
                            {
                                return Err(crate::notes_sync::SyncError::ConfigurationChanged);
                            }
                            let lease = crate::notes_sync_settings::lock_current_config(
                                &root,
                                test_name.as_deref(),
                                &scope,
                                &revision,
                            )
                            .map_err(|_| crate::notes_sync::SyncError::ConfigurationChanged)?;
                            Ok(Box::new(lease) as Box<dyn Send>)
                        }))
                    })
                    .await
                    .map_err(|_| "notes_sync_task_unavailable")??;
                self.launch_notes_sync(&workspace_id, &scene_for_launch, repository)
            }
        }
    }

    fn launch_notes_sync(
        &self,
        workspace_id: &str,
        scene: &str,
        repository: crate::notes_sync::repository::SyncRepository,
    ) -> Result<Status, String> {
        ensure_notes_authorized(&self.state, scene, true)
            .map_err(|_| "notes_sync_permission_denied".to_owned())?;
        if self.state.lifecycle.stopping() {
            return Err("notes_sync_task_unavailable".into());
        }
        let gate = self.state.workspace_write_gates.gate(workspace_id)?;
        if *gate
            .lock()
            .map_err(|_| "notes_sync_workspace_unavailable")?
        {
            return Err("notes_sync_workspace_unavailable".into());
        }
        // A competing start cannot send requests before acquiring the run slot.
        let run = self.state.notes_sync_runs.begin(workspace_id)?;
        let cancel = run.token();
        let storage = self.notes_vault()?;
        let lifecycle = self.state.lifecycle.clone();
        let shutdown = lifecycle.clone();
        let scope = workspace_id.to_owned();
        // Return this run's identity, even if it finishes and another window
        // starts a replacement before the caller receives its acceptance.
        let receipt = run.status()?;
        lifecycle.spawn(async move {
            let outcome = tokio::select! {
                biased;
                () = shutdown.cancelled() => Err(crate::notes_sync::SyncError::Cancelled),
                result = repository.synchronize_saved(&storage, &scope, &cancel) => result,
            };
            run.finish(outcome);
        });
        Ok(receipt)
    }
}

#[cfg(test)]
mod tests;
