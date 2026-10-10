//! Acceptance-only event recording; never compiled into the production Host.
use crate::plugin_capabilities::CapabilityBroker;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::{Arc, Mutex};

pub(super) fn attach(broker: &mut CapabilityBroker) -> Result<(), String> {
    let Some(path) = std::env::var_os("ZICODE_TEST_WORKER_EVENT_LOG") else {
        return Ok(());
    };
    // Preserve previous evidence rather than truncating a log on an accidental rerun.
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("Cannot create Worker acceptance event log: {error}"))?;
    let file = Arc::new(Mutex::new(file));
    let started = std::time::Instant::now();
    broker.worker_observer = Some(Arc::new(move |event, pid| {
        let mut bytes = serde_json::to_vec(&serde_json::json!({"event":event,"pid":pid,
            "elapsedUs":started.elapsed().as_micros()}))
        .expect("Event metadata is serializable");
        bytes.push(b'\n');
        if let Ok(mut file) = file.lock() {
            let _ = file.write_all(&bytes);
        }
    }));
    Ok(())
}
