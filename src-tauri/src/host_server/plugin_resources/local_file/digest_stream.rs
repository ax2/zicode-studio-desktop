//! A native selection grants one streaming run. Paths stay with the Host.
use super::{export::Context, *};
use crate::plugin_capabilities::worker_process::Error;
use crate::plugin_resource_execution::file_digest as policy;
use crate::plugin_worker::{digest_stream, resource_input::Descriptor, resource_output};
use sha2::{Digest, Sha256, Sha512};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};

const PROFILE: &str = "resource.local-file.digest-stream.draft1";
const GRANTS: usize = 32;

struct SelectedFile {
    directory: PathBuf,
    name: String,
    stamp: (String, u64),
    id: String,
}

struct Grant {
    owner: Owner,
    context: Context,
    proof: String,
    root: PathBuf,
    expires: Instant,
    files: Vec<SelectedFile>,
    total: u64,
}

#[derive(Default)]
struct Progress {
    count: usize,
    bytes: u64,
}

struct Run {
    owner: Owner,
    context: Context,
    file_count: usize,
    total: u64,
    cancelled: AtomicBool,
    progress: Mutex<Progress>,
}

#[derive(Default)]
pub(in crate::host_server::plugin_resources) struct Grants {
    pending: HashMap<String, Grant>,
    active: HashMap<String, Arc<Run>>,
}

impl Grants {
    pub(in crate::host_server::plugin_resources) fn invalidate_runtime(&mut self, id: &str) {
        self.pending.retain(|_, grant| grant.owner.runtime_id != id);
        for run in self
            .active
            .values()
            .filter(|run| run.owner.runtime_id == id)
        {
            run.cancelled.store(true, Ordering::Release);
        }
    }

    fn prune(&mut self) {
        self.pending
            .retain(|_, grant| grant.expires > Instant::now());
    }
}

struct Lease {
    state: Arc<HostState>,
    id: String,
}

impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut store) = self.state.plugin_resources.lock() {
            store.digest_streams.active.remove(&self.id);
        }
    }
}

fn owner(value: Value) -> Result<Owner, String> {
    serde_json::from_value(value).map_err(|_| "resource_scope_invalid".into())
}

fn code((_, Json(error)): ApiError) -> String {
    error["error"]["code"]
        .as_str()
        .unwrap_or("resource_store_unavailable")
        .into()
}

fn scene(state: &HostState, owner: &Owner) -> Result<String, ApiError> {
    state
        .runtimes
        .statuses()
        .map_err(|_| rejected("runtime_unavailable"))?
        .into_iter()
        .map(|entry| entry.target)
        .find(|target| {
            target.instance_id == owner.runtime_id && target.session_id == owner.session_id
        })
        .map(|target| target.scene_id)
        .ok_or_else(|| rejected("runtime_stopped"))
}

fn module_path(
    state: &HostState,
    owner: &Owner,
    scene: &str,
) -> Result<(PathBuf, String), ApiError> {
    if !file_reference::is_source(owner) {
        return Err(rejected("resource_scope_invalid"));
    }
    let registry = state
        .plugins
        .lock()
        .map_err(|_| rejected("registry_unavailable"))?;
    let plugin = registry
        .execution_plugin(scene, &owner.plugin_id)
        .filter(|plugin| plugin.enabled)
        .ok_or_else(|| rejected("resource_plugin_unavailable"))?;
    if plugin.manifest.required_profiles[policy::STREAM_PROFILE] != "=1.0.0-preview.1" {
        return Err(rejected("resource_execution_profile_unsupported"));
    }
    let (path, kind) = registry
        .plugin_runtime_entry(scene, &owner.plugin_id)
        .map_err(|_| rejected("resource_module_unavailable"))?;
    if kind != "wasi" {
        return Err(rejected("resource_execution_profile_unsupported"));
    }
    Ok((path, plugin.manifest.version))
}

fn selected(path: PathBuf) -> Result<SelectedFile, ApiError> {
    let directory = path
        .parent()
        .ok_or_else(|| rejected("resource_file_path_invalid"))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| file_digest_report::safe_file_name(name).is_some())
        .ok_or_else(|| rejected("resource_file_path_invalid"))?;
    let file = local_directory::open_picked_file(directory, name)?;
    let stamp = files::regular_file_identity(&file)?;
    Ok(SelectedFile {
        directory: directory.to_owned(),
        name: name.into(),
        stamp,
        id: uuid::Uuid::new_v4().to_string(),
    })
}

