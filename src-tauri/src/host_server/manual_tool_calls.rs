//! Host-issued, single-use desktop call handles. No inputs or results are retained.
use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

mod http;
pub(super) use http::{cancel, prepare, protocol, reconcile, status};
const CAPACITY: usize = 128;
const ACTIVE_LIMIT: usize = 16;
const RETENTION: Duration = Duration::from_secs(60);
type ApiError = (StatusCode, Json<Value>);

#[derive(Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Scope {
    scene_id: String,
    workspace_id: String,
    plugin_id: String,
    capability_id: String,
}
impl Scope {
    fn from_request(request: &CapabilityInvokeRequest) -> Self {
        Self {
            scene_id: request.scene_id.clone(),
            workspace_id: request.workspace_id.clone(),
            plugin_id: request.plugin_id.clone(),
            capability_id: request.capability_id.clone(),
        }
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Prepared,
    Active,
    Finished,
}
struct Entry {
    scope: Scope,
    fingerprint: String,
    flag: Arc<AtomicBool>,
    phase: Phase,
    changed: Instant,
    outcome: Option<String>,
}
#[derive(Clone)]
pub(super) struct Calls(Arc<Mutex<HashMap<String, Entry>>>, Arc<String>);
impl Default for Calls {
    fn default() -> Self {
        Self(Arc::default(), Arc::new(uuid::Uuid::new_v4().to_string()))
    }
}
pub(super) struct Lease {
    calls: Calls,
    id: String,
    pub flag: Arc<AtomicBool>,
}
fn rejected(code: &'static str) -> ApiError {
    plugin_api_error(
        StatusCode::CONFLICT,
        code,
        "Reload or start a new tool call",
    )
}
fn fingerprint(request: &CapabilityInvokeRequest) -> String {
    sha256_hex(
        &serde_json::to_vec(&json!([
            request.scene_id,
            request.workspace_id,
            request.plugin_id,
            request.capability_id,
            request.catalog_revision,
            request.input,
            request.capture_result
        ]))
        .expect("JSON value is serializable"),
    )
}
impl Calls {
    pub(super) fn invalidate_workspace(&self, workspace_id: &str) {
        if let Ok(mut entries) = self.0.lock() {
            for entry in entries.values_mut() {
                if entry.scope.workspace_id == workspace_id {
                    entry.flag.store(true, Ordering::Release);
                    if entry.phase == Phase::Prepared {
                        entry.phase = Phase::Finished;
                        entry.changed = Instant::now();
                        entry.outcome = Some("manual_call_not_started".into());
                    }
                }
            }
        }
    }

    // Active leases never expire. Under the same lock as begin, seal prepared handles
    // or prove an absent handle cannot start. An instance mismatch proves nothing.
    fn reconcile(&self, scope: &Scope, id: &str, instance_id: &str) -> Result<Value, ApiError> {
        if instance_id != self.1.as_str() {
            return Err(rejected("manual_call_host_changed"));
        }
        let mut entries = self.entries()?;
        let (finished, outcome) = if let Some(entry) = entries.get_mut(id) {
            if &entry.scope != scope {
                return Err(rejected("manual_call_unavailable"));
            }
            match entry.phase {
                Phase::Active => {
                    entry.flag.store(true, Ordering::Release);
                    (false, None)
                }
                Phase::Prepared => {
                    entry.phase = Phase::Finished;
                    entry.changed = Instant::now();
                    entry.outcome = Some("manual_call_not_started".into());
                    (true, entry.outcome.clone())
                }
                Phase::Finished => (true, entry.outcome.clone()),
            }
        } else {
            (true, Some("manual_call_retired".into()))
        };
        Ok(
            json!({"schemaVersion":1,"profile":"manual.tool.reconcile.v1",
            "hostInstanceId":self.1.as_str(),"callId":id,"executionFinished":finished,
            "status":if finished {"finished"} else {"cancel_requested"},"outcome":outcome}),
        )
    }
    fn entries(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, Entry>>, ApiError> {
        let mut entries = self
            .0
            .lock()
            .map_err(|_| rejected("manual_calls_unavailable"))?;
        entries
            .retain(|_, entry| entry.phase == Phase::Active || entry.changed.elapsed() < RETENTION);
        Ok(entries)
    }
    fn prepare(&self, request: &CapabilityInvokeRequest) -> Result<String, ApiError> {
        let mut entries = self.entries()?;
        if entries.len() >= CAPACITY {
            return Err(rejected("manual_call_budget_exceeded"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        entries.insert(
            id.clone(),
            Entry {
                scope: Scope::from_request(request),
                fingerprint: fingerprint(request),
                flag: Arc::new(AtomicBool::new(false)),
                phase: Phase::Prepared,
                changed: Instant::now(),
                outcome: None,
            },
        );
        Ok(id)
    }
    pub fn begin(&self, request: &CapabilityInvokeRequest) -> Result<Lease, ApiError> {
        let id = request
            .call_id
            .as_deref()
            .ok_or_else(|| rejected("manual_call_invalid"))?;
        let mut entries = self.entries()?;
        let entry = entries
            .get(id)
            .filter(|entry| {
                entry.scope == Scope::from_request(request)
                    && entry.fingerprint == fingerprint(request)
            })
            .ok_or_else(|| rejected("manual_call_unavailable"))?;
        if entry.phase != Phase::Prepared {
            return Err(rejected("manual_call_already_started"));
        }
        if entries
            .values()
            .filter(|entry| entry.phase == Phase::Active)
            .count()
            >= ACTIVE_LIMIT
        {
            return Err(rejected("manual_call_budget_exceeded"));
        }
        let entry = entries.get_mut(id).expect("entry was checked");
        entry.phase = Phase::Active;
        entry.changed = Instant::now();
        Ok(Lease {
            calls: self.clone(),
            id: id.to_owned(),
            flag: entry.flag.clone(),
        })
    }
    fn inspect(&self, scope: &Scope, id: &str, cancel: bool) -> Result<Value, ApiError> {
        let mut entries = self.entries()?;
        let entry = entries
            .get_mut(id)
            .filter(|entry| &entry.scope == scope)
            .ok_or_else(|| rejected("manual_call_unavailable"))?;
        if cancel && entry.phase != Phase::Finished {
            entry.flag.store(true, Ordering::Release);
        }
        let status = if entry.phase == Phase::Finished {
            "finished"
        } else if entry.flag.load(Ordering::Acquire) {
            "cancel_requested"
        } else if entry.phase == Phase::Active {
            "running"
        } else {
            "prepared"
        };
        Ok(
            json!({"schemaVersion":1,"profile":"manual.tool.call.v1","status":status,
            "executionFinished":entry.phase == Phase::Finished,"outcome":entry.outcome}),
        )
    }
}
impl Lease {
    pub fn finish(&self, result: &Result<Json<Value>, ApiError>) {
        if let Ok(mut entries) = self.calls.0.lock() {
            if let Some(entry) = entries.get_mut(&self.id) {
                entry.outcome = Some(match result {
                    Ok(_) => "completed".to_owned(),
                    Err((_, body)) => body.0["error"]["code"]
                        .as_str()
                        .unwrap_or("plugin_execution_failed")
                        .to_owned(),
                });
            }
        }
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut entries) = self.calls.0.lock() {
            if let Some(entry) = entries.get_mut(&self.id) {
                entry.phase = Phase::Finished;
                entry.changed = Instant::now();
                entry
                    .outcome
                    .get_or_insert_with(|| "plugin_execution_abandoned".to_owned());
            }
        }
    }
}

#[cfg(test)]
mod native_tests;
#[cfg(test)]
mod tests;
