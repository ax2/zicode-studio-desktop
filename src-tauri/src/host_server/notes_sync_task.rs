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
                let review_context = crate::notes_sync_task::ReviewContext {
                    scene: scene_id.clone(),
                    revision: revision.clone(),
                };
                let repository = super::notes_sync_repository::resolve(
                    &self.state,
                    super::notes_sync_repository::Context {
                        root,
                        test_name,
                        workspace: workspace_id.clone(),
                        scene: scene_id.clone(),
                        revision,
                        enabled,
                    },
                )
                .await
                .map_err(|_| "notes_sync_task_unavailable")??;
                self.launch_notes_sync_with_context(
                    &workspace_id,
                    &scene_id,
                    repository,
                    Some(review_context),
                )
            }
        }
    }

    #[cfg(test)]
    fn launch_notes_sync(
        &self,
        workspace: &str,
        scene: &str,
        repository: crate::notes_sync::repository::SyncRepository,
    ) -> Result<Status, String> {
        self.launch_notes_sync_with_context(workspace, scene, repository, None)
    }

    pub(super) fn launch_notes_sync_with_context(
        &self,
        workspace_id: &str,
        scene: &str,
        repository: crate::notes_sync::repository::SyncRepository,
        context: Option<crate::notes_sync_task::ReviewContext>,
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
        if let Some(context) = context {
            run.review_context(context);
        }
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