fn check_scope(state: &HostState, grant: &Grant) -> Result<(), ApiError> {
    let current = scope_in_workspace(state, &grant.owner, Some(&grant.context.workspace))?;
    if current != (grant.root.clone(), grant.proof.clone()) {
        return Err(rejected("resource_authorization_changed"));
    }
    Ok(())
}

impl HostServer {
    pub(crate) async fn prepare_native_digest_stream(
        &self,
        context: Context,
        owner_value: Value,
        paths: Vec<PathBuf>,
    ) -> Result<Value, String> {
        let owner = owner(owner_value)?;
        let state = self.state.clone();
        blocking(state.clone(), move || {
            if paths.is_empty() || paths.len() > digest_stream::MAX_FILES {
                return Err(rejected("resource_file_selection_invalid"));
            }
            let _ = module_path(&state, &owner, &scene(&state, &owner)?)?;
            let (root, proof) = scope_in_workspace(&state, &owner, Some(&context.workspace))?;
            let mut identities = std::collections::HashSet::new();
            let mut total = 0u64;
            let mut files = Vec::with_capacity(paths.len());
            for path in paths {
                let file = selected(path)?;
                if !identities.insert(file.stamp.0.clone()) {
                    return Err(rejected("resource_file_selection_invalid"));
                }
                total = total.checked_add(file.stamp.1).ok_or_else(|| rejected("resource_input_too_large"))?;
                files.push(file);
            }
            let grant = Grant { owner, context, proof, root, expires: Instant::now() + TTL, files, total };
            check_scope(&state, &grant)?;
            let id = uuid::Uuid::new_v4().to_string();
            let summaries = grant.files.iter().map(|file| json!({"name":file.name,"byteLength":file.stamp.1})).collect::<Vec<_>>();
            let value = json!({"schemaVersion":1,"profile":PROFILE,"grantId":id,"owner":grant.owner,
                "files":summaries,"totalBytes":total,"contentRead":false,"confirmed":false,"expiresInSeconds":TTL.as_secs()});
            let mut store = state.plugin_resources.lock().map_err(|_| rejected("resource_store_unavailable"))?;
            let grants = &mut store.digest_streams;
            grants.prune();
            if grants.pending.len() + grants.active.len() >= GRANTS {
                return Err(rejected("resource_file_grant_budget_exceeded"));
            }
            grants.pending.insert(id, grant);
            Ok(value)
        }).await.map(|Json(value)| value).map_err(code)
    }

    pub(crate) async fn run_native_digest_stream(
        &self,
        context: Context,
        owner_value: Value,
        id: String,
        confirmed: bool,
        expected: String,
    ) -> Result<Value, String> {
        if !confirmed {
            return Err("resource_confirmation_required".into());
        }
        let expected = expected.trim().to_owned();
        if !expected.is_empty()
            && (!matches!(expected.len(), 64 | 128)
                || !expected.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err("invalid_parameters".into());
        }
        let owner = owner(owner_value)?;
        let state = self.state.clone();
        blocking(state.clone(), move || {
            let (grant, run) = {
                let mut store = state
                    .plugin_resources
                    .lock()
                    .map_err(|_| rejected("resource_store_unavailable"))?;
                let grants = &mut store.digest_streams;
                grants.prune();
                if !grants
                    .pending
                    .get(&id)
                    .is_some_and(|g| g.owner == owner && g.context == context)
                {
                    return Err(rejected("resource_file_grant_invalid"));
                }
                let grant = grants.pending.remove(&id).unwrap();
                let run = Arc::new(Run {
                    owner,
                    context,
                    file_count: grant.files.len(),
                    total: grant.total,
                    cancelled: AtomicBool::new(false),
                    progress: Mutex::new(Progress::default()),
                });
                grants.active.insert(id.clone(), run.clone());
                (Arc::new(grant), run)
            };
            let _lease = Lease {
                state: state.clone(),
                id,
            };
            let mut result = execute(&state, grant.clone(), run.clone(), expected)?;
            check_scope(&state, &grant)?;
            let mut store = state
                .plugin_resources
                .lock()
                .map_err(|_| rejected("resource_store_unavailable"))?;
            if run.cancelled.load(Ordering::Acquire) {
                return Err(rejected("worker_cancelled"));
            }
            let hashes = result["result"]["files"]
                .as_array()
                .ok_or_else(|| rejected("invalid_output"))?;
            let originals = grant
                .files
                .iter()
                .zip(hashes)
                .map(|(file, row)| {
                    if file.stamp.1 > file_reference::MAX_BYTES as u64 {
                        return None;
                    }
                    Some(store::StreamOriginal {
                        file: Arc::new(file_reference::OriginalFile::new(
                            grant.root.clone(),
                            file.name.clone(),
                            file.stamp.0.clone(),
                            Some(file.directory.clone()),
                        )),
                        length: file.stamp.1 as usize,
                        sha256: row["sha256"].as_str()?.into(),
                    })
                })
                .collect();
            let (access, report) = store.publish_stream_report(
                &grant.owner,
                &grant.proof,
                grant.context.clone(),
                &result["report"],
                originals,
            )?;
            result["reportResource"] = report;
            result["reportAccess"] =
                serde_json::to_value(access).map_err(|_| rejected("invalid_output"))?;
            store.digest_streams.active.remove(&_lease.id);
            Ok(result)
        })
        .await
        .map(|Json(value)| value)
        .map_err(code)
    }

