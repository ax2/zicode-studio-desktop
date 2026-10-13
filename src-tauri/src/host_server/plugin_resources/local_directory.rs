//! Explicit, one-use, read-only directory metadata snapshots for a trusted desktop UI.
//! No absolute path or directory handle reaches a plugin Worker.
use super::*;
use cap_std::ambient_authority;
use cap_std::fs::Dir;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

const TTL: Duration = Duration::from_secs(120);
const MAX_ENTRIES: usize = 4096;
const MAX_SNAPSHOT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct PrepareDirectory {
    schema_version: u32,
    owner: Owner,
    relative_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct DirectoryGrantRequest {
    schema_version: u32,
    owner: Owner,
    grant_id: String,
    #[serde(default)]
    confirmed: bool,
}

struct Grant {
    owner: Owner,
    root: PathBuf,
    relative: String,
    proof: String,
    registry_revision: String,
    stamp: String,
    expires: Instant,
}

struct Control {
    cancelled: AtomicBool,
    outcome: AtomicU8,
    deadline: Instant,
}

impl Control {
    fn new(expires: Instant) -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            outcome: AtomicU8::new(0),
            deadline: expires.min(Instant::now() + Duration::from_secs(30)),
        }
    }
    fn check(&self) -> Result<(), ApiError> {
        if self.cancelled.load(Ordering::Acquire) {
            self.outcome.store(2, Ordering::Release);
            return Err(rejected("resource_directory_cancelled"));
        }
        if Instant::now() >= self.deadline {
            self.outcome.store(3, Ordering::Release);
            return Err(rejected("resource_directory_timeout"));
        }
        Ok(())
    }
    fn cancel(&self) -> bool {
        if self.outcome.load(Ordering::Acquire) == 1 {
            return false;
        }
        self.cancelled.store(true, Ordering::Release);
        true
    }
    fn published(&self) {
        self.outcome.store(1, Ordering::Release);
    }
}

struct Active {
    owner: Owner,
    control: Arc<Control>,
}

#[derive(Default)]
pub(super) struct Grants {
    pending: HashMap<String, Grant>,
    active: HashMap<String, Active>,
}

