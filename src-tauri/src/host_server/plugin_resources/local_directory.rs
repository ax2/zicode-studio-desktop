//! Explicit, one-use, read-only directory metadata snapshots for a trusted desktop UI.
//! No absolute path or directory handle reaches a plugin Worker.
mod checksum;
mod checksum_progress;
mod native_checksum;
mod duplicates;
mod usage;
pub(super) use native_checksum::open_picked_file;

use super::{export::Context, *};
use cap_fs_ext::DirExt;
use cap_std::ambient_authority;
use cap_std::fs::Dir;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

const TTL: Duration = Duration::from_secs(120);
const MAX_ENTRIES: usize = 4096;
const METADATA_PROFILE: &str = "resource.local-directory.draft1";
const MAX_SNAPSHOT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct PrepareDirectory {
    schema_version: u32,
    owner: Owner,
    relative_path: String,
    profile: Option<String>,
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

enum Purpose {
    Metadata,
    Usage,
    Duplicates,
    Checksum(Vec<checksum::Entry>),
    GenerateChecksum(Vec<checksum::SelectedFile>),
}

#[derive(Clone, Copy)]
enum DirectoryAccess {
    Metadata,
    Usage,
    Duplicates,
    Checksum,
}

impl Purpose {
    fn access(&self) -> DirectoryAccess {
        match self {
            Self::Metadata => DirectoryAccess::Metadata,
            Self::Usage => DirectoryAccess::Usage,
            Self::Duplicates => DirectoryAccess::Duplicates,
            Self::Checksum(_) | Self::GenerateChecksum(_) => DirectoryAccess::Checksum,
        }
    }
}

struct Grant {
    purpose: Purpose,
    owner: Owner,
    root: PathBuf,
    selection: Selection,
    proof: String,
    registry_revision: String,
    stamp: String,
    expires: Instant,
}

enum Selection {
    Workspace(String),
    Picked(native_checksum::SelectedDirectory),
}

impl Selection {
    fn context(&self) -> Option<&Context> {
        match self {
            Self::Workspace(_) => None,
            Self::Picked(selection) => Some(&selection.context),
        }
    }

    fn open(&self, workspace_root: &Path, access: DirectoryAccess) -> Result<Dir, ApiError> {
        match self {
            Self::Picked(selection) => native_checksum::open_picked_directory(&selection.path),
            Self::Workspace(relative) if matches!(access, DirectoryAccess::Usage) => {
                native_checksum::open_picked_directory(&workspace_root.join(relative))
            }
            Self::Workspace(relative) => open_directory(workspace_root, relative),
        }
    }
}

struct Control {
    cancelled: AtomicBool,
    outcome: AtomicU8,
    deadline: Instant,
    progress: Option<Mutex<checksum_progress::Counts>>,
}

impl Control {
    fn new(expires: Instant) -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            outcome: AtomicU8::new(0),
            deadline: expires.min(Instant::now() + Duration::from_secs(30)),
            progress: None,
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
    context: Option<Context>,
    control: Arc<Control>,
}

#[derive(Default)]
pub(super) struct Grants {
    pending: HashMap<String, Grant>,
    active: HashMap<String, Active>,
}

impl Grants {
    pub(super) fn invalidate_runtime(&mut self, runtime_id: &str) {
        self.pending
            .retain(|_, grant| grant.owner.runtime_id != runtime_id);
        for active in self.active.values() {
            if active.owner.runtime_id == runtime_id {
                active.control.cancel();
            }
        }
    }

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
    fn take(
        &mut self,
        request: &DirectoryGrantRequest,
        context: Option<&Context>,
    ) -> Result<Grant, ApiError> {
        self.prune();
        if !self.pending.get(&request.grant_id).is_some_and(|grant| {
            grant.owner == request.owner && grant.selection.context() == context
        }) {
            return Err(rejected("resource_directory_grant_unavailable"));
        }
        self.pending
            .remove(&request.grant_id)
            .ok_or_else(|| rejected("resource_directory_grant_unavailable"))
    }
    fn begin(
        &mut self,
        request: &DirectoryGrantRequest,
        context: Option<&Context>,
    ) -> Result<(Grant, Arc<Control>), ApiError> {
        let grant = self.take(request, context)?;
        let control = Arc::new(
            Control::new(grant.expires).with_checksum_total(grant.purpose.checksum_total()),
        );
        self.active.insert(
            request.grant_id.clone(),
            Active {
                owner: request.owner.clone(),
                context: context.cloned(),
                control: control.clone(),
            },
        );
        Ok((grant, control))
    }
    fn cancel(
        &mut self,
        request: &DirectoryGrantRequest,
        context: Option<&Context>,
    ) -> Result<Value, ApiError> {
        if let Some(active) = self.active.get(&request.grant_id) {
            if active.owner != request.owner || active.context.as_ref() != context {
                return Err(rejected("resource_directory_grant_unavailable"));
            }
            let requested = active.control.cancel();
            return Ok(
                json!({"schemaVersion":1,"cancelled":false,"cancellationRequested":requested,
                "executionFinished":!requested}),
            );
        }
        self.take(request, context)?;
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

fn authorize(
    state: &HostState,
    owner: &Owner,
    access: DirectoryAccess,
    context: Option<&Context>,
) -> Result<(PathBuf, String, String), ApiError> {
    let (root, proof) = local_file::scope(state, owner)?;
    let target = state
        .runtimes
        .statuses()
        .map_err(|_| rejected("runtime_unavailable"))?
        .into_iter()
        .find(|status| {
            status.target.instance_id == owner.runtime_id
                && status.target.session_id == owner.session_id
        })
        .ok_or_else(|| rejected("runtime_stopped"))?
        .target;
    if context.is_some_and(|item| item.workspace != target.workspace_id) {
        return Err(rejected("resource_authorization_changed"));
    }
    let scene = target.scene_id;
    let registry = state
        .plugins
        .lock()
        .map_err(|_| rejected("registry_unavailable"))?;
    let plugin = registry
        .execution_plugin(&scene, &owner.plugin_id)
        .filter(|plugin| plugin.enabled)
        .ok_or_else(|| rejected("resource_plugin_unavailable"))?;
    let permission = match access {
        DirectoryAccess::Metadata => "resource.directory.read",
        DirectoryAccess::Usage if owner.plugin_id == usage::PLUGIN && owner.capability_id == usage::CAPABILITY => usage::PERMISSION,
        DirectoryAccess::Duplicates if owner.plugin_id == duplicates::PLUGIN && owner.capability_id == duplicates::CAPABILITY => duplicates::PERMISSION,
        DirectoryAccess::Checksum if owner.plugin_id == "com.zicode.devtools.files"
            && owner.capability_id == crate::plugin_resource_execution::file_digest::CAPABILITY => "resource.read",
        _ => return Err(rejected("resource_directory_profile_unsupported")),
    };
    let duplicates_read = matches!(access, DirectoryAccess::Duplicates);
    if duplicates_read {
        let runtime = &plugin.manifest.runtime;
        let capabilities = plugin.manifest.contributes["capabilities"].as_array();
        if runtime["wasi"].as_str().is_none()
            || runtime["resourceInputProfile"] != "resource.wasi.input.draft2"
            || !capabilities.is_some_and(|caps| caps.iter().any(|cap| {
                cap["id"] == duplicates::CAPABILITY
                    && crate::plugin_registry::resource_input_types::accepts(cap, "text/plain")
            }))
        {
            return Err(rejected("resource_directory_profile_unsupported"));
        }
    }
    for name in std::iter::once(permission).chain(duplicates_read.then_some("resource.read")) {
        if !plugin.manifest.permissions.required.iter()
            .chain(&plugin.manifest.permissions.optional)
            .any(|item| item.name == name)
        {
            return Err(rejected("resource_directory_profile_unsupported"));
        }
        if plugin.permission_grants.get(name) != Some(&true) {
            return Err(plugin_api_error(StatusCode::FORBIDDEN, "permission_denied", ""));
        }
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
            #[cfg(windows)]
            {
                use cap_std::fs::MetadataExt;
                if meta.file_attributes()
                    & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
                    != 0
                {
                    return Err(rejected("resource_directory_path_invalid"));
                }
            }
            if !meta.is_dir() || meta.file_type().is_symlink() {
                return Err(rejected("resource_directory_path_invalid"));
            }
            handles.push(open_checked_child(parent, part)?);
        }
    }
    Ok(handles.pop().expect("root directory present"))
}

fn open_checked_child(parent: &Dir, part: impl AsRef<Path>) -> Result<Dir, ApiError> {
    // The earlier metadata check describes a stable path, but the entry can
    // be replaced before this open. Bind no-follow to the opened handle.
    let child = parent
        .open_dir_nofollow(part)
        .map_err(|_| rejected("resource_directory_path_invalid"))?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        let opened = child
            .try_clone()
            .map_err(|_| rejected("resource_directory_unavailable"))?
            .into_std_file();
        if opened
            .metadata()
            .map_err(|_| rejected("resource_directory_unavailable"))?
            .file_attributes()
            & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
            != 0
        {
            return Err(rejected("resource_directory_path_invalid"));
        }
    }
    Ok(child)
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
        let meta = directory
            .symlink_metadata(&name)
            .map_err(|_| rejected("resource_directory_unavailable"))?;
        #[cfg(windows)]
        {
            use cap_std::fs::MetadataExt;
            if meta.file_attributes()
                & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
                != 0
            {
                return Err(rejected("resource_directory_entry_unsupported"));
            }
        }
        let kind = meta.file_type();
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
        &json!({"schemaVersion":1,"profile":METADATA_PROFILE,
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
    let (profile, purpose) = match request.profile.as_deref() {
        None | Some(METADATA_PROFILE) => (METADATA_PROFILE, Purpose::Metadata),
        Some(usage::PROFILE) => (usage::PROFILE, Purpose::Usage),
        _ => return Err(rejected("resource_directory_profile_unsupported")),
    };
    blocking(state.clone(), move || {
        let grant_id = issue_grant(
            &state,
            request.owner.clone(),
            purpose,
            Selection::Workspace(request.relative_path.clone()),
        )?;
        Ok(
            json!({"schemaVersion":1,"profile":profile,"grantId":grant_id,
            "owner":request.owner,"relativePath":request.relative_path,"entryNamesRead":false,
            "confirmed":false,"expiresInSeconds":120}),
        )
    })
    .await
}

fn issue_grant(
    state: &HostState,
    owner: Owner,
    purpose: Purpose,
    selection: Selection,
) -> Result<String, ApiError> {
    let context = selection.context();
    let access = purpose.access();
    let expected = authorize(state, &owner, access, context)?;
    let directory = selection.open(&expected.0, access)?;
    let directory_stamp = stamp(&directory)?;
    if authorize(state, &owner, access, context)? != expected {
        return Err(rejected("resource_authorization_changed"));
    }
    let (root, proof, registry_revision) = expected;
    let grant = Grant {
        owner,
        purpose,
        root,
        selection,
        proof,
        registry_revision,
        stamp: directory_stamp,
        expires: Instant::now() + TTL,
    };
    state
        .plugin_resources
        .lock()
        .map_err(|_| rejected("resource_store_unavailable"))?
        .directory_imports
        .insert(grant)
}

pub(in crate::host_server) async fn commit(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<DirectoryGrantRequest>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    commit_grant(state, request, None).await
}

async fn commit_grant(
    state: Arc<HostState>,
    request: DirectoryGrantRequest,
    context: Option<Context>,
) -> Result<Json<Value>, ApiError> {
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
            .begin(&request, context.as_ref())?;
        let _lease = Lease {
            state: state.clone(),
            id: request.grant_id.clone(),
        };
        let expected = (
            grant.root.clone(),
            grant.proof.clone(),
            grant.registry_revision.clone(),
        );
        let access = grant.purpose.access();
        let check_authority = || {
            control.check()?;
            if authorize(&state, &request.owner, access, context.as_ref())? != expected {
                return Err(rejected("resource_authorization_changed"));
            }
            Ok(())
        };
        check_authority()?;
        let directory = grant.selection.open(&grant.root, access)?;
        match &grant.purpose {
            Purpose::Metadata | Purpose::Usage | Purpose::Duplicates => {
                let analysis = match grant.purpose {
                    Purpose::Usage => Some((
                        usage::PROFILE,
                        usage::snapshot(&directory, &grant.stamp, &control, check_authority)?,
                    )),
                    Purpose::Duplicates => Some((
                        duplicates::PROFILE,
                        duplicates::snapshot(&directory, &grant.stamp, &control, check_authority)?,
                    )),
                    _ => None,
                };
                let (profile, bytes, count, partial) = if let Some((profile, scan)) = analysis {
                    let current = grant.selection.open(&grant.root, access)?;
                    if stamp(&current)? != grant.stamp {
                        return Err(rejected("resource_directory_changed"));
                    }
                    (profile, scan.bytes, scan.entry_count, Some(scan.partial))
                } else {
                    let (bytes, count) = snapshot(&directory, &grant.stamp, &control)?;
                    (METADATA_PROFILE, bytes, count, None)
                };
                check_authority()?;
                let mut store = state
                    .plugin_resources
                    .lock()
                    .map_err(|_| rejected("resource_store_unavailable"))?;
                control.check()?;
                let mut result = store.import_directory(request.owner, grant.proof, bytes, profile)?;
                control.published();
                result["entryCount"] = json!(count);
                if let Some(partial) = partial {
                    result["partial"] = json!(partial);
                }
                Ok(result)
            }
            purpose => {
                if stamp(&directory)? != grant.stamp {
                    return Err(rejected("resource_directory_changed"));
                }
                let result = match purpose {
                    Purpose::Checksum(entries) => {
                        let rows = checksum::verify(&directory, entries, &control, &check_authority)?;
                        json!({"schemaVersion":1,"profile":checksum::PROFILE,"entries":rows})
                    }
                    Purpose::GenerateChecksum(selected) => {
                        let files = checksum::generate(&directory, selected, &control, &check_authority)?;
                        json!({"schemaVersion":1,"profile":checksum::GENERATE_PROFILE,"files":files})
                    }
                    Purpose::Metadata | Purpose::Usage | Purpose::Duplicates => unreachable!("snapshot already handled"),
                };
                let current_directory = grant.selection.open(&grant.root, access)?;
                if stamp(&current_directory)? != grant.stamp {
                    return Err(rejected("resource_directory_changed"));
                }
                check_authority()?;
                // Serialize successful publication with cancellation of this grant.
                let _store = state
                    .plugin_resources
                    .lock()
                    .map_err(|_| rejected("resource_store_unavailable"))?;
                control.check()?;
                control.published();
                Ok(result)
            }
        }
    })
    .await
}

pub(in crate::host_server) async fn cancel(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<DirectoryGrantRequest>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    cancel_grant(&state, &request, None).map(Json)
}

fn cancel_grant(
    state: &HostState,
    request: &DirectoryGrantRequest,
    context: Option<&Context>,
) -> Result<Value, ApiError> {
    if request.schema_version != 1 {
        return Err(rejected("resource_schema_unsupported"));
    }
    state
        .plugin_resources
        .lock()
        .map_err(|_| rejected("resource_store_unavailable"))?
        .directory_imports
        .cancel(request, context)
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod checksum_acceptance;

#[cfg(test)]
mod usage_tests;

#[cfg(test)]
mod usage_provider_tests;

#[cfg(test)]
mod duplicates_provider_tests;
