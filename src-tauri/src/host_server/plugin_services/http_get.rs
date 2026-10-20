//! Host-mediated, user-confirmed, fixed-endpoint HTTP reads for plugin Views.
//! This is not a general network client and cannot be called by WASI directly.
use super::*;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio_util::sync::CancellationToken;

pub(crate) const PROFILE: &str = "service.http.get.v1";
pub(crate) const PROFILE_VERSION: &str = "1.0.0-preview.1";
const GRANT_TTL: Duration = Duration::from_secs(60);
const OPERATION_TTL: Duration = Duration::from_secs(100);
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(3);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_OPERATIONS: usize = 2;
const MAX_AUDIT_FILE_BYTES: u64 = 1024 * 1024;

pub(in crate::host_server) struct AuditWriter {
    path: PathBuf,
    write_lock: StdMutex<()>,
}

impl AuditWriter {
    pub(in crate::host_server) fn new(plugin_root: PathBuf) -> io::Result<Self> {
        let audit_root = plugin_root.join("audit");
        fs::create_dir_all(&audit_root)?;
        let path = audit_root.join("http-services.jsonl");
        isolate_incomplete_audit(&path)?;
        Ok(Self {
            path,
            write_lock: StdMutex::new(()),
        })
    }

    fn append(&self, event: &Value) -> io::Result<()> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| io::Error::other("audit writer lock poisoned"))?;
        let mut line = serde_json::to_vec(event)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        line.push(b'\n');
        let line_bytes = line.len() as u64;
        if line_bytes > MAX_AUDIT_FILE_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "audit event exceeds the per-file size limit",
            ));
        }
        let current_size = match fs::metadata(&self.path) {
            Ok(metadata) => metadata.len(),
            Err(error) if error.kind() == io::ErrorKind::NotFound => 0,
            Err(error) => return Err(error),
        };
        if current_size.saturating_add(line_bytes) > MAX_AUDIT_FILE_BYTES {
            let backup = self.path.with_extension("jsonl.1");
            match fs::remove_file(&backup) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
            match fs::rename(&self.path, backup) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        file.write_all(&line)?;
        // Require file synchronization before publishing the corresponding
        // result to another tool. Rotation metadata needs separate recovery.
        file.sync_data()
    }
}

fn isolate_incomplete_audit(path: &Path) -> io::Result<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if !metadata.is_file() || metadata.len() > MAX_AUDIT_FILE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "audit file is not a bounded regular file",
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    fs::File::open(path)?
        .take(MAX_AUDIT_FILE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_AUDIT_FILE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "audit file grew beyond its limit during inspection",
        ));
    }
    if bytes.is_empty()
        || (bytes.last() == Some(&b'\n')
            && bytes[..bytes.len() - 1]
                .split(|byte| *byte == b'\n')
                .all(|line| matches!(serde_json::from_slice::<Value>(line), Ok(Value::Object(_)))))
    {
        return Ok(());
    }

    // Preserve the original bytes as the one bounded backup. A failed rename
    // leaves the current log in place and disables this service on startup.
    let backup = path.with_extension("jsonl.1");
    match fs::remove_file(&backup) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    fs::rename(path, backup)?;
    log::warn!("[plugin-http] incomplete audit log isolated before accepting requests");
    Ok(())
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Endpoint {
    Health,
    Info,
    Metrics,
}

impl Endpoint {
    fn path(&self) -> &'static str {
        match self {
            Self::Health => "/actuator/health",
            Self::Info => "/actuator/info",
            Self::Metrics => "/actuator/metrics",
        }
    }

    fn name(&self) -> &'static str {
        match self {
            Self::Health => "health",
            Self::Info => "info",
            Self::Metrics => "metrics",
        }
    }
}

#[derive(Clone)]
struct Owner {
    workspace_id: String,
    runtime_id: String,
    session_id: String,
    plugin_id: String,
}

#[derive(Clone)]
struct Target {
    url: reqwest::Url,
    host: String,
    addresses: Vec<SocketAddr>,
    address_class: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct PrepareRequest {
    schema_version: u32,
    workspace_id: String,
    runtime_id: String,
    session_id: String,
    plugin_id: String,
    origin: String,
    endpoint: Endpoint,
    operation_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct CommitRequest {
    schema_version: u32,
    workspace_id: String,
    runtime_id: String,
    session_id: String,
    plugin_id: String,
    grant_id: String,
    operation_id: String,
    confirmed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct CancelRequest {
    schema_version: u32,
    workspace_id: String,
    runtime_id: String,
    session_id: String,
    plugin_id: String,
    operation_id: String,
}

struct Grant {
    owner: Owner,
    scene: String,
    endpoint: Endpoint,
    origin: String,
    address_class: &'static str,
    expires: Instant,
    revision: u64,
    generation: u64,
    operation_id: String,
}

struct Operation {
    owner: Owner,
    cancellation: CancellationToken,
    finished: bool,
    expires: Instant,
}

#[derive(Default)]
pub(in crate::host_server) struct Grants {
    pending: HashMap<String, Grant>,
    operations: HashMap<String, Operation>,
    plugin_revisions: HashMap<String, u64>,
    generation: u64,
    #[cfg(test)]
    trusted_root_certificates: Vec<reqwest::Certificate>,
}

impl Grants {
    pub(in crate::host_server) fn invalidate_workspace(&mut self, workspace_id: &str) {
        self.pending
            .retain(|_, grant| grant.owner.workspace_id != workspace_id);
        for operation in self.operations.values_mut() {
            if operation.owner.workspace_id == workspace_id {
                operation.cancellation.cancel();
                operation.finished = true;
            }
        }
    }

    pub(in crate::host_server) fn invalidate_plugin(&mut self, plugin_id: &str) {
        self.pending
            .retain(|_, grant| grant.owner.plugin_id != plugin_id);
        for operation in self.operations.values_mut() {
            if operation.owner.plugin_id == plugin_id {
                operation.cancellation.cancel();
                operation.finished = true;
            }
        }
        let revision = self
            .plugin_revisions
            .entry(plugin_id.to_owned())
            .or_default();
        *revision = revision.wrapping_add(1);
    }

    fn revision_for(&self, plugin_id: &str) -> u64 {
        self.plugin_revisions
            .get(plugin_id)
            .copied()
            .unwrap_or_default()
    }

    fn start(&mut self, id: &str, owner: &Owner) -> Result<CancellationToken, ApiError> {
        let now = Instant::now();
        self.pending.retain(|_, grant| grant.expires > now);
        self.operations.retain(|_, operation| {
            if operation.expires <= now {
                operation.cancellation.cancel();
                false
            } else {
                true
            }
        });
        if self.operations.contains_key(id)
            || self.operations.values().any(|op| {
                !op.finished
                    && !op.cancellation.is_cancelled()
                    && op.owner.plugin_id == owner.plugin_id
            })
        {
            return Err(rejected(
                StatusCode::TOO_MANY_REQUESTS,
                "http_service_plugin_busy",
            ));
        }
        if self
            .operations
            .values()
            .filter(|op| !op.finished && !op.cancellation.is_cancelled())
            .count()
            >= MAX_OPERATIONS
        {
            return Err(rejected(StatusCode::TOO_MANY_REQUESTS, "http_service_busy"));
        }
        let cancellation = CancellationToken::new();
        self.operations.insert(
            id.to_owned(),
            Operation {
                owner: owner.clone(),
                cancellation: cancellation.clone(),
                finished: false,
                expires: now + OPERATION_TTL,
            },
        );
        Ok(cancellation)
    }

    fn cancel(&mut self, id: &str, owner: &Owner) -> Result<bool, ApiError> {
        let operation = self
            .operations
            .get_mut(id)
            .filter(|operation| same_owner(&operation.owner, owner))
            .ok_or_else(|| rejected(StatusCode::CONFLICT, "http_service_operation_unavailable"))?;
        if operation.finished {
            return Ok(false);
        }
        operation.cancellation.cancel();
        Ok(true)
    }

    fn token(&mut self, id: &str, owner: &Owner) -> Result<CancellationToken, ApiError> {
        let operation = self
            .operations
            .get_mut(id)
            .filter(|operation| same_owner(&operation.owner, owner) && !operation.finished)
            .ok_or_else(|| rejected(StatusCode::CONFLICT, "http_service_operation_unavailable"))?;
        Ok(operation.cancellation.clone())
    }

    fn finish(&mut self, id: &str) {
        if let Some(operation) = self.operations.get_mut(id) {
            operation.finished = true;
            operation.expires = Instant::now() + Duration::from_secs(60);
        }
        self.pending.retain(|_, grant| grant.operation_id != id);
    }
}

fn same_owner(left: &Owner, right: &Owner) -> bool {
    left.workspace_id == right.workspace_id
        && left.runtime_id == right.runtime_id
        && left.session_id == right.session_id
        && left.plugin_id == right.plugin_id
}

fn rejected(status: StatusCode, code: &'static str) -> ApiError {
    plugin_api_error(status, code, "HTTP service request rejected")
}

#[derive(Clone, Copy)]
struct AuditContext<'a> {
    owner: &'a Owner,
    operation_id: &'a str,
    endpoint: &'a Endpoint,
    scheme: &'a str,
    host: &'a str,
    port: u16,
    address_class: &'a str,
}

#[derive(Default)]
struct AuditResponse<'a> {
    status: Option<u16>,
    response_bytes: Option<usize>,
    error_code: Option<&'a str>,
}

impl AuditContext<'_> {
    fn event(
        &self,
        phase: &'static str,
        outcome: &'static str,
        response: AuditResponse<'_>,
    ) -> Value {
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        json!({
            "schemaVersion": 1,
            "profile": PROFILE,
            "profileVersion": PROFILE_VERSION,
            "timestampMs": timestamp_ms,
            "phase": phase,
            "pluginId": &self.owner.plugin_id,
            "runtimeId": &self.owner.runtime_id,
            "operationId": self.operation_id,
            "endpoint": self.endpoint.name(),
            "scheme": self.scheme,
            "host": self.host,
            "port": self.port,
            "addressClass": self.address_class,
            "outcome": outcome,
            "httpStatus": response.status,
            "responseBytesRead": response.response_bytes,
            "errorCode": response.error_code,
            "cancelReason": if response.error_code == Some("http_service_request_cancelled") {
                Some("client_requested")
            } else {
                None
            }
        })
    }
}

