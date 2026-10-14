//! Prepare and finish under the broker lock; execute isolated code without it.
use super::*;
use crate::plugin_registry::PluginOrigin;
use std::io::Read;

const MAX_ACTIVE_WORKERS: usize = 64;
const MAX_ACTIVE_WORKERS_PER_PLUGIN: usize = 8;

fn worker_budget_exceeded(reservations: &HashMap<String, WorkerReservation>, plugin_id: &str) -> bool {
    reservations.len() >= MAX_ACTIVE_WORKERS
        || reservations.values().filter(|entry| entry.plugin_id == plugin_id).count() >= MAX_ACTIVE_WORKERS_PER_PLUGIN
}

pub(crate) enum Dispatch {
    Complete(Result<Value, CapabilityError>),
    Worker(Box<Invocation>),
}

pub(crate) struct Invocation {
    request: CapabilityInvocation,
    capability: PluginCapabilityDescriptor,
    module_hash: String,
    epoch: (uuid::Uuid, uuid::Uuid),
    input_hash: String,
    request_hash: String,
    key: Option<String>,
    reservation_key: String,
    _reservation: Arc<()>,
    started: Instant,
    launch: Option<worker_launch::WorkerLaunch>,
}

impl Invocation {
    pub(crate) fn execute(&mut self, cancelled: &AtomicBool) -> Result<Value, CapabilityError> {
        self.launch
            .take()
            .expect("Worker job executes once")
            .run(Some(cancelled))
    }
}

impl CapabilityBroker {
    pub(crate) fn prepare_worker_invocation(
        &mut self,
        registry: &PluginRegistry,
        request: CapabilityInvocation,
        cancelled: &AtomicBool,
    ) -> Dispatch {
        // Built-in handlers can write Host data and retain their existing transaction path.
        let external = registry.list(&request.scene_id).iter().any(|plugin| {
            plugin.manifest.id == request.plugin_id && plugin.origin != PluginOrigin::BuiltIn
        });
        let key = request
            .idempotency_scope
            .as_ref()
            .zip(request.tool_call_id.as_ref())
            .map(|pair| serde_json::to_string(&pair).expect("String tuple is serializable"));
        self.worker_reservations
            .retain(|_, entry| entry.lease.strong_count() > 0);
        if !external
            || key.as_ref().is_some_and(|key| {
                self.idempotency.contains_key(key) || self.worker_reservations.contains_key(key)
            })
        {
            return Dispatch::Complete(self.invoke_cancellable(registry, request, Some(cancelled)));
        }
        let started = Instant::now();
        let input = match serde_json::to_vec(&request.input) {
            Ok(input) => input,
            Err(_) => {
                return Dispatch::Complete(Err(CapabilityError::new(
                    "invalid_parameters",
                    "Capability input is not serializable",
                )))
            }
        };
        let input_hash = hex_sha256(&input);
        let request_hash = hex_sha256(
            &serde_json::to_vec(&json!([
                request.caller,
                request.scene_id,
                request.workspace_id,
                request.plugin_id,
                request.capability_id,
                input_hash,
            ]))
            .expect("String tuple is serializable"),
        );
        let prepared = (|| {
            if cancelled.load(Ordering::Acquire) {
                return Err(CapabilityError::new(
                    "worker_cancelled",
                    "Plugin call cancelled before execution",
                ));
            }
            if input.len() > MAX_CAPABILITY_INPUT_BYTES {
                return Err(CapabilityError::new(
                    "payload_too_large",
                    "Capability input is too large",
                ));
            }
            if worker_budget_exceeded(&self.worker_reservations, &request.plugin_id) {
                return Err(CapabilityError::new(
                    "plugin_call_budget_exceeded",
                    "Too many active plugin Workers",
                ));
            }
            let capability = self.current_capability(registry, &request)?;
            validate_value(&capability.input_schema, &request.input, "$")?;
            let module_hash = module_hash(registry, &request)?;
            let launch = worker_launch::WorkerLaunch::prepare(
                self,
                registry,
                &request.scene_id,
                &request.plugin_id,
                json!({"capabilityId":request.capability_id}),
                request.input.clone(),
            )?;
            Ok((capability, module_hash, launch))
        })();
        match prepared {
            Ok((capability, module_hash, launch)) => {
                let reservation = Arc::new(());
                let reservation_key = key
                    .clone()
                    .unwrap_or_else(|| format!("unkeyed:{}", uuid::Uuid::new_v4()));
                self.worker_reservations.insert(reservation_key.clone(), WorkerReservation {
                    plugin_id: request.plugin_id.clone(),
                    lease: Arc::downgrade(&reservation),
                });
                let epoch = registry.execution_revision(&request.scene_id, &request.plugin_id);
                Dispatch::Worker(Box::new(Invocation {
                    request,
                    capability,
                    module_hash,
                    epoch,
                    input_hash,
                    request_hash,
                    key,
                    reservation_key,
                    _reservation: reservation,
                    started,
                    launch: Some(launch),
                }))
            }
            Err(error) => {
                self.audit_detached(&request, &input_hash, started, &Err(error.clone()));
                Dispatch::Complete(Err(error))
            }
        }
    }

