//! Trusted-parent resource computation candidate. No client paths or write authority.
use super::*;
use crate::plugin_capabilities::{validate_value, worker_process};
use std::collections::VecDeque;
use std::process::Stdio;
use std::sync::atomic::Ordering;

const PROFILE: &str = "resource.wasi.input.draft2";
const WORKERS: usize = 3;
pub(in crate::host_server) mod admission;
mod host_image;
mod host_ocr;
mod host_text;
mod lifecycle;
mod output;
mod slots;
struct Execution {
    result: Value,
    resources: Option<Value>,
}
type Observer = Arc<dyn Fn(&'static str, u32) + Send + Sync>;
pub(crate) struct Workers {
    admissions: admission::Calls,
    instance_id: String,
    slots: Arc<tokio::sync::Semaphore>,
    plugin_slots: slots::PluginSlots,
    image_profile_slots: Arc<tokio::sync::Semaphore>,
    image_profile_plugin_slots: slots::PluginSlots,
    events: Mutex<VecDeque<Value>>,
    #[cfg(test)]
    pub(super) executable: Mutex<Option<PathBuf>>,
    #[cfg(test)]
    pub(super) observer: Mutex<Option<Observer>>,
}
impl Default for Workers {
    fn default() -> Self {
        Self {
            admissions: admission::Calls::default(),
            instance_id: uuid::Uuid::new_v4().to_string(),
            slots: Arc::new(tokio::sync::Semaphore::new(WORKERS)),
            plugin_slots: slots::PluginSlots::default(),
            image_profile_slots: Arc::new(tokio::sync::Semaphore::new(
                crate::plugin_resource_execution::IMAGE_RESIZE_MAX_CALLS,
            )),
            image_profile_plugin_slots: slots::PluginSlots::default(),
            events: Mutex::new(VecDeque::new()),
            #[cfg(test)]
            executable: Mutex::new(None),
            #[cfg(test)]
            observer: Mutex::new(None),
        }
    }
}

impl Workers {
    pub(in crate::host_server) fn invalidate_runtime(&self, runtime_id: &str) {
        self.admissions.invalidate_runtime(runtime_id);
    }

    fn record(&self, event: Value) {
        if let Ok(mut records) = self.events.lock() {
            if records.len() >= 128 {
                records.pop_front();
            }
            records.push_back(event);
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct Invoke {
    access: Access,
    #[serde(skip)]
    additional_accesses: Vec<Access>,
    tool_call_id: String,
    input: Value,
    #[serde(default)]
    host_instance_id: Option<String>,
}
impl Invoke {
    fn accesses(&self) -> impl Iterator<Item = &Access> {
        std::iter::once(&self.access).chain(self.additional_accesses.iter())
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct Cancel {
    schema_version: u32,
    owner: Owner,
    tool_call_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct Status {
    schema_version: u32,
    owner: Owner,
    tool_call_id: String,
    #[serde(default)]
    host_instance_id: Option<String>,
}

// Desktop-only evidence about execution lifetime. It grants no resource reads,
// cancellation, replay, result recovery, or proof of successful completion.
pub(in crate::host_server) async fn status(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<Status>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    if request.schema_version != 1 {
        return Err(rejected("resource_schema_unsupported"));
    }
    if request
        .host_instance_id
        .as_ref()
        .is_some_and(|id| uuid::Uuid::parse_str(id).is_err())
    {
        return Err(rejected("resource_call_invalid"));
    }
    let instance = &state.plugin_resource_workers.instance_id;
    if request
        .host_instance_id
        .as_ref()
        .is_some_and(|id| id != instance)
    {
        return Err(rejected("resource_call_host_changed"));
    }
    // Permit observation after resource/permission revocation just as cancellation
    // does, while requiring the exact current runtime/session and desktop identity.
    let (target, key) = call_scope(&state, &request.owner, &request.tool_call_id)?;
    let (phase, finished, cancelled) = state
        .plugin_calls
        .snapshot(&target.instance_id, &target.session_id, &key)
        .map_err(rejected)?;
    Ok(Json(
        json!({"schemaVersion":1,"profile":"resource.call.status.draft1",
        "hostInstanceId":instance,"toolCallId":request.tool_call_id,"owner":request.owner,
        "phase":phase,"executionFinished":finished,"cancellationRequested":cancelled,
        "persistent":false,"retentionSeconds":60,"resultAvailable":false}),
    ))
}

fn call_scope(
    state: &HostState,
    owner: &Owner,
    call: &str,
) -> Result<(RuntimeTarget, String), ApiError> {
    if uuid::Uuid::parse_str(call).is_err()
        || owner.plugin_id.len() > 128
        || owner.capability_id.len() > 128
    {
        return Err(rejected("resource_call_invalid"));
    }
    let current = state
        .runtimes
        .statuses()
        .map_err(|_| rejected("runtime_unavailable"))?
        .into_iter()
        .find(|s| {
            s.target.instance_id == owner.runtime_id && s.target.session_id == owner.session_id
        })
        .map(|s| s.target)
        .ok_or_else(|| rejected("runtime_stopped"))?;
    let target = state
        .runtimes
        .broker_call_target(&current)
        .ok_or_else(|| rejected("runtime_stopped"))?;
    // Hash the full tuple to avoid delimiter collisions and logging arbitrary client strings.
    let key = sha256_hex(
        &serde_json::to_vec(&json!([
            "resource",
            owner.plugin_id,
            owner.capability_id,
            call
        ]))
        .unwrap(),
    );
    Ok((target, key))
}

pub(in crate::host_server) async fn cancel(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<Cancel>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    if request.schema_version != 1 {
        return Err(rejected("resource_schema_unsupported"));
    }
    // Permit cancellation after the resource/permission was revoked; never grant new reads.
    let (target, key) = call_scope(&state, &request.owner, &request.tool_call_id)?;
    let (status, finished) = state
        .plugin_calls
        .cancel(&target.instance_id, &target.session_id, &key)
        .map_err(rejected)?;
    Ok(Json(
        json!({"schemaVersion":1,"status":status,"executionFinished":finished}),
    ))
}

pub(in crate::host_server) async fn audit(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    let events = state
        .plugin_resource_workers
        .events
        .lock()
        .map_err(|_| rejected("resource_audit_unavailable"))?;
    Ok(Json(
        json!({"schemaVersion":1,"persistent":false,"maxRecords":128,"records":events.iter().collect::<Vec<_>>()}),
    ))
}

pub(in crate::host_server) async fn invoke(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<Invoke>,
) -> Result<Json<Value>, ApiError> {
    invoke_request(state, headers, request, false).await
}

enum WorkerLease {
    Legacy(crate::host_server::plugin_call_lifecycle::Lease),
    Admitted(admission::Lease),
}
impl WorkerLease {
    fn flag(&self) -> &std::sync::atomic::AtomicBool {
        match self {
            Self::Legacy(lease) => &lease.flag,
            Self::Admitted(lease) => &lease.flag,
        }
    }
}
async fn invoke_request(
    state: Arc<HostState>,
    headers: HeaderMap,
    request: Invoke,
    admitted: bool,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    validate(&request.access)?;
    if !admitted && !request.additional_accesses.is_empty() {
        return Err(rejected("resource_call_invalid"));
    }
    admission::validate_accesses(&request.access, &request.additional_accesses)?;
    if let Some(instance) = &request.host_instance_id {
        if uuid::Uuid::parse_str(instance).is_err() {
            return Err(rejected("resource_call_invalid"));
        }
        if instance != &state.plugin_resource_workers.instance_id {
            return Err(rejected("resource_call_host_changed"));
        }
    }
    let legacy_scope = if admitted {
        admission::key(&state, &request.access.owner, &request.tool_call_id)?;
        None
    } else {
        Some(call_scope(
            &state,
            &request.access.owner,
            &request.tool_call_id,
        )?)
    };
    // Admission precedes resource/module copies, without an unbounded waiting queue.
    let permit = state
        .plugin_resource_workers
        .slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| {
            plugin_api_error(
                StatusCode::TOO_MANY_REQUESTS,
                "resource_worker_busy",
                "Resource computation is busy",
            )
        })?;
    let plugin_slot = state
        .plugin_resource_workers
        .plugin_slots
        .try_acquire(&request.access.owner.plugin_id)
        .map_err(|_| {
            plugin_api_error(
                StatusCode::TOO_MANY_REQUESTS,
                "resource_worker_busy",
                "Resource computation is busy",
            )
        })?;
    let lease = if let Some((target, key)) = legacy_scope {
        WorkerLease::Legacy(
            state
                .plugin_calls
                .begin(
                    &target.instance_id,
                    &target.session_id,
                    &key,
                    &request.access.owner.plugin_id,
                )
                .map_err(rejected)?,
        )
    } else {
        WorkerLease::Admitted(admission::begin(&state, &request)?)
    };
    tokio::task::spawn_blocking(move || {
        let _permit=permit;
        let _plugin_slot=plugin_slot;
        let lease=lease;
        let started=Instant::now();
        let operation_id=uuid::Uuid::new_v4().to_string();
        let mut package_version=None;
        let mut resource_profile=PROFILE.to_owned();
        let result=execute(&state,&request,lease.flag(),&mut package_version,&mut resource_profile);
            let error=result.as_ref().err().and_then(|(_,body)|body.0["error"]["code"].as_str());
            let business_error=result.as_ref().ok().and_then(|execution| {
                (execution.result.get("ok") == Some(&Value::Bool(false)))
                    .then(|| execution.result["error"]["code"].as_str())
                    .flatten()
            });
            state.plugin_resource_workers.record(json!({"operationId":operation_id,"pluginId":request.access.owner.plugin_id,"packageVersion":package_version,
                "capabilityId":request.access.owner.capability_id,"durationMs":started.elapsed().as_millis(),
                "ok":result.is_ok() && business_error.is_none(),"errorCode":error.or(business_error)}));
        result.map(|execution| {
            let mut response=json!({"schemaVersion":1,"operationId":operation_id,"source":{"pluginId":request.access.owner.plugin_id,"packageVersion":package_version,"capabilityId":request.access.owner.capability_id,"contentVersion":request.access.content_version,"profile":resource_profile},"result":execution.result});
            if let Some(resources)=execution.resources { response["resources"]=resources; response["outputProfile"]=json!(crate::plugin_worker::resource_output::PROFILE); }
            Json(response)
        })
    }).await.map_err(|_|rejected("resource_execution_failed"))?
}

fn execute(
    state: &HostState,
    request: &Invoke,
    cancelled: &std::sync::atomic::AtomicBool,
    package_version: &mut Option<String>,
    resource_profile: &mut String,
) -> Result<Execution, ApiError> {
    if cancelled.load(Ordering::Acquire) {
        return Err(rejected("worker_cancelled"));
    }
    let owner = &request.access.owner;
    if owner.plugin_id == crate::plugin_resource_execution::HOST_IMAGE_INSPECTOR_PLUGIN_ID
        && owner.capability_id
            == crate::plugin_resource_execution::HOST_IMAGE_INSPECTOR_CAPABILITY_ID
    {
        *resource_profile = crate::plugin_resource_execution::HOST_IMAGE_INPUT_PROFILE.to_owned();
        return host_image::execute(state, request, cancelled, package_version);
    }
    if owner.plugin_id == crate::plugin_resource_execution::HOST_OCR_PLUGIN_ID
        && owner.capability_id == crate::plugin_resource_execution::HOST_OCR_CAPABILITY_ID
    {
        *resource_profile = crate::plugin_resource_execution::HOST_OCR_INPUT_PROFILE.to_owned();
        return host_ocr::execute(state, request, cancelled, package_version);
    }
    if owner.plugin_id == crate::plugin_resource_execution::HOST_TEXT_INSPECTOR_PLUGIN_ID
        && owner.capability_id
            == crate::plugin_resource_execution::HOST_TEXT_INSPECTOR_CAPABILITY_ID
    {
        *resource_profile = crate::plugin_resource_execution::HOST_TEXT_INPUT_PROFILE.to_owned();
        return host_text::execute(state, request, cancelled, package_version);
    }
    let (module, scene, binary, extended_output_types, output_contract, _profile_lease) = {
        let registry = state
            .plugins
            .lock()
            .map_err(|_| rejected("registry_unavailable"))?;
        let target = state
            .runtimes
            .statuses()
            .map_err(|_| rejected("runtime_unavailable"))?
            .into_iter()
            .find(|s| {
                s.target.instance_id == owner.runtime_id && s.target.session_id == owner.session_id
            })
            .map(|s| s.target)
            .ok_or_else(|| rejected("runtime_stopped"))?;
        let plugin = registry
            .execution_plugin(&target.scene_id, &owner.plugin_id)
            .filter(|p| p.enabled)
            .ok_or_else(|| rejected("resource_plugin_unavailable"))?;
        *package_version = Some(plugin.manifest.version.clone());
        if plugin.permission_grants.get("resource.read") != Some(&true) {
            return Err(plugin_api_error(
                StatusCode::FORBIDDEN,
                "permission_denied",
                "",
            ));
        }
        if plugin
            .manifest
            .runtime
            .get("resourceInputProfile")
            .and_then(Value::as_str)
            != Some(PROFILE)
        {
            return Err(rejected("resource_profile_unsupported"));
        }
        let capability = registry
            .capability(&target.scene_id, &owner.plugin_id, &owner.capability_id)
            .ok_or_else(|| rejected("capability_unavailable"))?;
        let image_resize_profile = crate::plugin_resource_execution::is_image_resize_profile(
            capability.execution_profile.as_deref(),
        );
        if capability.execution_profile.is_some() && !image_resize_profile {
            return Err(rejected("resource_execution_profile_unsupported"));
        }
        if request.additional_accesses.len() + 1 > capability.resource_input_max.unwrap_or(1) {
            return Err(rejected("resource_profile_unsupported"));
        }
        let profile_lease = if image_resize_profile {
            let call_lease = state
                .plugin_resource_workers
                .image_profile_slots
                .clone()
                .try_acquire_owned()
                .map_err(|_| rejected("resource_worker_busy"))?;
            let plugin_lease = state
                .plugin_resource_workers
                .image_profile_plugin_slots
                .try_acquire_with_limit(
                    &owner.plugin_id,
                    crate::plugin_resource_execution::IMAGE_RESIZE_PLUGIN_CALLS,
                )
                .map_err(rejected)?;
            Some((call_lease, plugin_lease))
        } else {
            None
        };
        validate_value(&capability.input_schema, &request.input, "$")
            .map_err(|_| rejected("invalid_parameters"))?;
        let (path, kind) = registry
            .plugin_runtime_entry(&target.scene_id, &owner.plugin_id)
            .map_err(|_| rejected("resource_module_unavailable"))?;
        if kind != "wasi" {
            return Err(rejected("resource_profile_unsupported"));
        }
        let module = plugin_results::module_snapshot::read(&path)
            .map_err(|_| rejected("resource_module_unavailable"))?;
        let binary = output::selection(&plugin.manifest.runtime)?;
        let extended_output_types = plugin
            .manifest
            .required_profiles
            .get("resource.output.types.v1")
            .is_some();
        (
            module,
            target.scene_id,
            binary,
            extended_output_types,
            capability,
            profile_lease,
        )
    };
    // This proof incorporates the captured module bytes, not a later mutable file read.
    let proof = identity_module(state, owner, None, Some(&module))?;
    for access in request.accesses() {
        authority::check_ancestors(state, access, &proof)?;
    }
    let resources = {
        let mut store = state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?;
        request
            .accesses()
            .map(|access| store.snapshot(access, &proof))
            .collect::<Result<Vec<_>, _>>()?
    };
    if output_contract
        .resource_input_mime_types
        .as_ref()
        .is_some_and(|accepted| {
            resources
                .iter()
                .any(|resource| !accepted.contains(&resource.descriptor.mime_type))
        })
    {
        return Err(rejected("resource_input_type_unsupported"));
    }
    let image_resize_profile = crate::plugin_resource_execution::is_image_resize_profile(
        output_contract.execution_profile.as_deref(),
    );
    if image_resize_profile {
        if request.accesses().count() != 1 || resources.len() != 1 {
            return Err(rejected("resource_profile_unsupported"));
        }
        let resource = &resources[0];
        if resource.descriptor.byte_length
            > crate::plugin_resource_execution::IMAGE_RESIZE_MAX_RESOURCE_BYTES
            || resource.bytes.len() != resource.descriptor.byte_length
        {
            return Err(rejected("resource_input_too_large"));
        }
        if !crate::plugin_resource_execution::IMAGE_MIME_TYPES
            .contains(&resource.descriptor.mime_type.as_str())
        {
            return Err(rejected("invalid_parameters"));
        }
    }
    if identity(state, owner, None)? != proof {
        return Err(rejected("resource_authorization_changed"));
    }
    let mut worker_request = json!({
        "workerPath":"","workerKind":"wasi","pluginId":owner.plugin_id,"capabilityId":owner.capability_id,
        "sceneId":scene,"input":request.input
    });
    if image_resize_profile {
        worker_request["executionProfile"] =
            json!(crate::plugin_resource_execution::IMAGE_RESIZE_PROFILE);
    }
    if binary {
        worker_request["resourceOutputProfile"] =
            json!(crate::plugin_worker::resource_output::PROFILE);
    }
    let frame = crate::plugin_worker::resource_input::encode_module_snapshot(
        worker_request,
        &resources,
        &module,
    )
    .map_err(|_| rejected("resource_input_too_large"))?;
    let executable =
        std::env::current_exe().map_err(|_| rejected("resource_worker_unavailable"))?;
    #[cfg(test)]
    let executable = state
        .plugin_resource_workers
        .executable
        .lock()
        .unwrap()
        .clone()
        .unwrap_or(executable);
    let mut command = crate::process_command::new_command(executable);
    command
        .arg("--zicode-plugin-worker")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(test)]
    let observer = state
        .plugin_resource_workers
        .observer
        .lock()
        .unwrap()
        .clone();
    #[cfg(not(test))]
    let observer: Option<Observer> = None;
    let result = lifecycle::watch(
        cancelled,
        || {
            identity(state, owner, None).is_ok_and(|current| current == proof)
                && request
                    .accesses()
                    .all(|access| authority::check_ancestors(state, access, &proof).is_ok())
        },
        || {
            if let Some(observer) = &observer {
                observer("authorization_lost", 0);
            }
        },
        || {
            worker_process::run_observed(
                command,
                frame,
                Duration::from_secs(if image_resize_profile {
                    crate::plugin_resource_execution::IMAGE_RESIZE_TIMEOUT_SECS
                } else {
                    5
                }),
                if binary {
                    crate::plugin_worker::resource_output::MAX_FRAME
                } else {
                    1024 * 1024 + 64 * 1024
                },
                Some(cancelled),
                observer.as_deref().map(|f| f as &dyn Fn(&'static str, u32)),
            )
        },
    );
    // Failed process cleanup is not an authorization rejection or a confirmed stop.
    if let Err(error) = &result {
        if error.code == "worker_cleanup_failed" {
            return Err(rejected(error.code));
        }
    }
    // Copied bytes cannot be withdrawn; stale authorization prevents returning results.
    if identity(state, owner, None)? != proof {
        return Err(rejected("resource_authorization_changed"));
    }
    for access in request.accesses() {
        authority::check_ancestors(state, access, &proof)?;
    }
    let (status, output) = result.map_err(|e| rejected(e.code))?;
    if cancelled.load(Ordering::Acquire) {
        return Err(rejected("worker_cancelled"));
    }
    if binary && status.success() {
        return output::register(
            state,
            request,
            &proof,
            &output,
            cancelled,
            &output_contract,
            output::Profiles {
                extended_output_types,
                image_resize: image_resize_profile,
            },
        );
    }
    let response: Value =
        serde_json::from_slice(&output).map_err(|_| rejected("worker_protocol_error"))?;
    if !status.success() || response["ok"] != true {
        return Err(rejected(
            crate::plugin_worker::failures::public(response["error"].as_str()).0,
        ));
    }
    let result = response
        .get("result")
        .filter(|r| !r.is_null())
        .ok_or_else(|| rejected("worker_protocol_error"))?;
    if serde_json::to_vec(result)
        .map_err(|_| rejected("worker_protocol_error"))?
        .len()
        > 1024 * 1024
    {
        return Err(rejected("result_too_large"));
    }
    output::validate_result(&output_contract, result)?;
    Ok(Execution {
        result: result.clone(),
        resources: None,
    })
}

#[cfg(test)]
mod tests;