fn append_audit(state: &HostState, event: &Value) -> Result<(), ApiError> {
    state
        .http_get_audit
        .as_ref()
        .ok_or_else(|| {
            rejected(
                StatusCode::SERVICE_UNAVAILABLE,
                "http_service_audit_unavailable",
            )
        })?
        .append(event)
        .map_err(|_| {
            rejected(
                StatusCode::SERVICE_UNAVAILABLE,
                "http_service_audit_unavailable",
            )
        })
}

fn error_status(code: &str) -> StatusCode {
    match code {
        "http_service_request_cancelled" => StatusCode::CONFLICT,
        "http_service_timeout" | "http_service_dns_timeout" => StatusCode::GATEWAY_TIMEOUT,
        "http_service_response_too_large" | "http_service_json_complexity_exceeded" => {
            StatusCode::PAYLOAD_TOO_LARGE
        }
        "http_service_address_blocked"
        | "http_service_mixed_addresses"
        | "http_service_https_required"
        | "http_service_redirect_blocked"
        | "http_service_content_type_invalid" => StatusCode::FORBIDDEN,
        "http_service_dns_changed" | "http_service_address_changed" => StatusCode::CONFLICT,
        "http_service_origin_invalid" => StatusCode::BAD_REQUEST,
        _ => StatusCode::BAD_GATEWAY,
    }
}

struct FetchFailure {
    code: &'static str,
    http_status: Option<u16>,
    response_bytes: usize,
    address_class: Option<&'static str>,
}

impl FetchFailure {
    fn before_response(code: &'static str) -> Self {
        Self {
            code,
            http_status: None,
            response_bytes: 0,
            address_class: None,
        }
    }
}

fn request_owner(
    schema_version: u32,
    workspace_id: String,
    runtime_id: String,
    session_id: String,
    plugin_id: String,
    operation_id: &str,
) -> Result<Owner, ApiError> {
    if schema_version != 1
        || workspace_id.len() > 64
        || uuid::Uuid::parse_str(&workspace_id).is_err()
        || uuid::Uuid::parse_str(operation_id).is_err()
        || runtime_id.is_empty()
        || runtime_id.len() > 128
        || session_id.is_empty()
        || session_id.len() > 128
        || plugin_id.is_empty()
        || plugin_id.len() > 128
    {
        return Err(rejected(
            StatusCode::BAD_REQUEST,
            "http_service_input_invalid",
        ));
    }
    Ok(Owner {
        workspace_id,
        runtime_id,
        session_id,
        plugin_id,
    })
}

fn authorize(state: &HostState, owner: &Owner) -> Result<String, ApiError> {
    state
        .data
        .workspace_root_path(&owner.workspace_id)
        .map_err(|_| rejected(StatusCode::CONFLICT, "http_service_workspace_unavailable"))?;
    let target = state
        .runtimes
        .statuses()
        .map_err(|_| rejected(StatusCode::SERVICE_UNAVAILABLE, "runtime_unavailable"))?
        .into_iter()
        .find(|status| {
            status.target.instance_id == owner.runtime_id
                && status.target.session_id == owner.session_id
        })
        .map(|status| status.target)
        .ok_or_else(|| rejected(StatusCode::CONFLICT, "runtime_stopped"))?;
    let registry = state
        .plugins
        .lock()
        .map_err(|_| rejected(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable"))?;
    let plugin = registry
        .execution_plugin(&target.scene_id, &owner.plugin_id)
        .filter(|plugin| plugin.enabled)
        .ok_or_else(|| rejected(StatusCode::CONFLICT, "service_plugin_unavailable"))?;
    let expected_profile = format!("={PROFILE_VERSION}");
    if plugin
        .manifest
        .required_profiles
        .get(PROFILE)
        .and_then(Value::as_str)
        != Some(expected_profile.as_str())
    {
        return Err(rejected(
            StatusCode::CONFLICT,
            "http_service_profile_required",
        ));
    }
    if plugin.permission_grants.get("service.http.read") != Some(&true) {
        return Err(rejected(StatusCode::FORBIDDEN, "permission_denied"));
    }
    Ok(target.scene_id)
}

fn classify_ip(address: IpAddr) -> Option<&'static str> {
    match address {
        IpAddr::V4(ip) if ip.is_loopback() => Some("loopback"),
        IpAddr::V4(ip) if ip.is_private() => Some("private"),
        IpAddr::V4(ip) if crate::public_http::is_public_ip(IpAddr::V4(ip)) => Some("public"),
        IpAddr::V6(ip) if ip.to_ipv4_mapped().is_some() => {
            classify_ip(IpAddr::V4(ip.to_ipv4_mapped()?))
        }
        IpAddr::V6(ip) if ip.is_loopback() => Some("loopback"),
        IpAddr::V6(ip) if (ip.segments()[0] & 0xfe00) == 0xfc00 => Some("private"),
        IpAddr::V6(ip)
            if (ip.segments()[0] & 0xe000) == 0x2000
                && (ip.segments()[0] != 0x2001 || ip.segments()[1] != 0x0db8) =>
        {
            Some("public")
        }
        _ => None,
    }
}

fn parse_origin(origin: &str) -> Result<(reqwest::Url, String, u16), ApiError> {
    if origin.len() > 2_048 {
        return Err(rejected(
            StatusCode::BAD_REQUEST,
            "http_service_origin_invalid",
        ));
    }
    let parsed = reqwest::Url::parse(origin)
        .map_err(|_| rejected(StatusCode::BAD_REQUEST, "http_service_origin_invalid"))?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(rejected(
            StatusCode::BAD_REQUEST,
            "http_service_origin_invalid",
        ));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| rejected(StatusCode::BAD_REQUEST, "http_service_origin_invalid"))?
        .to_ascii_lowercase();
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| rejected(StatusCode::BAD_REQUEST, "http_service_origin_invalid"))?;
    Ok((parsed, host, port))
}

fn display_address_class(host: &str) -> Result<&'static str, ApiError> {
    let ip_host = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = ip_host.parse::<IpAddr>() {
        return classify_ip(ip)
            .ok_or_else(|| rejected(StatusCode::FORBIDDEN, "http_service_address_blocked"));
    }
    let canonical = host.trim_end_matches('.');
    if canonical == "localhost" || canonical.ends_with(".localhost") {
        return Ok("loopback");
    }
    Ok("hostname")
}

