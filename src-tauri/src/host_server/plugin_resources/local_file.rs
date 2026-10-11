//! Desktop-only, one-use local-file snapshot grants. No paths cross into a Worker.
use super::*;
use std::path::{Path, PathBuf};
#[cfg(test)]
mod cancellation_http;
mod files;
mod reading;
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
pub(super) struct Grants(HashMap<String, Grant>, HashMap<String, reading::Active>);
impl Grants {
    fn prune(&mut self) {
        self.0.retain(|_, g| g.expires > Instant::now());
    }
    fn insert(&mut self, grant: Grant) -> Result<String, ApiError> {
        self.prune();
        if self.0.len() + self.1.len() >= 32
            || self
                .0
                .values()
                .filter(|g| g.owner.runtime_id == grant.owner.runtime_id)
                .count()
                + self
                    .1
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

    fn begin(&mut self, request: &FileGrant) -> Result<(Grant, Arc<reading::Control>), ApiError> {
        let grant = self.take(request)?;
        let control = Arc::new(reading::Control::new(grant.expires));
        self.1.insert(
            request.grant_id.clone(),
            reading::Active {
                owner: request.owner.clone(),
                control: control.clone(),
            },
        );
        Ok((grant, control))
    }

    fn cancel(&mut self, request: &FileGrant) -> Result<Value, ApiError> {
        if let Some(active) = self.1.get(&request.grant_id) {
            if active.owner != request.owner {
                return Err(rejected("resource_file_grant_unavailable"));
            }
            active.control.cancel();
            return Ok(
                json!({"schemaVersion":1,"cancelled":false,"cancellationRequested":true,
                "executionFinished":false,"contentRead":null}),
            );
        }
        self.take(request)?;
        Ok(
            json!({"schemaVersion":1,"cancelled":true,"cancellationRequested":true,
            "executionFinished":true,"contentRead":false}),
        )
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
        let (grant, control) = state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?
            .file_imports
            .begin(&request)?;
        let _lease = reading::Lease {
            state: state.clone(),
            id: request.grant_id.clone(),
        };
        let expected = (grant.root.clone(), grant.proof.clone());
        if scope(&state, &request.owner)? != expected {
            return Err(rejected("resource_authorization_changed"));
        }
        let bytes =
            files::snapshot_controlled(&grant.root, &grant.relative, &grant.stamp, &control)?;
        if scope(&state, &request.owner)? != expected {
            return Err(rejected("resource_authorization_changed"));
        }
        let mut store = state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?;
        // Serialize publication with cancellation. A request after publication cannot
        // revoke a resource by grant ID; the explicit resource revoke API owns that.
        control.check()?;
        let result = store.import_file(request.owner, grant.proof, bytes);
        store.file_imports.1.remove(&request.grant_id);
        result
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
    // This metadata-only control path must remain available when all eight
    // blocking resource operation slots are occupied. No OS access or wait queue.
    let result = state
        .plugin_resources
        .lock()
        .map_err(|_| rejected("resource_store_unavailable"))?
        .file_imports
        .cancel(&request)?;
    Ok(Json(result))
}