    pub(crate) fn prepare_native_digest_stream_original(
        &self,
        context: &Context,
        report_value: Value,
        index: usize,
    ) -> Result<Value, String> {
        let report: Access =
            serde_json::from_value(report_value).map_err(|_| "resource_scope_invalid")?;
        validate(&report).map_err(code)?;
        if !file_reference::is_source(&report.owner) {
            return Err("resource_scope_invalid".into());
        }
        let (_, proof) = scope_in_workspace(&self.state, &report.owner, Some(&context.workspace))
            .map_err(code)?;
        self.state
            .plugin_resources
            .lock()
            .map_err(|_| "resource_store_unavailable")?
            .stream_original(context, &report, &proof, index)
            .map_err(code)
    }

    pub(crate) fn native_digest_stream_progress(
        &self,
        context: &Context,
        owner_value: Value,
        id: &str,
    ) -> Result<Value, String> {
        let owner = owner(owner_value)?;
        let store = self
            .state
            .plugin_resources
            .lock()
            .map_err(|_| "resource_store_unavailable")?;
        let run = store
            .digest_streams
            .active
            .get(id)
            .filter(|run| run.owner == owner && &run.context == context)
            .ok_or("resource_file_grant_invalid")?;
        let progress = run
            .progress
            .lock()
            .map_err(|_| "resource_store_unavailable")?;
        Ok(
            json!({"schemaVersion":1,"profile":PROFILE,"grantId":id,"completedFiles":progress.count,
            "fileCount":run.file_count,"bytesRead":progress.bytes,"totalBytes":run.total}),
        )
    }

    pub(crate) fn cancel_native_digest_stream(
        &self,
        context: &Context,
        owner_value: Value,
        id: &str,
    ) -> Result<(), String> {
        let owner = owner(owner_value)?;
        let mut store = self
            .state
            .plugin_resources
            .lock()
            .map_err(|_| "resource_store_unavailable")?;
        let grants = &mut store.digest_streams;
        if let Some(run) = grants.active.get(id) {
            if run.owner == owner && &run.context == context {
                run.cancelled.store(true, Ordering::Release);
                return Ok(());
            }
        } else if grants
            .pending
            .get(id)
            .is_some_and(|grant| grant.owner == owner && &grant.context == context)
        {
            grants.pending.remove(id);
            return Ok(());
        }
        Err("resource_file_grant_invalid".into())
    }
}