impl Grants {
    fn prune(&mut self) {
        self.pending
            .retain(|_, grant| grant.expires > Instant::now());
    }
    fn insert(&mut self, grant: Grant) -> Result<String, ApiError> {
        self.prune();
        if self.pending.len() + self.active.len() >= 32
            || self
                .pending
                .values()
                .filter(|item| item.owner.runtime_id == grant.owner.runtime_id)
                .count()
                + self
                    .active
                    .values()
                    .filter(|item| item.owner.runtime_id == grant.owner.runtime_id)
                    .count()
                >= 8
        {
            return Err(rejected("resource_directory_grant_budget_exceeded"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        self.pending.insert(id.clone(), grant);
        Ok(id)
    }
    fn take(&mut self, request: &DirectoryGrantRequest) -> Result<Grant, ApiError> {
        self.prune();
        if !self
            .pending
            .get(&request.grant_id)
            .is_some_and(|grant| grant.owner == request.owner)
        {
            return Err(rejected("resource_directory_grant_unavailable"));
        }
        self.pending
            .remove(&request.grant_id)
            .ok_or_else(|| rejected("resource_directory_grant_unavailable"))
    }
    fn begin(
        &mut self,
        request: &DirectoryGrantRequest,
    ) -> Result<(Grant, Arc<Control>), ApiError> {
        let grant = self.take(request)?;
        let control = Arc::new(Control::new(grant.expires));
        self.active.insert(
            request.grant_id.clone(),
            Active {
                owner: request.owner.clone(),
                control: control.clone(),
            },
        );
        Ok((grant, control))
    }
    fn cancel(&mut self, request: &DirectoryGrantRequest) -> Result<Value, ApiError> {
        if let Some(active) = self.active.get(&request.grant_id) {
            if active.owner != request.owner {
                return Err(rejected("resource_directory_grant_unavailable"));
            }
            let requested = active.control.cancel();
            return Ok(
                json!({"schemaVersion":1,"cancelled":false,"cancellationRequested":requested,
                "executionFinished":!requested}),
            );
        }
        self.take(request)?;
        Ok(
            json!({"schemaVersion":1,"cancelled":true,"cancellationRequested":true,"executionFinished":true}),
        )
    }
}

struct Lease {
    state: Arc<HostState>,
    id: String,
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut store) = self.state.plugin_resources.lock() {
            store.directory_imports.active.remove(&self.id);
        }
    }
}

fn authorize(state: &HostState, owner: &Owner) -> Result<(PathBuf, String, String), ApiError> {
    let (root, proof) = local_file::scope(state, owner)?;
    let scene = state
        .runtimes
        .statuses()
        .map_err(|_| rejected("runtime_unavailable"))?
        .into_iter()
        .find(|status| {
            status.target.instance_id == owner.runtime_id
                && status.target.session_id == owner.session_id
        })
        .ok_or_else(|| rejected("runtime_stopped"))?
        .target
        .scene_id;
    let registry = state
        .plugins
        .lock()
        .map_err(|_| rejected("registry_unavailable"))?;
    let plugin = registry
        .list(&scene)
        .into_iter()
        .find(|plugin| plugin.manifest.id == owner.plugin_id && plugin.enabled)
        .ok_or_else(|| rejected("resource_plugin_unavailable"))?;
    if !plugin
        .manifest
        .permissions
        .required
        .iter()
        .chain(&plugin.manifest.permissions.optional)
        .any(|permission| permission.name == "resource.directory.read")
    {
        return Err(rejected("resource_directory_profile_unsupported"));
    }
    if plugin.permission_grants.get("resource.directory.read") != Some(&true) {
        return Err(plugin_api_error(
            StatusCode::FORBIDDEN,
            "permission_denied",
            "",
        ));
    }
    Ok((root, proof, registry.manual_revision(&scene)))
}

fn validate_path(relative: &str) -> Result<(), ApiError> {
    if relative != "." {
        local_file::files::components(relative)?;
    }
    Ok(())
}

fn open_directory(root: &Path, relative: &str) -> Result<Dir, ApiError> {
    #[cfg(windows)]
    if !matches!(root.components().next(), Some(std::path::Component::Prefix(prefix))
        if matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
    {
        return Err(rejected("resource_directory_path_invalid"));
    }
    let base = Dir::open_ambient_dir(root, ambient_authority())
        .map_err(|_| rejected("resource_directory_unavailable"))?;
    let mut handles = vec![base];
    if relative != "." {
        for part in local_file::files::components(relative)? {
            let parent = handles.last().expect("root directory present");
            let meta = parent
                .symlink_metadata(part)
                .map_err(|_| rejected("resource_directory_unavailable"))?;
            if !meta.is_dir() || meta.file_type().is_symlink() {
                return Err(rejected("resource_directory_path_invalid"));
            }
            handles.push(
                parent
                    .open_dir(part)
                    .map_err(|_| rejected("resource_directory_unavailable"))?,
            );
        }
    }
    Ok(handles.pop().expect("root directory present"))
}

fn stamp(directory: &Dir) -> Result<String, ApiError> {
    let file = directory
        .try_clone()
        .map_err(|_| rejected("resource_directory_unavailable"))?
        .into_std_file();
    let meta = file
        .metadata()
        .map_err(|_| rejected("resource_directory_unavailable"))?;
    if !meta.is_dir() {
        return Err(rejected("resource_directory_path_invalid"));
    }
    #[cfg(windows)]
    let identity = {
        use std::os::windows::{fs::MetadataExt, io::AsRawHandle};
        use windows_sys::Win32::Storage::FileSystem::*;
        if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(rejected("resource_directory_path_invalid"));
        }
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
            return Err(rejected("resource_directory_unavailable"));
        }
        format!(
            "{}:{}:{}:{}:{}",
            info.dwVolumeSerialNumber,
            info.nFileIndexHigh,
            info.nFileIndexLow,
            meta.creation_time(),
            meta.last_write_time()
        )
    };
    #[cfg(unix)]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        format!(
            "{}:{}:{}:{}:{}:{}",
            meta.dev(),
            meta.ino(),
            meta.mtime(),
            meta.mtime_nsec(),
            meta.ctime(),
            meta.ctime_nsec()
        )
    };
    Ok(sha256_hex(identity.as_bytes()))
}