    pub(crate) fn finish_worker_invocation(
        &mut self,
        registry: &PluginRegistry,
        job: Invocation,
        outcome: Result<Value, CapabilityError>,
        cancelled: &AtomicBool,
    ) -> Result<Value, CapabilityError> {
        self.worker_reservations.remove(&job.reservation_key);
        let outcome = outcome.and_then(|result| {
            if cancelled.load(Ordering::Acquire) {
                return Err(CapabilityError::new(
                    "worker_cancelled",
                    "Plugin call was cancelled",
                ));
            }
            let current = self.current_capability(registry, &job.request)?;
            if registry.execution_revision(&job.request.scene_id, &job.request.plugin_id) != job.epoch
                || serde_json::to_value(&current).ok() != serde_json::to_value(&job.capability).ok()
                || module_hash(registry, &job.request)? != job.module_hash
            {
                return Err(CapabilityError::new(
                    "capability_changed",
                    "Plugin changed during execution; reload its tools",
                ));
            }
            let bytes = serde_json::to_vec(&result).map_err(|_| {
                CapabilityError::new(
                    "serialization_failed",
                    "Capability result is not serializable",
                )
            })?;
            if bytes.len() > MAX_CAPABILITY_OUTPUT_BYTES {
                return Err(CapabilityError::new(
                    "result_too_large",
                    "Capability output exceeds 1 MiB",
                ));
            }
            output_contract::validate_result(&current, &result)?;
            Ok(result)
        });
        if let (Ok(result), Some(key)) = (&outcome, &job.key) {
            self.insert_idempotency(
                key.clone(),
                CachedInvocation {
                    request_hash: job.request_hash.clone(),
                    authority: cache_authority::Authority::new(job.epoch, &job.capability, Some(job.module_hash.clone())),
                    result: result.clone(),
                },
            );
        }
        self.audit_detached(&job.request, &job.input_hash, job.started, &outcome);
        outcome
    }

    fn audit_detached(
        &self,
        request: &CapabilityInvocation,
        input_hash: &str,
        started: Instant,
        outcome: &Result<Value, CapabilityError>,
    ) {
        self.write_audit(AuditRecord {
            timestamp_ms: now_millis(),
            caller: &request.caller,
            scene_id: &request.scene_id,
            plugin_id: &request.plugin_id,
            capability_id: &request.capability_id,
            tool_call_id: request.tool_call_id.as_deref(),
            input_hash,
            duration_ms: started.elapsed().as_millis(),
            ok: outcome.is_ok(),
            error_code: outcome.as_ref().err().map(|error| error.code),
        });
    }
}

pub(super) fn module_hash(
    registry: &PluginRegistry,
    request: &CapabilityInvocation,
) -> Result<String, CapabilityError> {
    let (path, _) = registry
        .plugin_runtime_entry(&request.scene_id, &request.plugin_id)
        .map_err(|error| CapabilityError::new("plugin_not_active", error))?;
    let file = fs::File::open(path)
        .map_err(|_| CapabilityError::new("plugin_not_active", "Cannot read Worker module"))?;
    let mut bytes = Vec::new();
    file.take(2 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| CapabilityError::new("plugin_not_active", "Cannot read Worker module"))?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err(CapabilityError::new(
            "plugin_not_active",
            "Worker module exceeds 2 MiB",
        ));
    }
    Ok(hex_sha256(&bytes))
}

#[cfg(test)]
#[path = "plugin_detached_worker_tests.rs"]
mod tests;
