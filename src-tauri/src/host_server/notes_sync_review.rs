use super::notes_sync_repository::{self, Context};
use super::*;
use crate::notes_sync::SyncError;
use crate::notes_sync_conflicts::Request;
use std::collections::BTreeMap;

fn error(error: SyncError) -> String {
    match error {
        SyncError::LocalChanged | SyncError::ConfigurationChanged | SyncError::Cancelled => {
            "notes_sync_review_changed"
        }
        SyncError::Busy => "notes_sync_review_busy",
        SyncError::TooLarge => "notes_sync_review_too_large",
        SyncError::InvalidData | SyncError::InvalidConfig => "notes_sync_review_invalid",
        _ => "notes_sync_review_unavailable",
    }
    .into()
}
impl HostServer {
    pub(crate) async fn notes_sync_conflicts(
        &self,
        request: Request,
        root: PathBuf,
        test_name: Option<String>,
        enabled: bool,
    ) -> Result<Value, String> {
        let (workspace, scene, run, revision) = request.scope();
        ensure_notes_authorized(&self.state, scene, true)
            .map_err(|_| "notes_sync_permission_denied")?;
        if self.state.lifecycle.stopping() {
            return Err("notes_sync_review_unavailable".into());
        }
        let gate = self.state.workspace_write_gates.gate(workspace)?;
        if *gate
            .lock()
            .map_err(|_| "notes_sync_workspace_unavailable")?
        {
            return Err("notes_sync_review_changed".into());
        }
        if matches!(
            &request,
            Request::Apply {
                confirmed: false,
                ..
            }
        ) {
            return Err("notes_sync_confirmation_required".into());
        }
        let pending = self
            .state
            .notes_sync_runs
            .review(workspace, run, revision, scene)?;
        let repository = notes_sync_repository::resolve(
            &self.state,
            Context {
                root,
                test_name,
                workspace: workspace.to_owned(),
                scene: scene.to_owned(),
                revision: revision.to_owned(),
                enabled,
            },
        )
        .await
        .map_err(|_| "notes_sync_review_unavailable")??;
        // Recheck the run after credential resolution: another window may
        // have explicitly started a replacement while system storage replied.
        drop(pending);
        self.review_conflicts(request, repository).await
    }

    pub(super) async fn review_conflicts(
        &self,
        request: Request,
        repository: crate::notes_sync::repository::SyncRepository,
    ) -> Result<Value, String> {
        let (workspace, scene, run, revision) = request.scope();
        ensure_notes_authorized(&self.state, scene, true)
            .map_err(|_| "notes_sync_permission_denied")?;
        if self.state.lifecycle.stopping() {
            return Err("notes_sync_review_unavailable".into());
        }
        let gate = self.state.workspace_write_gates.gate(workspace)?;
        if *gate
            .lock()
            .map_err(|_| "notes_sync_workspace_unavailable")?
        {
            return Err("notes_sync_review_changed".into());
        }
        if matches!(
            &request,
            Request::Apply {
                confirmed: false,
                ..
            }
        ) {
            return Err("notes_sync_confirmation_required".into());
        }
        let pending = self
            .state
            .notes_sync_runs
            .review(workspace, run, revision, scene)?;
        let lease = if matches!(&request, Request::Apply { .. }) {
            Some(
                self.state
                    .notes_sync_runs
                    .reserve_review(workspace, run, revision, scene)?,
            )
        } else {
            None
        };
        let storage = self.notes_vault()?;
        let owner = Arc::downgrade(&self.state);
        self.state.lifecycle.blocking(move || {
            let (workspace,scene,run,revision)=request.scope();
            match &request {
                Request::List {cursor,..} => {
                    let result=repository.conflict_list(&storage,workspace,&pending,*cursor).map_err(error)?;
                    let state=owner.upgrade().ok_or("notes_sync_review_changed")?;
                    state.notes_sync_runs.review_is_current(workspace,run,revision,scene,&pending)?;
                    Ok(json!({"runId":run,"revision":revision,"total":result.total,"nextCursor":result.next_cursor,"rows":result.rows}))
                },
                Request::Detail {id,..} => {
                    let result=repository.conflict_detail(&storage,workspace,&pending,id).map_err(error)?;
                    let state=owner.upgrade().ok_or("notes_sync_review_changed")?;
                    state.notes_sync_runs.review_is_current(workspace,run,revision,scene,&pending)?;
                    Ok(json!({"runId":run,"revision":revision,"item":result}))
                },
                Request::Apply {choices,locale,..} => {
                    if choices.len()>crate::notes_sync::MAX_RECORDS {return Err("notes_sync_review_invalid".into());}
                    let mut selected=BTreeMap::new();
                    for choice in choices {
                        if selected.insert(choice.id.clone(),choice.choice).is_some() {return Err("notes_sync_review_invalid".into());}
                    }
                    let lease=lease.ok_or("notes_sync_review_changed")?;
                    if !Arc::ptr_eq(&lease.pending,&pending) {return Err("notes_sync_review_changed".into());}
                    let result=repository.apply_saved_choices(&storage,workspace,&pending,&selected,*locale).map_err(error)?;
                    lease.saved();
                    Ok(json!({"runId":run,"revision":revision,"state":result.state,"copiedNotes":result.copied_notes,
                        "copiedNotebooks":result.copied_notebooks,"pendingUpload":result.pending_upload}))
                },
            }
        }).await.map_err(|_|"notes_sync_review_unavailable".to_owned())?
    }
}

#[cfg(test)]
mod tests;
