use super::*;
use std::process::Command;

pub(super) struct WorkerLaunch {
    command: Command,
    request: Vec<u8>,
    #[cfg(test)]
    observer: Option<WorkerObserver>,
}
impl WorkerLaunch {
    pub(super) fn prepare(
        broker: &CapabilityBroker,
        registry: &PluginRegistry,
        scene_id: &str,
        plugin_id: &str,
        handler: Value,
        input: Value,
    ) -> Result<Self, CapabilityError> {
        #[cfg(not(test))]
        let _ = broker;
        let (worker_path, worker_kind) = registry
            .plugin_runtime_entry(scene_id, plugin_id)
            .map_err(|error| CapabilityError::new("plugin_not_active", error))?;
        let executable = std::env::current_exe().map_err(|error| {
            CapabilityError::new(
                "plugin_not_active",
                format!("Cannot locate plugin worker executable: {error}"),
            )
        })?;
        // Integration tests use the delivered app, whose entry point understands
        // --zicode-plugin-worker; production always launches its own executable.
        #[cfg(test)]
        let executable = broker.worker_executable.as_ref().unwrap_or(&executable);
        let mut command = crate::process_command::new_command(executable);
        command
            .arg("--zicode-plugin-worker")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut request = json!({
            "workerPath": worker_path,
            "workerKind": worker_kind,
            "pluginId": plugin_id,
            "sceneId": scene_id,
            "input": input,
        });
        if let (Some(request), Some(handler)) = (request.as_object_mut(), handler.as_object()) {
            request.extend(handler.clone());
        }
        let request = serde_json::to_vec(&request).map_err(|_| {
            CapabilityError::new("worker_protocol_error", "Cannot encode Worker request")
        })?;
        if request.len() > 256 * 1024 {
            return Err(CapabilityError::new(
                "input_too_large",
                "Worker request exceeds 256 KiB",
            ));
        }
        Ok(Self {
            command,
            request,
            #[cfg(test)]
            observer: broker.worker_observer.clone(),
        })
    }
    pub(super) fn run(self, cancelled: Option<&AtomicBool>) -> Result<Value, CapabilityError> {
        #[cfg(test)]
        let observer = self
            .observer
            .as_deref()
            .map(|observer| observer as &dyn Fn(&'static str, u32));
        #[cfg(not(test))]
        let observer = None;
        let (status, output) = worker_process::run_observed(
            self.command,
            self.request,
            WORKER_TIMEOUT,
            MAX_CAPABILITY_OUTPUT_BYTES + 64 * 1024,
            cancelled,
            observer,
        )
        .map_err(|error| CapabilityError::new(error.code, error.message))?;
        let response: WorkerProcessResponse = serde_json::from_slice(&output).map_err(|_| {
            CapabilityError::new(
                "worker_protocol_error",
                "Plugin Worker returned an invalid response",
            )
        })?;
        if !status.success() || !response.ok {
            let (code, message) = crate::plugin_worker::failures::public(response.error.as_deref());
            return Err(CapabilityError::new(code, message));
        }
        response.result.ok_or_else(|| {
            CapabilityError::new("worker_protocol_error", "Plugin Worker result is missing")
        })
    }
}