async fn resolve_target(origin: &str, endpoint: &Endpoint) -> Result<Target, &'static str> {
    let (parsed, host, port) = parse_origin(origin).map_err(|_| "http_service_origin_invalid")?;
    let ip_host = host.trim_start_matches('[').trim_end_matches(']');
    let addresses = if let Ok(ip) = ip_host.parse::<IpAddr>() {
        vec![SocketAddr::new(ip, port)]
    } else {
        tokio::time::timeout(RESOLVE_TIMEOUT, tokio::net::lookup_host((ip_host, port)))
            .await
            .map_err(|_| "http_service_dns_timeout")?
            .map_err(|_| "http_service_dns_failed")?
            .collect::<Vec<_>>()
    };
    if addresses.is_empty() {
        return Err("http_service_dns_failed");
    }
    let mut classes = addresses
        .iter()
        .map(|address| classify_ip(address.ip()).ok_or("http_service_address_blocked"))
        .collect::<Result<Vec<_>, _>>()?;
    classes.sort_unstable();
    classes.dedup();
    if classes.len() != 1 {
        return Err("http_service_mixed_addresses");
    }
    let address_class = classes[0];
    let https = parsed.scheme() == "https";
    if !https && address_class == "public" {
        return Err("http_service_https_required");
    }
    let mut url = parsed.clone();
    url.set_path(endpoint.path());
    let mut addresses = addresses;
    addresses.sort_unstable();
    addresses.dedup();
    Ok(Target {
        url,
        host,
        addresses,
        address_class,
    })
}

pub(in crate::host_server) async fn prepare(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<PrepareRequest>,
) -> Result<Json<Value>, ApiError> {
    if !desktop_http_token_authorized(&headers, &state.desktop_token) {
        return Err(rejected(StatusCode::FORBIDDEN, "desktop_only"));
    }
    let owner = request_owner(
        request.schema_version,
        request.workspace_id,
        request.runtime_id,
        request.session_id,
        request.plugin_id,
        &request.operation_id,
    )?;
    state
        .data
        .workspace_root_path(&owner.workspace_id)
        .map_err(|_| rejected(StatusCode::CONFLICT, "model_workspace_unavailable"))?;
    let scene = authorize(&state, &owner)?;
    // Preparing consent must not contact DNS. Hostnames are resolved only after
    // the user approves the displayed origin in the parent Studio window.
    let (parsed, host, port) = parse_origin(&request.origin)?;
    let address_class = display_address_class(&host)?;
    let https = parsed.scheme() == "https";
    if !https && matches!(address_class, "public" | "hostname") {
        return Err(rejected(
            StatusCode::FORBIDDEN,
            "http_service_https_required",
        ));
    }
    let origin = parsed.as_str().trim_end_matches('/').to_owned();
    let audit_context = AuditContext {
        owner: &owner,
        operation_id: &request.operation_id,
        endpoint: &request.endpoint,
        scheme: parsed.scheme(),
        host: &host,
        port,
        address_class,
    };
    let grant_id = uuid::Uuid::new_v4().to_string();
    let ttl_ms = GRANT_TTL.as_millis() as u64;
    let mut grants = state
        .http_get_grants
        .lock()
        .map_err(|_| rejected(StatusCode::SERVICE_UNAVAILABLE, "http_service_unavailable"))?;
    let cancellation = grants.start(&request.operation_id, &owner)?;
    if cancellation.is_cancelled() {
        return Err(rejected(
            StatusCode::CONFLICT,
            "http_service_request_cancelled",
        ));
    }
    let revision = grants.revision_for(&owner.plugin_id);
    let generation = grants.generation;
    grants.pending.insert(
        grant_id.clone(),
        Grant {
            owner: owner.clone(),
            scene,
            endpoint: request.endpoint.clone(),
            origin: origin.clone(),
            address_class,
            expires: Instant::now() + GRANT_TTL,
            revision,
            generation,
            operation_id: request.operation_id.clone(),
        },
    );
    let event = audit_context.event(
        "consent_prepared",
        "awaiting_user",
        AuditResponse::default(),
    );
    if let Err(error) = append_audit(&state, &event) {
        grants.finish(&request.operation_id);
        return Err(error);
    }
    Ok(Json(
        json!({"schemaVersion":1,"operation":"http.get.prepare","grantId":grant_id,
        "operationId":request.operation_id,"expiresInMs":ttl_ms,
        "display":{"origin":origin,"method":"GET","path":request.endpoint.path(),
        "endpoint":request.endpoint.name(),"addressClass":address_class,
        "https":https,"maxResponseBytes":MAX_RESPONSE_BYTES,"timeoutMs":REQUEST_TIMEOUT.as_millis()}}),
    ))
}

pub(in crate::host_server) async fn cancel(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<CancelRequest>,
) -> Result<Json<Value>, ApiError> {
    if !desktop_http_token_authorized(&headers, &state.desktop_token) {
        return Err(rejected(StatusCode::FORBIDDEN, "desktop_only"));
    }
    let owner = request_owner(
        request.schema_version,
        request.workspace_id,
        request.runtime_id,
        request.session_id,
        request.plugin_id,
        &request.operation_id,
    )?;
    let requested = state
        .http_get_grants
        .lock()
        .map_err(|_| rejected(StatusCode::SERVICE_UNAVAILABLE, "http_service_unavailable"))?
        .cancel(&request.operation_id, &owner)?;
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    append_audit(
        &state,
        &json!({
            "schemaVersion":1,
            "profile":PROFILE,
            "profileVersion":PROFILE_VERSION,
            "timestampMs":timestamp_ms,
            "phase":"cancel_requested",
            "pluginId":owner.plugin_id,
            "runtimeId":owner.runtime_id,
            "operationId":request.operation_id,
            "outcome":if requested {"requested"} else {"already_finished"},
            "errorCode":if requested {None::<&str>} else {Some("http_service_operation_finished")},
            "cancelReason":if requested {Some("client_requested")} else {None::<&str>}
        }),
    )?;
    Ok(Json(
        json!({"schemaVersion":1,"operation":"http.get.cancel",
        "status":if requested {"requested"} else {"finished"},"executionFinished":!requested}),
    ))
}

async fn fetch_json(
    origin: &str,
    endpoint: Endpoint,
    displayed_address_class: &'static str,
    cancellation: CancellationToken,
    trusted_root_certificates: Vec<reqwest::Certificate>,
) -> Result<(Value, &'static str), FetchFailure> {
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err(FetchFailure::before_response("http_service_request_cancelled")),
        result = fetch_json_inner(origin, endpoint, displayed_address_class, trusted_root_certificates) => result,
    }
}

