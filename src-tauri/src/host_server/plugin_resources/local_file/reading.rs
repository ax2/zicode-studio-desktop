//! Cooperative boundaries; a pending OS read is not forcibly interrupted.
use super::*;
use std::io::Read;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

pub(super) struct Control {
    cancelled: AtomicBool,
    deadline: Instant,
    outcome: AtomicU8,
}

impl Control {
    pub(super) fn new(expires: Instant) -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            deadline: expires.min(Instant::now() + Duration::from_secs(30)),
            outcome: AtomicU8::new(0),
        }
    }

    pub(super) fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub(super) fn check(&self) -> Result<(), ApiError> {
        if self.cancelled.load(Ordering::Acquire) {
            self.outcome.store(2, Ordering::Release);
            return Err(rejected("resource_file_read_cancelled"));
        }
        if Instant::now() >= self.deadline {
            self.outcome.store(3, Ordering::Release);
            return Err(rejected("resource_file_read_timeout"));
        }
        Ok(())
    }

    pub(super) fn published(&self) {
        self.outcome.store(1, Ordering::Release);
    }
    pub(super) fn outcome(&self) -> &'static str {
        match self.outcome.load(Ordering::Acquire) {
            1 => "published",
            2 => "cancelled",
            3 => "timedOut",
            _ => "failed",
        }
    }
    pub(super) fn cancellation_requested(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}

pub(super) struct Active {
    pub(super) owner: Owner,
    pub(super) control: Arc<Control>,
}

/// The actual blocking worker owns cleanup even if its HTTP waiter disappears.
pub(super) struct Lease {
    pub(super) state: Arc<HostState>,
    pub(super) id: String,
}

impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut store) = self.state.plugin_resources.lock() {
            store.file_imports.finish(&self.id);
        }
    }
}

pub(super) fn read(
    reader: &mut impl Read,
    length: usize,
    control: &Control,
) -> Result<Vec<u8>, ApiError> {
    control.check()?;
    if length > MAX_BYTES {
        return Err(rejected("resource_budget_exceeded"));
    }
    let mut bytes = Vec::with_capacity(length);
    let mut chunk = [0u8; MAX_CHUNK];
    loop {
        control.check()?;
        let read = match reader.read(&mut chunk) {
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            result => result.map_err(|_| rejected("resource_file_unavailable"))?,
        };
        control.check()?;
        if read == 0 {
            break;
        }
        if bytes.len().saturating_add(read) > MAX_BYTES {
            return Err(rejected("resource_budget_exceeded"));
        }
        bytes.extend_from_slice(&chunk[..read]);
    }
    if bytes.len() != length {
        return Err(rejected("resource_file_changed"));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests;