fn snapshot(
    directory: &Dir,
    expected: &str,
    control: &Control,
) -> Result<(Vec<u8>, usize), ApiError> {
    control.check()?;
    if stamp(directory)? != expected {
        return Err(rejected("resource_directory_changed"));
    }
    let mut entries = Vec::new();
    let mut folded = std::collections::HashSet::new();
    for entry in directory
        .entries()
        .map_err(|_| rejected("resource_directory_unavailable"))?
    {
        control.check()?;
        if entries.len() >= MAX_ENTRIES {
            return Err(rejected("resource_directory_budget_exceeded"));
        }
        let entry = entry.map_err(|_| rejected("resource_directory_unavailable"))?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| rejected("resource_directory_name_unsupported"))?;
        local_file::files::components(&name)
            .map_err(|_| rejected("resource_directory_name_unsupported"))?;
        if !folded.insert(name.to_lowercase()) {
            return Err(rejected("resource_directory_name_unsupported"));
        }
        let kind = entry
            .file_type()
            .map_err(|_| rejected("resource_directory_unavailable"))?;
        if kind.is_symlink() || !(kind.is_file() || kind.is_dir()) {
            return Err(rejected("resource_directory_entry_unsupported"));
        }
        entries.push(json!({"name":name,"kind":if kind.is_dir() { "directory" } else { "file" }}));
    }
    control.check()?;
    if stamp(directory)? != expected {
        return Err(rejected("resource_directory_changed"));
    }
    entries.sort_by(|left, right| left["name"].as_str().cmp(&right["name"].as_str()));
    let count = entries.len();
    let bytes = serde_json::to_vec(
        &json!({"schemaVersion":1,"profile":"resource.local-directory.draft1",
        "entries":entries}),
    )
    .map_err(|_| rejected("resource_directory_unavailable"))?;
    if bytes.len() > MAX_SNAPSHOT_BYTES {
        return Err(rejected("resource_directory_budget_exceeded"));
    }
    Ok((bytes, count))
}

pub(in crate::host_server) async fn prepare(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<PrepareDirectory>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    if request.schema_version != 1 {
        return Err(rejected("resource_schema_unsupported"));
    }
    validate_path(&request.relative_path)?;
    blocking(state.clone(), move || {
        let (root, proof, registry_revision) = authorize(&state, &request.owner)?;
        let directory = open_directory(&root, &request.relative_path)?;
        let directory_stamp = stamp(&directory)?;
        drop(directory);
        if authorize(&state, &request.owner)?
            != (root.clone(), proof.clone(), registry_revision.clone())
        {
            return Err(rejected("resource_authorization_changed"));
        }
        let grant = Grant {
            owner: request.owner.clone(),
            root,
            relative: request.relative_path.clone(),
            proof,
            registry_revision,
            stamp: directory_stamp,
            expires: Instant::now() + TTL,
        };
        let grant_id = state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?
            .directory_imports
            .insert(grant)?;
        Ok(
            json!({"schemaVersion":1,"profile":"resource.local-directory.draft1","grantId":grant_id,
            "owner":request.owner,"relativePath":request.relative_path,"entryNamesRead":false,
            "confirmed":false,"expiresInSeconds":120}),
        )
    })
    .await
}

pub(in crate::host_server) async fn commit(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<DirectoryGrantRequest>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    if request.schema_version != 1 {
        return Err(rejected("resource_schema_unsupported"));
    }
    if !request.confirmed {
        return Err(rejected("resource_confirmation_required"));
    }
    blocking(state.clone(), move || {
        let (grant, control) = state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?
            .directory_imports
            .begin(&request)?;
        let _lease = Lease {
            state: state.clone(),
            id: request.grant_id.clone(),
        };
        let expected = (
            grant.root.clone(),
            grant.proof.clone(),
            grant.registry_revision.clone(),
        );
        if authorize(&state, &request.owner)? != expected.clone() {
            return Err(rejected("resource_authorization_changed"));
        }
        let directory = open_directory(&grant.root, &grant.relative)?;
        let (bytes, count) = snapshot(&directory, &grant.stamp, &control)?;
        if authorize(&state, &request.owner)? != expected {
            return Err(rejected("resource_authorization_changed"));
        }
        let mut store = state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?;
        control.check()?;
        let mut result = store.import_directory(request.owner, grant.proof, bytes)?;
        control.published();
        result["entryCount"] = json!(count);
        Ok(result)
    })
    .await
}

pub(in crate::host_server) async fn cancel(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<DirectoryGrantRequest>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    if request.schema_version != 1 {
        return Err(rejected("resource_schema_unsupported"));
    }
    let value = state
        .plugin_resources
        .lock()
        .map_err(|_| rejected("resource_store_unavailable"))?
        .directory_imports
        .cancel(&request)?;
    Ok(Json(value))
}

#[cfg(test)]
mod tests;
