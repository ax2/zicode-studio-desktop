//! Host-issued one-use calls. Missing/expired handles cannot be admitted later.
use super::*;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;

const PROFILE: &str = "resource.call.admission.draft1";
const PREFIX: &str = "resource-call-";
const CAPACITY: usize = 128;
const PER_RUNTIME: usize = 32;
const RETENTION: Duration = Duration::from_secs(60);
type Key = (String, String, String);

#[derive(PartialEq)]
enum Phase { Prepared, Active, Finished, Sealed }
struct Entry {
    fingerprint: String,
    phase: Phase,
    flag: Arc<AtomicBool>,
    changed: Instant,
}
#[derive(Clone, Default)]
pub(super) struct Calls(Arc<Mutex<HashMap<Key, Entry>>>);
pub(super) struct Lease { calls: Calls, key: Key, pub flag: Arc<AtomicBool> }

impl Calls {
    fn prune(entries: &mut HashMap<Key, Entry>) {
        entries.retain(|_, e| e.phase == Phase::Active || e.changed.elapsed() < RETENTION);
    }
    fn prepare(&self, key: Key, fingerprint: String) -> Result<(), &'static str> {
        let mut entries = self.0.lock().map_err(|_| "resource_calls_unavailable")?;
        Self::prune(&mut entries);
        if entries.contains_key(&key) { return Err("resource_call_used"); }
        let scoped = entries.keys().filter(|k| k.0 == key.0).count() >= PER_RUNTIME;
        if scoped || entries.len() >= CAPACITY {
            let victim = entries.iter().filter(|(k,e)| matches!(e.phase, Phase::Finished | Phase::Sealed) && (!scoped || k.0 == key.0))
                .min_by_key(|(_,e)| e.changed).map(|(k,_)| k.clone());
            if let Some(victim) = victim { entries.remove(&victim); }
            else { return Err("resource_call_budget_exceeded"); }
        }
        entries.insert(key, Entry { fingerprint, phase: Phase::Prepared,
            flag: Arc::new(AtomicBool::new(false)), changed: Instant::now() });
        Ok(())
    }
    pub(super) fn begin(&self, key: Key, fingerprint: &str) -> Result<Lease, &'static str> {
        let mut entries = self.0.lock().map_err(|_| "resource_calls_unavailable")?;
        Self::prune(&mut entries);
        let entry = entries.get_mut(&key).ok_or("resource_call_not_admissible")?;
        if entry.fingerprint != fingerprint { return Err("resource_call_changed"); }
        if entry.phase != Phase::Prepared { return Err("resource_call_used"); }
        entry.phase = Phase::Active;
        entry.changed = Instant::now();
        Ok(Lease { calls: self.clone(), key, flag: entry.flag.clone() })
    }
    fn reconcile(&self, key: &Key) -> Result<(&'static str, bool), &'static str> {
        let mut entries = self.0.lock().map_err(|_| "resource_calls_unavailable")?;
        Self::prune(&mut entries);
        let Some(entry) = entries.get_mut(key) else {
            // prepare never accepts a client ID; a missing handle cannot be recreated.
            return Ok(("not_admissible", true));
        };
        match entry.phase {
            Phase::Prepared => {
                entry.phase = Phase::Sealed; entry.flag.store(true, Ordering::Release);
                entry.changed = Instant::now(); Ok(("not_started", true))
            }
            Phase::Active => { entry.flag.store(true, Ordering::Release); Ok(("active", false)) }
            Phase::Finished => Ok(("ended", true)),
            Phase::Sealed => Ok(("not_started", true)),
        }
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut entries) = self.calls.0.lock() {
            if let Some(entry) = entries.get_mut(&self.key) {
                entry.phase = Phase::Finished; entry.changed = Instant::now();
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct Prepare {
    schema_version: u32, access: Access, input: Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct Reconcile {
    schema_version: u32, owner: Owner, call_id: String, host_instance_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct InvokeCall {
    access: Access, call_id: String, host_instance_id: String, input: Value,
}
fn fingerprint(access: &Access, input: &Value) -> String {
    sha256_hex(&serde_json::to_vec(&json!([access, input])).expect("JSON is serializable"))
}
pub(super) fn key(state: &HostState, owner: &Owner, id: &str) -> Result<Key, ApiError> {
    let uuid = id.strip_prefix(PREFIX).ok_or_else(|| rejected("resource_call_invalid"))?;
    let (target, hashed) = call_scope(state, owner, uuid)?;
    Ok((target.instance_id, target.session_id, hashed))
}
fn instance(state: &HostState, id: &str) -> Result<(), ApiError> {
    if uuid::Uuid::parse_str(id).is_err() { return Err(rejected("resource_call_invalid")); }
    if id != state.plugin_resource_workers.instance_id { return Err(rejected("resource_call_host_changed")); }
    Ok(())
}
pub(in crate::host_server) async fn prepare(
    State(state): State<Arc<HostState>>, headers: HeaderMap, Json(request): Json<Prepare>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    if request.schema_version != 1 { return Err(rejected("resource_schema_unsupported")); }
    validate(&request.access)?;
    let id = format!("{PREFIX}{}", uuid::Uuid::new_v4());
    let key = key(&state, &request.access.owner, &id)?;
    state.plugin_resource_workers.admissions.prepare(key, fingerprint(&request.access, &request.input)).map_err(rejected)?;
    Ok(Json(json!({"schemaVersion":1,"profile":PROFILE,"callId":id,
        "owner":request.access.owner,"hostInstanceId":state.plugin_resource_workers.instance_id,
        "phase":"prepared","expiresInSeconds":60,"persistent":false})))
}
pub(in crate::host_server) async fn reconcile(
    State(state): State<Arc<HostState>>, headers: HeaderMap, Json(request): Json<Reconcile>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    if request.schema_version != 1 { return Err(rejected("resource_schema_unsupported")); }
    instance(&state, &request.host_instance_id)?;
    let key = key(&state, &request.owner, &request.call_id)?;
    let (phase, finished) = state.plugin_resource_workers.admissions.reconcile(&key).map_err(rejected)?;
    Ok(Json(json!({"schemaVersion":1,"profile":PROFILE,"callId":request.call_id,
        "owner":request.owner,"hostInstanceId":request.host_instance_id,"phase":phase,
        "executionFinished":finished,"admissionClosed":true,"persistent":false,"resultAvailable":false})))
}
pub(in crate::host_server) async fn invoke(
    State(state): State<Arc<HostState>>, headers: HeaderMap, Json(request): Json<InvokeCall>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    instance(&state, &request.host_instance_id)?;
    invoke_request(state, headers, Invoke { access:request.access, tool_call_id:request.call_id,
        input:request.input, host_instance_id:Some(request.host_instance_id) }, true).await
}
pub(super) fn begin(state: &HostState, request: &Invoke) -> Result<Lease, ApiError> {
    state.plugin_resource_workers.admissions.begin(key(state, &request.access.owner, &request.tool_call_id)?,
        &fingerprint(&request.access, &request.input)).map_err(rejected)
}

#[cfg(test)]
mod tests;