fn execute(
    state: &HostState,
    grant: Arc<Grant>,
    run: Arc<Run>,
    expected: String,
) -> Result<Value, ApiError> {
    check_scope(state, &grant)?;
    let scene = scene(state, &grant.owner)?;
    let (path, version) = module_path(state, &grant.owner, &scene)?;
    let module = plugin_results::module_snapshot::read(&path)
        .map_err(|_| rejected("resource_module_unavailable"))?;
    if identity_module(state, &grant.owner, None, Some(&module))? != grant.proof {
        return Err(rejected("resource_authorization_changed"));
    }
    let descriptors = grant
        .files
        .iter()
        .map(|file| {
            Ok(Descriptor {
                resource_id: file.id.clone(),
                content_version: sha256_hex(file.id.as_bytes()),
                mime_type: "application/octet-stream".into(),
                byte_length: usize::try_from(file.stamp.1)
                    .map_err(|_| rejected("resource_input_too_large"))?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    let prefix =
        digest_stream::encode_prefix(&scene, json!({"expected":expected}), &descriptors, &module)
            .map_err(|_| rejected("worker_protocol_error"))?;
    let sender_grant = grant.clone();
    let sender_run = run.clone();
    // Include startup allowance, then scale the deadline with confirmed byte count.
    let timeout = Duration::from_secs(30 + grant.total.div_ceil(8 * 1024 * 1024));
    let (status, output, hashes) = worker::run_native_digest_stream(
        state,
        &run.cancelled,
        timeout,
        || check_scope(state, &grant).is_ok(),
        move |pipe| stream_files(&sender_grant, &sender_run, &prefix, pipe),
    )?;
    if !status.success() {
        return Err(rejected("worker_failed"));
    }
    let result = resource_output::decode_with_profile(&output, resource_output::Profile::Draft1)
        .map_err(|_| rejected("worker_protocol_error"))?;
    if !result.resources.is_empty()
        || result.result != policy::report_from_hashes(&hashes, &expected)
    {
        return Err(rejected("invalid_output"));
    }
    let names = grant
        .files
        .iter()
        .map(|file| Some(file.name.clone()))
        .collect::<Vec<_>>();
    let provenance = file_digest_report::provenance(&grant.owner, &version, &module);
    let report =
        file_digest_report::material(&result.result, &expected, &names, provenance, &version)?;
    Ok(json!({"schemaVersion":1,"profile":PROFILE,"result":result.result,"report":report}))
}

fn send_error(code: &'static str) -> Error {
    Error {
        code,
        message: "Cannot complete the selected file stream",
    }
}

fn stream_files(
    grant: &Grant,
    run: &Run,
    prefix: &[u8],
    pipe: &mut impl Write,
) -> Result<Vec<policy::MeasuredDigest>, Error> {
    pipe.write_all(prefix)
        .map_err(|_| send_error("worker_protocol_error"))?;
    let mut buffer = vec![0; digest_stream::CHUNK_BYTES];
    let mut measured = Vec::with_capacity(grant.files.len());
    for selected in &grant.files {
        let open = || {
            local_directory::open_picked_file(&selected.directory, &selected.name)
                .map_err(|_| send_error("resource_file_unavailable"))
        };
        let same = |file: &std::fs::File| {
            files::regular_file_identity(file).is_ok_and(|stamp| stamp == selected.stamp)
        };
        let mut file = open()?;
        if !same(&file) {
            return Err(send_error("resource_file_changed"));
        }
        let mut left = selected.stamp.1;
        let mut sha256 = Sha256::new();
        let mut sha512 = Sha512::new();
        while left > 0 {
            if run.cancelled.load(Ordering::Acquire) {
                return Err(send_error("worker_cancelled"));
            }
            let size = left.min(buffer.len() as u64) as usize;
            file.read_exact(&mut buffer[..size])
                .map_err(|_| send_error("resource_file_changed"))?;
            if run.cancelled.load(Ordering::Acquire) {
                return Err(send_error("worker_cancelled"));
            }
            pipe.write_all(&buffer[..size])
                .map_err(|_| send_error("worker_protocol_error"))?;
            sha256.update(&buffer[..size]);
            sha512.update(&buffer[..size]);
            left -= size as u64;
            run.progress
                .lock()
                .map_err(|_| send_error("resource_store_unavailable"))?
                .bytes += size as u64;
        }
        if file
            .read(&mut buffer[..1])
            .map_err(|_| send_error("resource_file_unavailable"))?
            != 0
            || !same(&file)
            || !same(&open()?)
        {
            return Err(send_error("resource_file_changed"));
        }
        run.progress
            .lock()
            .map_err(|_| send_error("resource_store_unavailable"))?
            .count += 1;
        measured.push(policy::MeasuredDigest {
            length: selected.stamp.1,
            sha256: format!("{:x}", sha256.finalize()),
            sha512: format!("{:x}", sha512.finalize()),
        });
    }
    Ok(measured)
}
