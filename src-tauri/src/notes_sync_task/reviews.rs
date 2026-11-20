use super::state::{Record, Registry, Runs};
use crate::notes_sync::PendingMerge;
use std::sync::{Arc, Mutex, Weak};

#[derive(Clone)]
pub(crate) struct ReviewContext {
    pub scene: String,
    pub revision: String,
}
pub(crate) struct ApplyLease {
    record: Arc<Mutex<Record>>,
    registry: Weak<Registry>,
    pub pending: Arc<PendingMerge>,
    saved: bool,
}
fn validate(record: &Record, run: &str, revision: &str, scene: &str) -> Result<(), String> {
    if record.status.run_id.as_deref() != Some(run)
        || record.status.state != "conflicts"
        || !record
            .context
            .as_ref()
            .is_some_and(|context| context.revision == revision && context.scene == scene)
    {
        return Err("notes_sync_review_changed".into());
    }
    if record.status.running || record.resolving {
        return Err("notes_sync_review_busy".into());
    }
    if record.pending.is_none() {
        return Err(record.review_error.into());
    }
    Ok(())
}
impl Runs {
    pub(crate) fn review(
        &self,
        workspace: &str,
        run: &str,
        revision: &str,
        scene: &str,
    ) -> Result<Arc<PendingMerge>, String> {
        let records = self.0.lock().map_err(|_| "notes_sync_review_unavailable")?;
        let record = records
            .get(workspace)
            .ok_or("notes_sync_review_expired")?
            .lock()
            .map_err(|_| "notes_sync_review_unavailable")?;
        validate(&record, run, revision, scene)?;
        record
            .pending
            .clone()
            .ok_or_else(|| record.review_error.into())
    }
    pub(crate) fn review_is_current(
        &self,
        workspace: &str,
        run: &str,
        revision: &str,
        scene: &str,
        pending: &Arc<PendingMerge>,
    ) -> Result<(), String> {
        let current = self.review(workspace, run, revision, scene)?;
        if !Arc::ptr_eq(&current, pending) {
            return Err("notes_sync_review_changed".into());
        }
        Ok(())
    }
    pub(crate) fn reserve_review(
        &self,
        workspace: &str,
        run: &str,
        revision: &str,
        scene: &str,
    ) -> Result<ApplyLease, String> {
        let records = self.0.lock().map_err(|_| "notes_sync_review_unavailable")?;
        let record = records
            .get(workspace)
            .ok_or("notes_sync_review_expired")?
            .clone();
        let pending = {
            let mut entry = record.lock().map_err(|_| "notes_sync_review_unavailable")?;
            validate(&entry, run, revision, scene)?;
            let pending = entry.pending.clone().ok_or("notes_sync_review_expired")?;
            entry.resolving = true;
            pending
        };
        Ok(ApplyLease {
            record,
            registry: Arc::downgrade(&self.0),
            pending,
            saved: false,
        })
    }
}
impl ApplyLease {
    pub(crate) fn saved(mut self) {
        self.saved = true;
    }
}
impl Drop for ApplyLease {
    fn drop(&mut self) {
        let registry = self.registry.upgrade();
        let _records = registry.as_ref().and_then(|registry| registry.lock().ok());
        if let Ok(mut record) = self.record.lock() {
            record.resolving = false;
            if self.saved {
                record.pending = None;
                record.status.conflicts_available = false;
                record.status.state = "resolvedLocally".into();
                record.status.conflict_count = 0;
            }
        }
    }
}
