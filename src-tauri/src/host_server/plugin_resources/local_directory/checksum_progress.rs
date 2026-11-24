//! Read-only projection of an active native checksum grant.
use super::*;

const PROFILE: &str = "resource.local-directory.checksum-progress.preview1";

pub(super) struct Counts {
    total: usize,
    completed: usize,
    bytes_read: u64,
    file_size: Option<u64>,
}

impl Counts {
    fn new(total: usize) -> Self {
        Self {
            total,
            completed: 0,
            bytes_read: 0,
            file_size: None,
        }
    }

    fn report(&self, id: &str) -> Value {
        json!({
            "schemaVersion":1,"profile":PROFILE,"grantId":id,
            "filesTotal":self.total,"filesCompleted":self.completed,
            "fileBytesRead":self.bytes_read,"fileSize":self.file_size,
        })
    }
}

impl Purpose {
    pub(super) fn checksum_total(&self) -> Option<usize> {
        match self {
            Self::Checksum(entries) => Some(entries.len()),
            Self::GenerateChecksum(files) => Some(files.len()),
            Self::Metadata | Self::Usage | Self::Duplicates => None,
        }
    }
}

impl Control {
    pub(super) fn with_checksum_total(mut self, total: Option<usize>) -> Self {
        self.progress = total.map(|value| Mutex::new(Counts::new(value)));
        self
    }

    fn update_progress(&self, update: impl FnOnce(&mut Counts)) {
        if let Some(mut progress) = self.progress.as_ref().and_then(|value| value.lock().ok()) {
            update(&mut progress);
        }
    }

    pub(super) fn start_file(&self, length: u64) {
        self.update_progress(|progress| progress.file_size = Some(length));
    }

    pub(super) fn read_bytes(&self, length: u64) {
        self.update_progress(|progress| progress.bytes_read = length);
    }

    pub(super) fn finish_file(&self) {
        self.update_progress(|progress| {
            progress.completed += 1;
            progress.bytes_read = 0;
            progress.file_size = None;
        });
    }

    pub(super) fn checksum_report(&self, grant_id: &str) -> Option<Value> {
        if self.cancelled.load(Ordering::Acquire) || self.outcome.load(Ordering::Acquire) != 0 {
            return None;
        }
        Some(self.progress.as_ref()?.lock().ok()?.report(grant_id))
    }
}

impl Grants {
    pub(super) fn checksum_progress(
        &self,
        owner: &Owner,
        context: &Context,
        grant_id: &str,
    ) -> Result<Value, ApiError> {
        let unavailable = || rejected("resource_directory_grant_unavailable");
        if let Some(active) = self.active.get(grant_id) {
            if active.owner == *owner && active.context.as_ref() == Some(context) {
                return active
                    .control
                    .checksum_report(grant_id)
                    .ok_or_else(unavailable);
            }
            return Err(unavailable());
        }
        let pending = self
            .pending
            .get(grant_id)
            .filter(|grant| {
                grant.owner == *owner
                    && grant.selection.context() == Some(context)
                    && grant.expires > Instant::now()
            })
            .and_then(|grant| grant.purpose.checksum_total())
            .ok_or_else(unavailable)?;
        Ok(Counts::new(pending).report(grant_id))
    }
}