async fn fetch_json_inner(
    origin: &str,
    endpoint: Endpoint,
    displayed_address_class: &'static str,
    trusted_root_certificates: Vec<reqwest::Certificate>,
) -> Result<(Value, &'static str), FetchFailure> {
    // Resolution starts only after the trusted parent has received an explicit
    // user approval. Non-literal hostnames may resolve only to public addresses;
    // local/private destinations must be visible as localhost or a literal IP.
    let target = resolve_target(origin, &endpoint)
        .await
        .map_err(FetchFailure::before_response)?;
    if displayed_address_class == "hostname" && target.address_class != "public" {
        return Err(FetchFailure::before_response(
            "http_service_address_blocked",
        ));
    }
    if displayed_address_class != "hostname" && target.address_class != displayed_address_class {
        return Err(FetchFailure::before_response(
            "http_service_address_changed",
        ));
    }
    let current = resolve_target(origin, &endpoint)
        .await
        .map_err(FetchFailure::before_response)?;
    if current.addresses != target.addresses || current.address_class != target.address_class {
        return Err(FetchFailure::before_response("http_service_dns_changed"));
    }
    let mut client_builder = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .resolve_to_addrs(&target.host, &target.addresses);
    for root_certificate in trusted_root_certificates {
        client_builder = client_builder.add_root_certificate(root_certificate);
    }
    let client = client_builder
        .build()
        .map_err(|_| FetchFailure::before_response("http_service_unavailable"))?;
    let resolved_address_class = target.address_class;
    let mut observed_status = None;
    let mut observed_response_bytes = 0;
    let request = async {
        let mut response = client
            .get(target.url)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(reqwest::header::USER_AGENT, "ZiCode-Studio-PluginService/1")
            .send()
            .await
            .map_err(|_| "http_service_request_failed")?;
        let status = response.status();
        observed_status = Some(status.as_u16());
        if status.is_redirection() {
            return Err("http_service_redirect_blocked");
        }
        if !(status.is_success()
            || endpoint == Endpoint::Health && status == StatusCode::SERVICE_UNAVAILABLE)
        {
            return Err("http_service_status_error");
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
        {
            return Err("http_service_response_too_large");
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if content_type != "application/json" && !content_type.ends_with("+json") {
            return Err("http_service_content_type_invalid");
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "http_service_request_failed")?
        {
            if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
                return Err("http_service_response_too_large");
            }
            bytes.extend_from_slice(&chunk);
            observed_response_bytes = bytes.len();
        }
        let value: Value =
            serde_json::from_slice(&bytes).map_err(|_| "http_service_json_invalid")?;
        fn check_budget(value: &Value, depth: usize, nodes: &mut usize) -> bool {
            *nodes = nodes.saturating_add(1);
            if depth > 32 || *nodes > 20_000 {
                return false;
            }
            match value {
                Value::Array(items) => items
                    .iter()
                    .all(|item| check_budget(item, depth + 1, nodes)),
                Value::Object(items) => items.iter().all(|(key, item)| {
                    *nodes = nodes.saturating_add(1);
                    key.len() <= 16 * 1024
                        && *nodes <= 20_000
                        && check_budget(item, depth + 1, nodes)
                }),
                _ => true,
            }
        }
        let mut nodes = 0;
        if !check_budget(&value, 0, &mut nodes) {
            return Err("http_service_json_complexity_exceeded");
        }
        Ok(
            json!({"endpoint":endpoint.name(),"status":status.as_u16(),"contentType":content_type,
            "data":value,"byteLength":bytes.len()}),
        )
    };
    let result = tokio::time::timeout(REQUEST_TIMEOUT, request)
        .await
        .unwrap_or(Err("http_service_timeout"));
    result
        .map(|value| (value, resolved_address_class))
        .map_err(|code| FetchFailure {
            code,
            http_status: observed_status,
            response_bytes: observed_response_bytes,
            address_class: Some(resolved_address_class),
        })
}

pub(in crate::host_server) async fn commit(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<CommitRequest>,
) -> Result<Json<Value>, ApiError> {
    if !desktop_http_token_authorized(&headers, &state.desktop_token) {
        return Err(rejected(StatusCode::FORBIDDEN, "desktop_only"));
    }
    let owner = request_owner(
        request.schema_version,
        request.workspace_id,
        request.runtime_id,
        request.session_id,
        request.plugin_id,
        &request.operation_id,
    )?;
    let grant = {
        let mut grants = state
            .http_get_grants
            .lock()
            .map_err(|_| rejected(StatusCode::SERVICE_UNAVAILABLE, "http_service_unavailable"))?;
        let grant = grants
            .pending
            .remove(&request.grant_id)
            .ok_or_else(|| rejected(StatusCode::CONFLICT, "http_service_grant_unavailable"))?;
        if grant.revision != grants.revision_for(&owner.plugin_id)
            || grant.generation != grants.generation
            || !same_owner(&grant.owner, &owner)
            || grant.operation_id != request.operation_id
            || grant.expires <= Instant::now()
        {
            grants.finish(&grant.operation_id);
            return Err(rejected(
                StatusCode::CONFLICT,
                "http_service_grant_unavailable",
            ));
        }
        grant
    };
    let expected_revision = grant.revision;
    let expected_generation = grant.generation;
    let (parsed_origin, host, port) = parse_origin(&grant.origin)?;
    let audit_context = AuditContext {
        owner: &owner,
        operation_id: &request.operation_id,
        endpoint: &grant.endpoint,
        scheme: parsed_origin.scheme(),
        host: &host,
        port,
        address_class: grant.address_class,
    };
    if !request.confirmed {
        state
            .http_get_grants
            .lock()
            .map_err(|_| rejected(StatusCode::SERVICE_UNAVAILABLE, "http_service_unavailable"))?
            .finish(&request.operation_id);
        append_audit(
            &state,
            &audit_context.event("request_completed", "declined", AuditResponse::default()),
        )?;
        return Ok(Json(
            json!({"schemaVersion":1,"operation":"http.get","status":"declined"}),
        ));
    }
    let scene = match authorize(&state, &owner) {
        Ok(scene) => scene,
        Err(error) => {
            state
                .http_get_grants
                .lock()
                .map_err(|_| rejected(StatusCode::SERVICE_UNAVAILABLE, "http_service_unavailable"))?
                .finish(&request.operation_id);
            append_audit(
                &state,
                &audit_context.event(
                    "request_completed",
                    "failed",
                    AuditResponse {
                        error_code: Some("http_service_authorization_changed"),
                        ..AuditResponse::default()
                    },
                ),
            )?;
            return Err(error);
        }
    };
    if scene != grant.scene {
        state
            .http_get_grants
            .lock()
            .map_err(|_| rejected(StatusCode::SERVICE_UNAVAILABLE, "http_service_unavailable"))?
            .finish(&request.operation_id);
        append_audit(
            &state,
            &audit_context.event(
                "request_completed",
                "failed",
                AuditResponse {
                    error_code: Some("http_service_authorization_changed"),
                    ..AuditResponse::default()
                },
            ),
        )?;
        return Err(rejected(
            StatusCode::CONFLICT,
            "http_service_authorization_changed",
        ));
    }
    let cancellation = state
        .http_get_grants
        .lock()
        .map_err(|_| rejected(StatusCode::SERVICE_UNAVAILABLE, "http_service_unavailable"))?
        .token(&request.operation_id, &owner)?;
    let start_event = audit_context.event("request_started", "started", AuditResponse::default());
    if let Err(error) = append_audit(&state, &start_event) {
        if let Ok(mut grants) = state.http_get_grants.lock() {
            grants.finish(&request.operation_id);
        }
        return Err(error);
    }
    #[cfg(test)]
    let trusted_root_certificates = state
        .http_get_grants
        .lock()
        .map(|grants| grants.trusted_root_certificates.clone())
        .unwrap_or_default();
    #[cfg(not(test))]
    let trusted_root_certificates = Vec::new();
    let result = fetch_json(
        &grant.origin,
        grant.endpoint.clone(),
        grant.address_class,
        cancellation,
        trusted_root_certificates,
    )
    .await;
    let current_version = {
        let mut grants = state
            .http_get_grants
            .lock()
            .map_err(|_| rejected(StatusCode::SERVICE_UNAVAILABLE, "http_service_unavailable"))?;
        grants.finish(&request.operation_id);
        (grants.revision_for(&owner.plugin_id), grants.generation)
    };
    let (result, resolved_address_class) = match result {
        Ok(result) => result,
        Err(failure) => {
            let failure_context = AuditContext {
                address_class: failure.address_class.unwrap_or(grant.address_class),
                ..audit_context
            };
            append_audit(
                &state,
                &failure_context.event(
                    "request_completed",
                    "failed",
                    AuditResponse {
                        status: failure.http_status,
                        response_bytes: Some(failure.response_bytes),
                        error_code: Some(failure.code),
                    },
                ),
            )?;
            return Err(rejected(error_status(failure.code), failure.code));
        }
    };
    let resolved_context = AuditContext {
        address_class: resolved_address_class,
        ..audit_context
    };
    if current_version != (expected_revision, expected_generation) {
        append_audit(
            &state,
            &resolved_context.event(
                "request_completed",
                "failed",
                AuditResponse {
                    status: result["status"].as_u64().map(|status| status as u16),
                    response_bytes: result["byteLength"].as_u64().map(|bytes| bytes as usize),
                    error_code: Some("http_service_authorization_changed"),
                },
            ),
        )?;
        return Err(rejected(
            StatusCode::CONFLICT,
            "http_service_authorization_changed",
        ));
    }
    match authorize(&state, &owner) {
        Ok(scene) if scene == grant.scene => {}
        Ok(_) => {
            append_audit(
                &state,
                &resolved_context.event(
                    "request_completed",
                    "failed",
                    AuditResponse {
                        status: result["status"].as_u64().map(|status| status as u16),
                        response_bytes: result["byteLength"].as_u64().map(|bytes| bytes as usize),
                        error_code: Some("http_service_authorization_changed"),
                    },
                ),
            )?;
            return Err(rejected(
                StatusCode::CONFLICT,
                "http_service_authorization_changed",
            ));
        }
        Err(error) => {
            append_audit(
                &state,
                &resolved_context.event(
                    "request_completed",
                    "failed",
                    AuditResponse {
                        status: result["status"].as_u64().map(|status| status as u16),
                        response_bytes: result["byteLength"].as_u64().map(|bytes| bytes as usize),
                        error_code: Some("http_service_authorization_changed"),
                    },
                ),
            )?;
            return Err(error);
        }
    }
    let registry = state
        .plugins
        .lock()
        .map_err(|_| rejected(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable"))?;
    // A failed completion audit must not leave a newly captured result behind
    // when the caller only receives an error.
    append_audit(
        &state,
        &resolved_context.event(
            "request_completed",
            "succeeded",
            AuditResponse {
                status: result["status"].as_u64().map(|status| status as u16),
                response_bytes: result["byteLength"].as_u64().map(|bytes| bytes as usize),
                ..AuditResponse::default()
            },
        ),
    )?;
    let result_ref = crate::host_server::plugin_results::capture_service_http(
        &state,
        &registry,
        &owner.workspace_id,
        &grant.scene,
        &owner.plugin_id,
        &result,
    )
    .ok();
    let mut response = json!({"schemaVersion":1,"operation":"http.get","result":result});
    match result_ref {
        Some(reference) => response["resultRef"] = reference,
        None => response["resultCaptureError"] = json!({"code":"result_capture_unavailable"}),
    }
    Ok(Json(response))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host_server::{HostMode, HostServer};
    use crate::metadata_store::MetadataStore;
    use crate::native_pi_manager::NativePiManager;
    use crate::remote_auth::RemoteAuth;
    use crate::runtime_coordinator::RuntimeTarget;
    use std::fs;
    use std::net::{Ipv4Addr, SocketAddr};
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn closing_one_workspace_cancels_only_its_http_operation() {
        let mut grants = Grants::default();
        let owner = |workspace_id: &str, plugin_id: &str| Owner {
            workspace_id: workspace_id.into(),
            runtime_id: format!("runtime-{workspace_id}"),
            session_id: format!("session-{workspace_id}"),
            plugin_id: plugin_id.into(),
        };
        let first = owner("workspace-a", "plugin-a");
        let other = owner("workspace-b", "plugin-b");
        let first_token = grants.start("operation-a", &first).unwrap();
        let other_token = grants.start("operation-b", &other).unwrap();

        grants.invalidate_workspace("workspace-a");

        assert!(first_token.is_cancelled());
        assert!(!other_token.is_cancelled());
        assert!(grants.token("operation-b", &other).is_ok());
    }

    #[test]
    fn persists_structured_request_audit_without_response_content() {
        let root = std::env::temp_dir().join(format!(
            "zicode-http-audit-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let writer = AuditWriter::new(root.clone()).unwrap();
        let owner = Owner {
            workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".into(),
            runtime_id: "runtime-audit-test".into(),
            session_id: "session-audit-test".into(),
            plugin_id: "com.example.actuator".into(),
        };
        let event = AuditContext {
            owner: &owner,
            operation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            endpoint: &Endpoint::Health,
            scheme: "https",
            host: "metrics.example.test",
            port: 443,
            address_class: "public",
        }
        .event(
            "request_completed",
            "succeeded",
            AuditResponse {
                status: Some(200),
                response_bytes: Some(24),
                ..AuditResponse::default()
            },
        );
        writer.append(&event).unwrap();
        let contents = fs::read_to_string(root.join("audit/http-services.jsonl")).unwrap();
        let record: Value = serde_json::from_str(contents.trim()).unwrap();
        assert_eq!(record["profile"], PROFILE);
        assert_eq!(record["phase"], "request_completed");
        assert_eq!(record["pluginId"], "com.example.actuator");
        assert_eq!(record["runtimeId"], "runtime-audit-test");
        assert_eq!(record["host"], "metrics.example.test");
        assert_eq!(record["httpStatus"], 200);
        assert_eq!(record["responseBytesRead"], 24);
        assert!(record.get("responseBody").is_none());
        assert!(!contents.contains("response data"));
        drop(writer);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rotates_audit_log_with_a_bounded_single_backup() {
        let root = std::env::temp_dir().join(format!(
            "zicode-http-audit-rotation-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let audit_path = root.join("audit/http-services.jsonl");
        fs::create_dir_all(audit_path.parent().unwrap()).unwrap();
        let mut old_log = b"{\"padding\":\"".to_vec();
        old_log.extend(vec![
            b'x';
            (MAX_AUDIT_FILE_BYTES - 2) as usize
                - old_log.len()
                - b"\"}\n".len()
        ]);
        old_log.extend_from_slice(b"\"}\n");
        fs::write(&audit_path, old_log).unwrap();
        let writer = AuditWriter::new(root.clone()).unwrap();
        writer.append(&json!({"phase":"test"})).unwrap();
        let backup = audit_path.with_extension("jsonl.1");
        assert_eq!(
            fs::metadata(&backup).unwrap().len(),
            MAX_AUDIT_FILE_BYTES - 2
        );
        let current = fs::read_to_string(&audit_path).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(current.trim()).unwrap()["phase"],
            "test"
        );
        drop(writer);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn isolates_incomplete_audit_on_restart_without_replaying_a_request() {
        let root = std::env::temp_dir().join(format!(
            "zicode-http-audit-recovery-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let audit_path = root.join("audit/http-services.jsonl");
        fs::create_dir_all(audit_path.parent().unwrap()).unwrap();
        let incomplete = b"{\"phase\":\"request_started\"}\n{\"phase\":\"request_completed\"";
        fs::write(&audit_path, incomplete).unwrap();
        let backup = audit_path.with_extension("jsonl.1");
        fs::write(&backup, b"old backup\n").unwrap();

        let writer = AuditWriter::new(root.clone()).unwrap();
        assert_eq!(fs::read(&backup).unwrap(), incomplete);
        assert!(!audit_path.exists());
        writer.append(&json!({"phase":"consent_prepared"})).unwrap();
        let current = fs::read_to_string(&audit_path).unwrap();
        assert_eq!(current.lines().count(), 1);
        assert_eq!(
            serde_json::from_str::<Value>(current.trim()).unwrap()["phase"],
            "consent_prepared"
        );
        drop(writer);

        let reopened = AuditWriter::new(root.clone()).unwrap();
        reopened
            .append(&json!({"phase":"request_started"}))
            .unwrap();
        assert_eq!(fs::read(&backup).unwrap(), incomplete);
        assert_eq!(fs::read_to_string(&audit_path).unwrap().lines().count(), 2);
        drop(reopened);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn isolates_blank_audit_lines_instead_of_accepting_them_as_complete() {
        let root = std::env::temp_dir().join(format!(
            "zicode-http-audit-blank-line-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let audit_path = root.join("audit/http-services.jsonl");
        fs::create_dir_all(audit_path.parent().unwrap()).unwrap();
        let invalid = b"{\"phase\":\"request_started\"}\n\n";
        fs::write(&audit_path, invalid).unwrap();

        let writer = AuditWriter::new(root.clone()).unwrap();
        assert_eq!(
            fs::read(audit_path.with_extension("jsonl.1")).unwrap(),
            invalid
        );
        assert!(!audit_path.exists());
        drop(writer);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_audit_isolation_keeps_the_current_file_intact() {
        let root = std::env::temp_dir().join(format!(
            "zicode-http-audit-recovery-blocked-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let audit_path = root.join("audit/http-services.jsonl");
        fs::create_dir_all(audit_path.parent().unwrap()).unwrap();
        let incomplete = b"{\"phase\":\"request_started\"";
        fs::write(&audit_path, incomplete).unwrap();
        fs::create_dir(audit_path.with_extension("jsonl.1")).unwrap();

        assert!(AuditWriter::new(root.clone()).is_err());
        assert_eq!(fs::read(&audit_path).unwrap(), incomplete);
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn host_routes_confirm_then_fetch_and_persist_audit_events() {
        let root = std::env::temp_dir().join(format!(
            "zicode-http-host-e2e-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let public = root.join("public");
        let workspace = root.join("workspace");
        let source = root.join("plugin-source");
        fs::create_dir_all(&public).unwrap();
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(source.join("runtime")).unwrap();
        fs::write(public.join("index.html"), "host http service fixture").unwrap();
        fs::write(source.join("runtime/tools.wasm"), b"fixture").unwrap();
        fs::write(
            source.join("plugin.json"),
            serde_json::to_vec(&json!({
                "schemaVersion": 2,
                "id": "com.example.http-host-e2e",
                "name": "HTTP Host E2E",
                "description": "Host route conformance fixture",
                "version": "1.0.0",
                "publisher": "example",
                "engines": { "zicode": ">=0.1.0 <1.0.0", "pluginApi": "^1.0.0" },
                "runtime": { "wasi": "runtime/tools.wasm" },
                "requiredProfiles": { "service.http.get.v1": format!("={PROFILE_VERSION}") },
                "permissions": {
                    "required": [],
                    "optional": [{ "name": "service.http.read", "reason": "Read an explicitly confirmed service endpoint" }]
                },
                "contributes": { "commands": [{ "id": "httpHost.run", "title": "Run" }] }
            }))
            .unwrap(),
        )
        .unwrap();

        let workspace_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let session_id = "session-http-host-e2e";
        let runtime_id = "instance-http-host-e2e";
        let plugin_id = "com.example.http-host-e2e";
        let target = RuntimeTarget::new(workspace_id, session_id, runtime_id);
        let runtimes = NativePiManager::new(32);
        let fake = runtimes.register_in_memory(target).unwrap();
        let metadata = MetadataStore::open(&root.join("picot.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let host = HostServer::start_with_mode(
            public,
            runtimes,
            auth,
            HashMap::from([(workspace_id.to_owned(), workspace)]),
            HostMode::IsolatedDesktop,
        )
        .await
        .unwrap();
        {
            let mut registry = host.state.plugins.lock().unwrap();
            registry.install_developer(&source).unwrap();
            registry
                .set_enabled("programming", plugin_id, true)
                .unwrap();
            registry
                .set_permission("programming", plugin_id, "service.http.read", true)
                .unwrap();
        }

        let listener = tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let operation_id = uuid::Uuid::new_v4().to_string();
        let owner = json!({
            "schemaVersion": 1,
            "workspaceId": workspace_id,
            "runtimeId": runtime_id,
            "sessionId": session_id,
            "pluginId": plugin_id
        });
        let prepared = client
            .post(format!(
                "{}/v2/plugin-services/http-get/prepare",
                host.origin()
            ))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&json!({
                "schemaVersion": owner["schemaVersion"],
                "workspaceId": workspace_id,
                "runtimeId": runtime_id,
                "sessionId": session_id,
                "pluginId": plugin_id,
                "origin": format!("http://{address}"),
                "endpoint": "health",
                "operationId": operation_id
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(prepared.status(), reqwest::StatusCode::OK);
        let prepared: Value = prepared.json().await.unwrap();
        assert_eq!(prepared["display"]["endpoint"], "health");
        assert!(
            tokio::time::timeout(Duration::from_millis(50), listener.accept())
                .await
                .is_err()
        );
        let (request_accepted_tx, request_accepted_rx) = tokio::sync::oneshot::channel();
        let (write_response_tx, write_response_rx) = tokio::sync::oneshot::channel();
        let (tls_rejected_tx, tls_rejected_rx) = tokio::sync::oneshot::channel();
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        let ca = crate::remote_tls::generate_ca().unwrap();
        let identity = crate::remote_tls::issue_server_identity(
            &ca,
            [
                IpAddr::V4(Ipv4Addr::new(192, 168, 1, 20)),
                IpAddr::V4(Ipv4Addr::LOCALHOST),
            ],
        )
        .unwrap();
        let tls_config = axum_server::tls_rustls::RustlsConfig::from_pem(
            identity.certificate_chain_pem,
            identity.private_key_pem,
        )
        .await
        .unwrap();
        let tls_acceptor = tokio_rustls::TlsAcceptor::from(tls_config.get_inner());

        let fixture = tokio::spawn(async move {
            let too_deep_json = format!("{}0{}", "[".repeat(34), "]".repeat(34));
            let responses = vec![
                (
                    "200 OK".to_owned(),
                    br#"{"status":"UP"}"#.to_vec(),
                    None,
                    None,
                ),
                (
                    "503 Service Unavailable".to_owned(),
                    br#"{"status":"DOWN"}"#.to_vec(),
                    None,
                    None,
                ),
                (
                    "302 Found".to_owned(),
                    br#"{"redirected":true}"#.to_vec(),
                    Some(format!("http://{address}/actuator/health")),
                    None,
                ),
                (
                    "200 OK".to_owned(),
                    b"{}".to_vec(),
                    None,
                    Some((MAX_RESPONSE_BYTES + 1) as u64),
                ),
                ("200 OK".to_owned(), too_deep_json.into_bytes(), None, None),
            ];
            for (status, body, location, declared_length) in responses {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = [0u8; 4096];
                let _ = stream.read(&mut request).await.unwrap();
                let request = String::from_utf8_lossy(&request);
                assert!(request.starts_with("GET /actuator/health HTTP/1.1\r\n"));
                let location_header = location
                    .map(|value| format!("Location: {value}\r\n"))
                    .unwrap_or_default();
                let content_length = declared_length.unwrap_or(body.len() as u64);
                let headers = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {content_length}\r\n{location_header}Connection: close\r\n\r\n"
                );
                stream.write_all(headers.as_bytes()).await.unwrap();
                stream.write_all(&body).await.unwrap();
            }
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 4096];
            let _ = stream.read(&mut request).await.unwrap();
            let request = String::from_utf8_lossy(&request);
            assert!(request.starts_with("GET /actuator/health HTTP/1.1\r\n"));
            let body = vec![b'a'; MAX_RESPONSE_BYTES + 1];
            let headers = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n";
            let chunk_len = body.len();
            let chunk_header = format!("{chunk_len:X}\r\n");
            let _ = stream.write_all(headers).await;
            let _ = stream.write_all(chunk_header.as_bytes()).await;
            let _ = stream.write_all(&body).await;
            let _ = stream.write_all(b"\r\n0\r\n\r\n").await;
            let (stream, _) = listener.accept().await.unwrap();
            match tls_acceptor.accept(stream).await {
                Ok(mut stream) => {
                    let mut request = [0u8; 4096];
                    match stream.read(&mut request).await {
                        Ok(0) | Err(_) => tls_rejected_tx.send(true).unwrap(),
                        Ok(_) => tls_rejected_tx.send(false).unwrap(),
                    }
                }
                Err(_) => tls_rejected_tx.send(true).unwrap(),
            }
            let (stream, _) = listener.accept().await.unwrap();
            let mut stream = tls_acceptor.accept(stream).await.unwrap();
            let mut request = [0u8; 4096];
            let length = stream.read(&mut request).await.unwrap();
            assert!(String::from_utf8_lossy(&request[..length])
                .starts_with("GET /actuator/health HTTP/1.1\r\n"));
            let body = br#"{"status":"UP"}"#;
            let headers = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(headers.as_bytes()).await.unwrap();
            stream.write_all(body).await.unwrap();
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 4096];
            let _ = stream.read(&mut request).await.unwrap();
            let request = String::from_utf8_lossy(&request);
            assert!(request.starts_with("GET /actuator/health HTTP/1.1\r\n"));
            request_accepted_tx.send(()).unwrap();
            let _ = write_response_rx.await;
            let body = br#"{"status":"UP"}"#;
            let headers = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(headers.as_bytes()).await;
            let _ = stream.write_all(body).await;
        });
        let mut grant_id = prepared["grantId"].clone();
        let mut operation_id = operation_id;
        for (index, (expected_status, expected_result, expected_error)) in [
            (reqwest::StatusCode::OK, Some((200, "UP")), None),
            (reqwest::StatusCode::OK, Some((503, "DOWN")), None),
            (
                reqwest::StatusCode::FORBIDDEN,
                None,
                Some("http_service_redirect_blocked"),
            ),
            (
                reqwest::StatusCode::PAYLOAD_TOO_LARGE,
                None,
                Some("http_service_response_too_large"),
            ),
            (
                reqwest::StatusCode::PAYLOAD_TOO_LARGE,
                None,
                Some("http_service_json_complexity_exceeded"),
            ),
            (
                reqwest::StatusCode::PAYLOAD_TOO_LARGE,
                None,
                Some("http_service_response_too_large"),
            ),
        ]
        .into_iter()
        .enumerate()
        {
            if index > 0 {
                operation_id = uuid::Uuid::new_v4().to_string();
                let next = client
                    .post(format!(
                        "{}/v2/plugin-services/http-get/prepare",
                        host.origin()
                    ))
                    .header("x-zicode-desktop-token", host.desktop_token())
                    .json(&json!({
                        "schemaVersion": 1,
                        "workspaceId": workspace_id,
                        "runtimeId": runtime_id,
                        "sessionId": session_id,
                        "pluginId": plugin_id,
                        "origin": format!("http://{address}"),
                        "endpoint": "health",
                        "operationId": operation_id
                    }))
                    .send()
                    .await
                    .unwrap();
                assert_eq!(next.status(), reqwest::StatusCode::OK);
                grant_id = next.json::<Value>().await.unwrap()["grantId"].clone();
            }
            let committed = client
                .post(format!(
                    "{}/v2/plugin-services/http-get/commit",
                    host.origin()
                ))
                .header("x-zicode-desktop-token", host.desktop_token())
                .json(&json!({
                    "schemaVersion": 1,
                    "workspaceId": workspace_id,
                    "runtimeId": runtime_id,
                    "sessionId": session_id,
                    "pluginId": plugin_id,
                    "grantId": grant_id,
                    "operationId": operation_id,
                    "confirmed": true
                }))
                .send()
                .await
                .unwrap();
            assert_eq!(committed.status(), expected_status);
            if let Some((service_status, health)) = expected_result {
                let body: Value = committed.json().await.unwrap();
                assert_eq!(body["result"]["status"], service_status);
                assert_eq!(body["result"]["data"]["status"], health);
            } else if let Some(expected_error) = expected_error {
                let body: Value = committed.json().await.unwrap();
                assert_eq!(body["error"]["code"], expected_error);
            }
        }

        let tls_operation_id = uuid::Uuid::new_v4().to_string();
        let tls_prepare = client
            .post(format!(
                "{}/v2/plugin-services/http-get/prepare",
                host.origin()
            ))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&json!({
                "schemaVersion": 1,
                "workspaceId": workspace_id,
                "runtimeId": runtime_id,
                "sessionId": session_id,
                "pluginId": plugin_id,
                "origin": format!("https://{address}"),
                "endpoint": "health",
                "operationId": tls_operation_id
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(tls_prepare.status(), reqwest::StatusCode::OK);
        let tls_grant_id = tls_prepare.json::<Value>().await.unwrap()["grantId"].clone();
        let tls_commit = client
            .post(format!(
                "{}/v2/plugin-services/http-get/commit",
                host.origin()
            ))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&json!({
                "schemaVersion": 1,
                "workspaceId": workspace_id,
                "runtimeId": runtime_id,
                "sessionId": session_id,
                "pluginId": plugin_id,
                "grantId": tls_grant_id,
                "operationId": tls_operation_id,
                "confirmed": true
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(tls_commit.status(), reqwest::StatusCode::BAD_GATEWAY);
        let tls_error: Value = tls_commit.json().await.unwrap();
        assert_eq!(tls_error["error"]["code"], "http_service_request_failed");
        assert!(tls_rejected_rx.await.unwrap());

        let trusted_tls_operation_id = uuid::Uuid::new_v4().to_string();
        let trusted_tls_prepare = client
            .post(format!(
                "{}/v2/plugin-services/http-get/prepare",
                host.origin()
            ))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&json!({
                "schemaVersion": 1,
                "workspaceId": workspace_id,
                "runtimeId": runtime_id,
                "sessionId": session_id,
                "pluginId": plugin_id,
                "origin": format!("https://{address}"),
                "endpoint": "health",
                "operationId": trusted_tls_operation_id
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(trusted_tls_prepare.status(), reqwest::StatusCode::OK);
        let trusted_tls_grant_id = trusted_tls_prepare.json::<Value>().await.unwrap()["grantId"]
            .as_str()
            .unwrap()
            .to_owned();
        host.state
            .http_get_grants
            .lock()
            .unwrap()
            .trusted_root_certificates
            .push(reqwest::Certificate::from_pem(ca.certificate_pem.as_bytes()).unwrap());
        let trusted_tls_commit = client
            .post(format!(
                "{}/v2/plugin-services/http-get/commit",
                host.origin()
            ))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&json!({
                "schemaVersion": 1,
                "workspaceId": workspace_id,
                "runtimeId": runtime_id,
                "sessionId": session_id,
                "pluginId": plugin_id,
                "grantId": trusted_tls_grant_id,
                "operationId": trusted_tls_operation_id,
                "confirmed": true
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(trusted_tls_commit.status(), reqwest::StatusCode::OK);
        let trusted_tls_result: Value = trusted_tls_commit.json().await.unwrap();
        assert_eq!(trusted_tls_result["result"]["status"], 200);
        assert_eq!(trusted_tls_result["result"]["data"]["status"], "UP");

        let cancel_operation_id = uuid::Uuid::new_v4().to_string();
        let cancel_prepare = client
            .post(format!(
                "{}/v2/plugin-services/http-get/prepare",
                host.origin()
            ))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&json!({
                "schemaVersion": 1,
                "workspaceId": workspace_id,
                "runtimeId": runtime_id,
                "sessionId": session_id,
                "pluginId": plugin_id,
                "origin": format!("http://{address}"),
                "endpoint": "health",
                "operationId": cancel_operation_id
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(cancel_prepare.status(), reqwest::StatusCode::OK);
        let cancel_grant_id = cancel_prepare.json::<Value>().await.unwrap()["grantId"].clone();
        let commit_client = client.clone();
        let commit_origin = host.origin().to_owned();
        let commit_token = host.desktop_token().to_owned();
        let commit_operation_id = cancel_operation_id.clone();
        let commit_workspace_id = workspace_id.to_owned();
        let commit_runtime_id = runtime_id.to_owned();
        let commit_session_id = session_id.to_owned();
        let commit_plugin_id = plugin_id.to_owned();
        let commit = tokio::spawn(async move {
            commit_client
                .post(format!(
                    "{commit_origin}/v2/plugin-services/http-get/commit"
                ))
                .header("x-zicode-desktop-token", commit_token)
                .json(&json!({
                    "schemaVersion": 1,
                    "workspaceId": commit_workspace_id,
                    "runtimeId": commit_runtime_id,
                    "sessionId": commit_session_id,
                    "pluginId": commit_plugin_id,
                    "grantId": cancel_grant_id,
                    "operationId": commit_operation_id,
                    "confirmed": true
                }))
                .send()
                .await
                .unwrap()
        });
        request_accepted_rx.await.unwrap();
        let cancelled = client
            .post(format!(
                "{}/v2/plugin-services/http-get/cancel",
                host.origin()
            ))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&json!({
                "schemaVersion": 1,
                "workspaceId": workspace_id,
                "runtimeId": runtime_id,
                "sessionId": session_id,
                "pluginId": plugin_id,
                "operationId": cancel_operation_id
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(cancelled.status(), reqwest::StatusCode::OK);
        let cancelled: Value = cancelled.json().await.unwrap();
        assert_eq!(cancelled["status"], "requested");
        assert_eq!(cancelled["executionFinished"], false);
        write_response_tx.send(()).unwrap();
        let cancelled_commit = commit.await.unwrap();
        assert_eq!(cancelled_commit.status(), reqwest::StatusCode::CONFLICT);
        let cancellation_error: Value = cancelled_commit.json().await.unwrap();
        assert_eq!(
            cancellation_error["error"]["code"],
            "http_service_request_cancelled"
        );
        fixture.await.unwrap();
        let audit_path = root.join("test-plugin-registry/audit/http-services.jsonl");
        let audit: Vec<Value> = fs::read_to_string(&audit_path)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(audit.len(), 28);
        for (index, outcome) in [
            "succeeded",
            "succeeded",
            "failed",
            "failed",
            "failed",
            "failed",
            "failed",
            "succeeded",
        ]
        .into_iter()
        .enumerate()
        {
            let offset = index * 3;
            assert_eq!(audit[offset]["phase"], "consent_prepared");
            assert_eq!(audit[offset + 1]["phase"], "request_started");
            assert_eq!(audit[offset + 2]["phase"], "request_completed");
            assert_eq!(audit[offset + 2]["outcome"], outcome);
        }
        assert_eq!(audit[8]["errorCode"], "http_service_redirect_blocked");
        assert_eq!(audit[11]["errorCode"], "http_service_response_too_large");
        assert_eq!(
            audit[14]["errorCode"],
            "http_service_json_complexity_exceeded"
        );
        assert_eq!(audit[17]["errorCode"], "http_service_response_too_large");
        assert_eq!(audit[20]["errorCode"], "http_service_request_failed");
        assert_eq!(audit[23]["httpStatus"], 200);
        assert_eq!(audit[23]["outcome"], "succeeded");
        let cancellation_audit: Vec<&Value> = audit
            .iter()
            .filter(|event| event["operationId"] == cancel_operation_id)
            .collect();
        assert_eq!(cancellation_audit.len(), 4);
        assert!(cancellation_audit
            .iter()
            .any(|event| event["phase"] == "cancel_requested" && event["outcome"] == "requested"));
        let completed = cancellation_audit
            .iter()
            .find(|event| event["phase"] == "request_completed")
            .unwrap();
        assert_eq!(completed["outcome"], "failed");
        assert_eq!(completed["errorCode"], "http_service_request_cancelled");
        assert!(audit
            .iter()
            .all(|event| event.get("responseBody").is_none()));

        // The response body is already available when the completion audit
        // fails. The Host must report that failure without publishing a new
        // cross-tool result that the caller never received.
        let result_count = host.state.plugin_results.lock().unwrap().record_count();
        let fault_listener =
            tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
                .await
                .unwrap();
        let fault_address = fault_listener.local_addr().unwrap();
        let fault_operation_id = uuid::Uuid::new_v4().to_string();
        let fault_prepare = client
            .post(format!(
                "{}/v2/plugin-services/http-get/prepare",
                host.origin()
            ))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&json!({
                "schemaVersion":1,
                "workspaceId":workspace_id,
                "runtimeId":runtime_id,
                "sessionId":session_id,
                "pluginId":plugin_id,
                "origin":format!("http://{fault_address}"),
                "endpoint":"health",
                "operationId":fault_operation_id
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(fault_prepare.status(), reqwest::StatusCode::OK);
        let fault_grant_id = fault_prepare.json::<Value>().await.unwrap()["grantId"].clone();
        let fault_audit_path = audit_path.clone();
        let audit_backup = audit_path.with_file_name("http-services-fault-backup.jsonl");
        let fault_backup = audit_backup.clone();
        let fault_server = tokio::spawn(async move {
            let (mut stream, _) = fault_listener.accept().await.unwrap();
            let mut request = [0u8; 4096];
            let length = stream.read(&mut request).await.unwrap();
            assert!(String::from_utf8_lossy(&request[..length])
                .starts_with("GET /actuator/health HTTP/1.1\r\n"));
            // request_started was written before the connection. Make only
            // request_completed fail, then restore the audit file afterward.
            fs::rename(&fault_audit_path, &fault_backup).unwrap();
            fs::create_dir(&fault_audit_path).unwrap();
            let body = br#"{"status":"UP"}"#;
            let headers = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(headers.as_bytes()).await.unwrap();
            stream.write_all(body).await.unwrap();
        });
        let fault_commit = client
            .post(format!(
                "{}/v2/plugin-services/http-get/commit",
                host.origin()
            ))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&json!({
                "schemaVersion":1,
                "workspaceId":workspace_id,
                "runtimeId":runtime_id,
                "sessionId":session_id,
                "pluginId":plugin_id,
                "grantId":fault_grant_id,
                "operationId":fault_operation_id,
                "confirmed":true
            }))
            .send()
            .await
            .unwrap();
        fault_server.await.unwrap();
        assert_eq!(
            fault_commit.status(),
            reqwest::StatusCode::SERVICE_UNAVAILABLE
        );
        let fault_error: Value = fault_commit.json().await.unwrap();
        assert_eq!(
            fault_error["error"]["code"],
            "http_service_audit_unavailable"
        );
        assert_eq!(
            host.state.plugin_results.lock().unwrap().record_count(),
            result_count
        );
        fs::remove_dir(&audit_path).unwrap();
        fs::rename(&audit_backup, &audit_path).unwrap();
        let fault_audit: Vec<Value> = fs::read_to_string(&audit_path)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(fault_audit.len(), audit.len() + 2);
        assert_eq!(fault_audit.last().unwrap()["phase"], "request_started");

        host.stop_and_wait().await.unwrap();
        drop(fake);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn maps_only_fixed_actuator_endpoints() {
        assert_eq!(Endpoint::Health.path(), "/actuator/health");
        assert_eq!(Endpoint::Info.path(), "/actuator/info");
        assert_eq!(Endpoint::Metrics.path(), "/actuator/metrics");
        for endpoint in ["env", "configprops", "shutdown", "", "../health"] {
            assert!(serde_json::from_value::<Endpoint>(json!(endpoint)).is_err());
        }
    }

    #[test]
    fn rejects_non_origin_urls_and_credentials_without_network_access() {
        for origin in [
            "https://user@example.com",
            "https://example.com/base",
            "https://example.com?x=1",
            "https://example.com#fragment",
            "file:///tmp/service",
        ] {
            assert!(parse_origin(origin).is_err(), "{origin}");
        }
        assert!(parse_origin("https://example.com:8443").is_ok());
    }

    #[test]
    fn classifies_only_public_private_and_loopback_addresses() {
        assert_eq!(classify_ip("127.0.0.1".parse().unwrap()), Some("loopback"));
        assert_eq!(classify_ip("10.1.2.3".parse().unwrap()), Some("private"));
        assert_eq!(classify_ip("169.254.169.254".parse().unwrap()), None);
        assert_eq!(classify_ip("224.0.0.1".parse().unwrap()), None);
        assert_eq!(classify_ip("::1".parse().unwrap()), Some("loopback"));
        assert_eq!(
            classify_ip("::ffff:127.0.0.1".parse().unwrap()),
            Some("loopback")
        );
        assert_eq!(classify_ip("::ffff:169.254.169.254".parse().unwrap()), None);
        assert_eq!(classify_ip("fc00::1".parse().unwrap()), Some("private"));
        assert_eq!(classify_ip("fe80::1".parse().unwrap()), None);
    }

    #[test]
    fn classifies_dns_names_without_resolving_them() {
        assert_eq!(
            display_address_class("metrics.example.test").unwrap(),
            "hostname"
        );
        assert_eq!(display_address_class("localhost").unwrap(), "loopback");
        assert_eq!(
            display_address_class("actuator.localhost").unwrap(),
            "loopback"
        );
        assert_eq!(display_address_class("10.20.30.40").unwrap(), "private");
        assert_eq!(display_address_class("127.0.0.1").unwrap(), "loopback");
        assert!(display_address_class("169.254.169.254").is_err());
    }

    #[tokio::test]
    async fn cancellation_before_fetch_prevents_dns_resolution() {
        let cancellation = CancellationToken::new();
        cancellation.cancel();

        let failure = fetch_json(
            "https://cancel-before-dns.invalid",
            Endpoint::Health,
            "hostname",
            cancellation,
            Vec::new(),
        )
        .await
        .unwrap_err();

        assert_eq!(failure.code, "http_service_request_cancelled");
        assert_eq!(failure.http_status, None);
    }

    #[test]
    fn invalidating_one_plugin_preserves_other_plugins_grants_and_operations() {
        let owner = |plugin_id: &str| Owner {
            workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".to_owned(),
            runtime_id: format!("runtime-{plugin_id}"),
            session_id: format!("session-{plugin_id}"),
            plugin_id: plugin_id.to_owned(),
        };
        let mut grants = Grants::default();
        let revoked = owner("com.example.revoked");
        let retained = owner("com.example.retained");
        let revoked_token = grants.start("operation-revoked", &revoked).unwrap();
        let retained_token = grants.start("operation-retained", &retained).unwrap();
        let pending_grant = |owner: Owner, operation_id: &str| Grant {
            owner,
            scene: "programming".to_owned(),
            endpoint: Endpoint::Health,
            origin: "http://127.0.0.1".to_owned(),
            address_class: "loopback",
            expires: Instant::now() + GRANT_TTL,
            revision: 0,
            generation: 0,
            operation_id: operation_id.to_owned(),
        };
        grants.pending.insert(
            "grant-revoked".to_owned(),
            pending_grant(revoked.clone(), "operation-revoked"),
        );
        grants.pending.insert(
            "grant-retained".to_owned(),
            pending_grant(retained.clone(), "operation-retained"),
        );

        grants.invalidate_plugin("com.example.revoked");

        assert!(revoked_token.is_cancelled());
        assert!(!retained_token.is_cancelled());
        assert!(!grants.pending.contains_key("grant-revoked"));
        assert!(grants.pending.contains_key("grant-retained"));
        assert_eq!(grants.revision_for("com.example.revoked"), 1);
        assert_eq!(grants.revision_for("com.example.retained"), 0);
        assert!(grants.token("operation-retained", &retained).is_ok());
    }
}

#[cfg(test)]
#[path = "http_get_revocation_host_tests.rs"]
mod revocation_host_tests;

#[cfg(test)]
#[path = "http_get_audit_startup_host_tests.rs"]
mod audit_startup_host_tests;

#[cfg(test)]
#[path = "spring_actuator_candidate_host_tests.rs"]
mod spring_actuator_candidate_host_tests;
