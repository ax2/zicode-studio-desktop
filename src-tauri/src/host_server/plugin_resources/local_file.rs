//! Desktop-only, one-use local-file snapshot grants. No paths cross into a Worker.
use super::*;
use std::path::{Path, PathBuf};
mod files;
#[cfg(test)]
mod tests;
const MAX_BYTES: usize = 32 * 1024 * 1024;
const TTL: Duration = Duration::from_secs(120);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct PrepareFile {
    schema_version: u32,
    owner: Owner,
    relative_path: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct FileGrant {
    schema_version: u32,
    owner: Owner,
    grant_id: String,
    #[serde(default)]
    confirmed: bool,
}
struct Grant {
    owner: Owner,
    proof: String,
    root: PathBuf,
    relative: String,
    stamp: String,
    expires: Instant,
}
#[derive(Default)]
pub(super) struct Grants(HashMap<String, Grant>);
impl Grants {
    fn prune(&mut self) {
        self.0.retain(|_, g| g.expires > Instant::now());
    }
    fn insert(&mut self, grant: Grant) -> Result<String, ApiError> {
        self.prune();
        if self.0.len() >= 32
            || self
                .0
                .values()
                .filter(|g| g.owner.runtime_id == grant.owner.runtime_id)
                .count()
                >= 8
        {
            return Err(rejected("resource_file_grant_budget_exceeded"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        self.0.insert(id.clone(), grant);
        Ok(id)
    }
    fn take(&mut self, request: &FileGrant) -> Result<Grant, ApiError> {
        self.prune();
        if !self
            .0
            .get(&request.grant_id)
            .is_some_and(|g| g.owner == request.owner)
        {
            return Err(rejected("resource_file_grant_unavailable"));
        }
        self.0
            .remove(&request.grant_id)
            .ok_or_else(|| rejected("resource_file_grant_unavailable"))
    }
}

fn scope(state: &HostState, owner: &Owner) -> Result<(PathBuf, String), ApiError> {
    // Reuse current package/module, permission, runtime/session and Broker generation binding.
    let (proof, _) = transfer::target_identity(state, owner)?;
    let target = state
        .runtimes
        .statuses()
        .map_err(|_| rejected("runtime_unavailable"))?
        .into_iter()
        .find(|s| {
            s.target.instance_id == owner.runtime_id && s.target.session_id == owner.session_id
        })
        .ok_or_else(|| rejected("runtime_stopped"))?
        .target;
    let root = state
        .data
        .workspace_roots()
        .read()
        .map_err(|_| rejected("workspace_unavailable"))?
        .get(&target.workspace_id)
        .cloned()
        .ok_or_else(|| rejected("workspace_unavailable"))?;
    let root = root
        .canonicalize()
        .map_err(|_| rejected("workspace_unavailable"))?;
    Ok((root, proof))
}
fn schema(version: u32) -> Result<(), ApiError> {
    if version != 1 {
        return Err(rejected("resource_schema_unsupported"));
    }
    Ok(())
}

pub(in crate::host_server) async fn prepare(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<PrepareFile>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    schema(request.schema_version)?;
    files::components(&request.relative_path)?;
    blocking(state.clone(), move || {
        let (root, proof) = scope(&state, &request.owner)?;
        let file = files::open(&root, &request.relative_path)?;
        let (stamp, length) = files::stamp(&file)?;
        drop(file); // No content read and no file handle retained while awaiting consent.
        if scope(&state, &request.owner)? != (root.clone(), proof.clone()) { return Err(rejected("resource_authorization_changed")); }
        let grant = Grant { owner: request.owner.clone(), proof, root, relative: request.relative_path.clone(), stamp, expires: Instant::now() + TTL };
        let id = state.plugin_resources.lock().map_err(|_| rejected("resource_store_unavailable"))?.file_imports.insert(grant)?;
        Ok(json!({"schemaVersion":1,"profile":"resource.local-file.draft1","grantId":id,"owner":request.owner,
            "relativePath":request.relative_path,"byteLength":length,"expiresInSeconds":120,"contentRead":false,"confirmed":false}))
    }).await
}

pub(in crate::host_server) async fn commit(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<FileGrant>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    schema(request.schema_version)?;
    if !request.confirmed {
        return Err(rejected("resource_confirmation_required"));
    }
    blocking(state.clone(), move || {
        // Consume before reading; failures never authorize automatic retry or replay.
        let grant = state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?
            .file_imports
            .take(&request)?;
        let expected = (grant.root.clone(), grant.proof.clone());
        if scope(&state, &request.owner)? != expected {
            return Err(rejected("resource_authorization_changed"));
        }
        let bytes = files::snapshot(&grant.root, &grant.relative, &grant.stamp)?;
        if scope(&state, &request.owner)? != expected {
            return Err(rejected("resource_authorization_changed"));
        }
        state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?
            .import_file(request.owner, grant.proof, bytes)
    })
    .await
}

pub(in crate::host_server) async fn cancel(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<FileGrant>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    schema(request.schema_version)?;
    blocking(state.clone(), move || {
        // Cancellation remains possible after permissions/session stop; it never reads content.
        state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?
            .file_imports
            .take(&request)?;
        Ok(json!({"schemaVersion":1,"cancelled":true,"contentRead":false}))
    })
    .await
}
