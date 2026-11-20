//! Shared saved connection resolution for explicit sync and conflict review.
use super::*;
use crate::notes_sync::{repository::SyncRepository, SyncError};

pub(super) struct Context {
    pub root: PathBuf,
    pub test_name: Option<String>,
    pub workspace: String,
    pub scene: String,
    pub revision: String,
    pub enabled: bool,
}
pub(super) fn resolve(
    state: &Arc<HostState>,
    context: Context,
) -> tokio::task::JoinHandle<Result<SyncRepository, String>> {
    let owner = Arc::downgrade(state);
    state.lifecycle.blocking(move || {
        let repository = crate::notes_sync_settings::resolve_for_sync(
            &context.root,
            context.test_name.as_deref(),
            &context.workspace,
            context.enabled,
            &context.revision,
        )
        .map_err(str::to_owned)?;
        Ok(repository.with_guard(move || {
            let state = owner.upgrade().ok_or(SyncError::Cancelled)?;
            if state.lifecycle.stopping() {
                return Err(SyncError::Cancelled);
            }
            ensure_notes_authorized(&state, &context.scene, true)
                .map_err(|_| SyncError::ConfigurationChanged)?;
            let gate = state
                .workspace_write_gates
                .gate(&context.workspace)
                .map_err(|_| SyncError::ConfigurationChanged)?;
            if *gate.lock().map_err(|_| SyncError::ConfigurationChanged)? {
                return Err(SyncError::ConfigurationChanged);
            }
            let lease = crate::notes_sync_settings::lock_current_config(
                &context.root,
                context.test_name.as_deref(),
                &context.workspace,
                &context.revision,
            )
            .map_err(|_| SyncError::ConfigurationChanged)?;
            Ok(Box::new(lease) as Box<dyn Send>)
        }))
    })
}
