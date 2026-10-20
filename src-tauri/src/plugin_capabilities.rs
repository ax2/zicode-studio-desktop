#[path = "plugin_cache_authority.rs"]
mod cache_authority;
#[path = "plugin_detached_worker.rs"]
pub(crate) mod detached_worker;
#[path = "plugin_output_contract.rs"]
pub(crate) mod output_contract;
#[path = "plugin_schema_constraints.rs"]
pub(crate) mod schema_constraints;
#[path = "plugin_worker_launch.rs"]
mod worker_launch;
#[path = "plugin_worker_process.rs"]
pub(crate) mod worker_process;

use crate::notes_vault::NotesVault;
use crate::plugin_registry::{PluginCapabilityDescriptor, PluginRegistry};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

// 证件照排版需要接收照片 data URL（可达数 MB），全局上限提高到 16 MiB；
// 审计只记录输入哈希，不落盘原始字节。
pub const MAX_CAPABILITY_INPUT_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_CAPABILITY_OUTPUT_BYTES: usize = 1024 * 1024;
const MAX_NOTE_FILES: usize = 500;
const MAX_NOTE_FILE_BYTES: u64 = 2 * 1024 * 1024;
const IDEMPOTENCY_CAPACITY: usize = 256;
const WORKER_TIMEOUT: Duration = Duration::from_secs(5);
#[cfg(test)]
type WorkerObserver = Arc<dyn Fn(&'static str, u32) + Send + Sync>;

#[derive(Clone, Debug)]
pub struct CapabilityError {
    pub code: &'static str,
    pub message: String,
}

impl CapabilityError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct CapabilityInvocation {
    pub caller: String,
    pub scene_id: String,
    pub workspace_id: String,
    pub plugin_id: String,
    pub capability_id: String,
    pub tool_call_id: Option<String>,
    pub idempotency_scope: Option<String>,
    pub input: Value,
}

#[derive(Clone)]
struct CachedInvocation {
    request_hash: String,
    authority: cache_authority::Authority,
    result: Value,
}

struct WorkerReservation {
    plugin_id: String,
    lease: std::sync::Weak<()>,
}

pub struct CapabilityBroker {
    #[cfg(test)]
    pub(crate) worker_executable: Option<PathBuf>,
    #[cfg(test)]
    pub(crate) worker_observer: Option<WorkerObserver>,
    data_root: PathBuf,
    notes: NotesVault,
    workspace_roots: Option<Arc<RwLock<HashMap<String, PathBuf>>>>,
    system_root: Option<PathBuf>,
    audit_path: PathBuf,
    idempotency: HashMap<String, CachedInvocation>,
    idempotency_order: VecDeque<String>,
    worker_reservations: HashMap<String, WorkerReservation>,
}

impl CapabilityBroker {
    pub fn new(plugin_root: PathBuf) -> Result<Self, String> {
        let notes = NotesVault::new(plugin_root.clone())?;
        let data_root = plugin_root
            .parent()
            .unwrap_or(&plugin_root)
            .join("plugin-data");
        let audit_root = plugin_root.join("audit");
        fs::create_dir_all(&data_root)
            .map_err(|error| format!("Cannot create plugin data directory: {error}"))?;
        fs::create_dir_all(&audit_root)
            .map_err(|error| format!("Cannot create plugin audit directory: {error}"))?;
        Ok(Self {
            #[cfg(test)]
            worker_executable: None,
            #[cfg(test)]
            worker_observer: None,
            data_root,
            notes,
            workspace_roots: None,
            system_root: None,
            audit_path: audit_root.join("capabilities.jsonl"),
            idempotency: HashMap::new(),
            idempotency_order: VecDeque::new(),
            worker_reservations: HashMap::new(),
        })
    }

    /// Point workspace-scoped capabilities at `<workspace>/.zicode/...`.
    pub fn with_workspace_registry(
        mut self,
        workspace_roots: Arc<RwLock<HashMap<String, PathBuf>>>,
        system_root: PathBuf,
    ) -> Self {
        self.workspace_roots = Some(workspace_roots);
        self.system_root = Some(system_root);
        self
    }

    fn workspace_root(&self, workspace_id: &str) -> Result<PathBuf, CapabilityError> {
        let roots = self.workspace_roots.as_ref().ok_or_else(|| {
            CapabilityError::new("workspace_unavailable", "Workspace registry is unavailable")
        })?;
        let registry = roots.read().map_err(|_| {
            CapabilityError::new("workspace_unavailable", "Workspace registry is locked")
        })?;
        registry.get(workspace_id).cloned().ok_or_else(|| {
            CapabilityError::new(
                "workspace_not_found",
                format!("Workspace {workspace_id} is not registered"),
            )
        })
    }

    #[cfg(test)]
    pub fn invoke(
        &mut self,
        registry: &PluginRegistry,
        invocation: CapabilityInvocation,
    ) -> Result<Value, CapabilityError> {
        self.invoke_cancellable(registry, invocation, None)
    }

    pub fn invoke_cancellable(
        &mut self,
        registry: &PluginRegistry,
        invocation: CapabilityInvocation,
        cancelled: Option<&AtomicBool>,
    ) -> Result<Value, CapabilityError> {
        let started = Instant::now();
        let input_bytes = serde_json::to_vec(&invocation.input).map_err(|_| {
            CapabilityError::new("invalid_parameters", "Capability input is not serializable")
        })?;
        let input_hash = hex_sha256(&input_bytes);
        if input_bytes.len() > MAX_CAPABILITY_INPUT_BYTES {
            let error =
                CapabilityError::new("payload_too_large", "Capability input exceeds 16 MiB");
            self.write_audit(AuditRecord {
                timestamp_ms: now_millis(),
                caller: &invocation.caller,
                scene_id: &invocation.scene_id,
                plugin_id: &invocation.plugin_id,
                capability_id: &invocation.capability_id,
                tool_call_id: invocation.tool_call_id.as_deref(),
                input_hash: &input_hash,
                duration_ms: started.elapsed().as_millis(),
                ok: false,
                error_code: Some(error.code),
            });
            return Err(error);
        }
        let request_hash = hex_sha256(
            &serde_json::to_vec(&json!([
                invocation.caller,
                invocation.scene_id,
                invocation.workspace_id,
                invocation.plugin_id,
                invocation.capability_id,
                input_hash,
            ]))
            .expect("String tuple is serializable"),
        );
        let cache_key = invocation
            .idempotency_scope
            .as_ref()
            .zip(invocation.tool_call_id.as_ref())
            .map(|(scope, call)| {
                serde_json::to_string(&(scope, call)).expect("String tuple is serializable")
            });
        let outcome = if cancelled.is_some_and(|flag| flag.load(Ordering::Acquire)) {
            Err(CapabilityError::new(
                "worker_cancelled",
                "Plugin call cancelled before execution",
            ))
        } else if cache_key.as_ref().is_some_and(|key| {
            self.worker_reservations
                .get(key)
                .is_some_and(|entry| entry.lease.strong_count() > 0)
        }) {
            Err(CapabilityError::new(
                "plugin_call_in_progress",
                "This invocation is already running",
            ))
        } else if let Some(key) = &cache_key {
            self.invoke_cached(registry, &invocation, key, &request_hash, cancelled)
        } else {
            self.invoke_uncached(registry, &invocation, cancelled)
        };
        if outcome
            .as_ref()
            .is_err_and(|error| matches!(error.code, "worker_protocol_error" | "result_too_large"))
        {
            if let Some(key) = &cache_key {
                self.idempotency.remove(key);
                self.idempotency_order.retain(|entry| entry != key);
            }
        }
        self.write_audit(AuditRecord {
            timestamp_ms: now_millis(),
            caller: &invocation.caller,
            scene_id: &invocation.scene_id,
            plugin_id: &invocation.plugin_id,
            capability_id: &invocation.capability_id,
            tool_call_id: invocation.tool_call_id.as_deref(),
            input_hash: &input_hash,
            duration_ms: started.elapsed().as_millis(),
            ok: outcome.is_ok(),
            error_code: outcome.as_ref().err().map(|error| error.code),
        });
        outcome
    }

    fn current_capability(
        &self,
        registry: &PluginRegistry,
        invocation: &CapabilityInvocation,
    ) -> Result<PluginCapabilityDescriptor, CapabilityError> {
        registry
            .verify_current_integrity(&invocation.plugin_id)
            .map_err(|error| CapabilityError::new("plugin_not_active", error))?;
        let capability = registry
            .capability(
                &invocation.scene_id,
                &invocation.plugin_id,
                &invocation.capability_id,
            )
            .ok_or_else(|| {
                CapabilityError::new(
                    "capability_unavailable",
                    "Capability is missing, disabled, or unavailable in this scene",
                )
            })?;
        if invocation.caller == "pi"
            && !registry.pi_tools(&invocation.scene_id).iter().any(|tool| {
                tool.plugin_id == invocation.plugin_id
                    && tool.capability == invocation.capability_id
            })
        {
            return Err(CapabilityError::new(
                "capability_unavailable",
                "AI capability is not granted in this scene",
            ));
        }
        Ok(capability)
    }

    fn invoke_uncached(
        &self,
        registry: &PluginRegistry,
        invocation: &CapabilityInvocation,
        cancelled: Option<&AtomicBool>,
    ) -> Result<Value, CapabilityError> {
        let capability = self.current_capability(registry, invocation)?;
        validate_value(&capability.input_schema, &invocation.input, "$")?;
        let result = self.dispatch(registry, &capability, invocation, cancelled)?;
        let output = serde_json::to_vec(&result).map_err(|_| {
            CapabilityError::new(
                "serialization_failed",
                "Capability result is not serializable",
            )
        })?;
        if output.len() > MAX_CAPABILITY_OUTPUT_BYTES {
            return Err(CapabilityError::new(
                "result_too_large",
                "Capability output exceeds 1 MiB",
            ));
        }
        output_contract::validate_result(&capability, &result)?;
        Ok(result)
    }

    pub fn invoke_command(
        &mut self,
        registry: &PluginRegistry,
        scene_id: &str,
        command_id: &str,
        args: Value,
    ) -> Result<Value, CapabilityError> {
        let input = serde_json::to_vec(&args).map_err(|_| {
            CapabilityError::new(
                "invalid_parameters",
                "Command arguments are not serializable",
            )
        })?;
        if input.len() > MAX_CAPABILITY_INPUT_BYTES {
            return Err(CapabilityError::new(
                "payload_too_large",
                "Command arguments exceed 16 MiB",
            ));
        }
        let plugin_id = registry
            .command_plugin(scene_id, command_id)
            .map_err(|error| CapabilityError::new("command_not_available", error))?;
        self.invoke_worker(
            registry,
            scene_id,
            &plugin_id,
            json!({ "commandId": command_id }),
            args,
            None,
        )
    }

    fn dispatch(
        &self,
        registry: &PluginRegistry,
        capability: &PluginCapabilityDescriptor,
        invocation: &CapabilityInvocation,
        cancelled: Option<&AtomicBool>,
    ) -> Result<Value, CapabilityError> {
        match (capability.plugin_id.as_str(), capability.id.as_str()) {
            ("com.zicode.notes", "notes.search") => {
                self.search_notes(&invocation.workspace_id, &invocation.input)
            }
            ("com.zicode.notes", "notes.get") => {
                self.get_note(&invocation.workspace_id, &invocation.input)
            }
            ("com.zicode.notes", "notes.create") => {
                self.create_note(&invocation.workspace_id, &invocation.input)
            }
            ("com.zicode.notes", "notes.extractWeb") => self.extract_web(&invocation.input),
            ("com.zicode.idphoto", "idphoto.layout") => {
                self.layout_idphoto(&invocation.workspace_id, &invocation.input)
            }
            ("com.zicode.imagetools", "imagetools.process") => {
                self.process_image(&invocation.workspace_id, &invocation.input)
            }
            ("com.zicode.imagetools", "imagetools.concat") => {
                self.concat_images(&invocation.workspace_id, &invocation.input)
            }
            ("com.zicode.documents", "documents.import") => {
                self.import_document(&invocation.workspace_id, &invocation.input)
            }
            ("com.zicode.clipboard", "clipboard.add") => {
                self.add_clipboard(&invocation.workspace_id, &invocation.input)
            }
            ("com.zicode.clipboard", "clipboard.list") => {
                self.list_clipboard(&invocation.workspace_id)
            }
            ("com.zicode.habits", "habits.list") => self.list_habits(&invocation.workspace_id),
            ("com.zicode.habits", "habits.toggle") => {
                self.toggle_habit(&invocation.workspace_id, &invocation.input)
            }
            ("com.zicode.translate", "translate.text") => {
                self.translate_text(&invocation.scene_id, &invocation.input)
            }
            ("com.zicode.watch", "watch.add") => {
                self.add_watch(&invocation.workspace_id, &invocation.input)
            }
            ("com.zicode.watch", "watch.check") => {
                self.check_watch(&invocation.workspace_id, &invocation.input)
            }
            ("com.zicode.ocr", "ocr.text") => {
                self.extract_text(&invocation.workspace_id, &invocation.input)
            }
            _ => self.invoke_developer_worker(registry, invocation, cancelled),
        }
    }

    fn layout_idphoto(&self, workspace_id: &str, input: &Value) -> Result<Value, CapabilityError> {
        let workspace_root = self.workspace_root(workspace_id)?;
        let request: crate::idphoto::IdPhotoRequest = serde_json::from_value(input.clone())
            .map_err(|error| {
                CapabilityError::new(
                    "invalid_parameters",
                    format!("Invalid idphoto layout input: {error}"),
                )
            })?;
        let result = crate::idphoto::layout(&request, &workspace_root, workspace_id)
            .map_err(|error| CapabilityError::new("layout_failed", error))?;
        serde_json::to_value(result).map_err(|error| {
            CapabilityError::new(
                "serialization_failed",
                format!("Cannot serialize idphoto result: {error}"),
            )
        })
    }

    fn extract_web(&self, input: &Value) -> Result<Value, CapabilityError> {
        let url = input
            .get("url")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                CapabilityError::new("invalid_parameters", "A web page URL is required")
            })?;
        let article = crate::web_extract::fetch_and_extract(url)
            .map_err(|error| CapabilityError::new("capture_failed", error))?;
        serde_json::to_value(article).map_err(|error| {
            CapabilityError::new(
                "serialization_failed",
                format!("Cannot serialize extracted article: {error}"),
            )
        })
    }

    fn process_image(&self, workspace_id: &str, input: &Value) -> Result<Value, CapabilityError> {
        let workspace_root = self.workspace_root(workspace_id)?;
        let request: crate::image_tools::ImageProcessRequest =
            serde_json::from_value(input.clone()).map_err(|error| {
                CapabilityError::new(
                    "invalid_parameters",
                    format!("Invalid image process input: {error}"),
                )
            })?;
        let result = crate::image_tools::process(&request, &workspace_root, workspace_id)
            .map_err(|error| CapabilityError::new("process_failed", error))?;
        serde_json::to_value(result).map_err(|error| {
            CapabilityError::new(
                "serialization_failed",
                format!("Cannot serialize image result: {error}"),
            )
        })
    }

    fn concat_images(&self, workspace_id: &str, input: &Value) -> Result<Value, CapabilityError> {
        let workspace_root = self.workspace_root(workspace_id)?;
        let request: crate::image_tools::ImageConcatRequest = serde_json::from_value(input.clone())
            .map_err(|error| {
                CapabilityError::new(
                    "invalid_parameters",
                    format!("Invalid image concat input: {error}"),
                )
            })?;
        let result = crate::image_tools::concat(&request, &workspace_root, workspace_id)
            .map_err(|error| CapabilityError::new("concat_failed", error))?;
        serde_json::to_value(result).map_err(|error| {
            CapabilityError::new(
                "serialization_failed",
                format!("Cannot serialize image result: {error}"),
            )
        })
    }

    fn import_document(&self, workspace_id: &str, input: &Value) -> Result<Value, CapabilityError> {
        let workspace_root = self.workspace_root(workspace_id)?;
        let request: crate::document_import::DocumentImportRequest =
            serde_json::from_value(input.clone()).map_err(|error| {
                CapabilityError::new(
                    "invalid_parameters",
                    format!("Invalid document import input: {error}"),
                )
            })?;
        let result = crate::document_import::import(&request, &workspace_root)
            .map_err(|error| CapabilityError::new("import_failed", error))?;
        serde_json::to_value(result).map_err(|error| {
            CapabilityError::new(
                "serialization_failed",
                format!("Cannot serialize document result: {error}"),
            )
        })
    }

    fn add_clipboard(&self, workspace_id: &str, input: &Value) -> Result<Value, CapabilityError> {
        let workspace_root = self.workspace_root(workspace_id)?;
        let text = input.get("text").and_then(Value::as_str).ok_or_else(|| {
            CapabilityError::new("invalid_parameters", "Clipboard text is required")
        })?;
        let source = input.get("source").and_then(Value::as_str).unwrap_or("pi");
        let item = crate::clipboard_inbox::add(&workspace_root, text, source)
            .map_err(|error| CapabilityError::new("add_failed", error))?;
        serde_json::to_value(item).map_err(|error| {
            CapabilityError::new(
                "serialization_failed",
                format!("Cannot serialize clipboard item: {error}"),
            )
        })
    }

    fn list_clipboard(&self, workspace_id: &str) -> Result<Value, CapabilityError> {
        let workspace_root = self.workspace_root(workspace_id)?;
        let items = crate::clipboard_inbox::list(&workspace_root);
        Ok(json!({ "items": items }))
    }

    fn list_habits(&self, workspace_id: &str) -> Result<Value, CapabilityError> {
        let workspace_root = self.workspace_root(workspace_id)?;
        let (habits, entries) = crate::habit_tracker::list(&workspace_root);
        Ok(json!({ "habits": habits, "entries": entries }))
    }

    fn toggle_habit(&self, workspace_id: &str, input: &Value) -> Result<Value, CapabilityError> {
        let workspace_root = self.workspace_root(workspace_id)?;
        let habit_id = input
            .get("habitId")
            .and_then(Value::as_str)
            .ok_or_else(|| CapabilityError::new("invalid_parameters", "Habit id is required"))?;
        let date = input
            .get("date")
            .and_then(Value::as_str)
            .ok_or_else(|| CapabilityError::new("invalid_parameters", "Habit date is required"))?;
        let entry = crate::habit_tracker::toggle(&workspace_root, habit_id, date)
            .map_err(|error| CapabilityError::new("toggle_failed", error))?;
        Ok(json!({ "entry": entry }))
    }

    fn translate_text(&self, scene_id: &str, input: &Value) -> Result<Value, CapabilityError> {
        let request: crate::translation::TranslationRequest = serde_json::from_value(input.clone())
            .map_err(|error| {
                CapabilityError::new(
                    "invalid_parameters",
                    format!("Invalid translation input: {error}"),
                )
            })?;
        let system_root = self.system_root.as_ref().ok_or_else(|| {
            CapabilityError::new("credential_unavailable", "System root is unavailable")
        })?;
        let endpoint = crate::model_tools::resolve(
            system_root,
            scene_id,
            input.get("provider").and_then(Value::as_str),
            input.get("model").and_then(Value::as_str),
        )
        .map_err(|error| CapabilityError::new("model_selection_unavailable", error))?;
        let api_key = if endpoint.choice.requires_key {
            crate::credential_broker::model_tool_credential(scene_id, &endpoint.choice.provider)
                .map_err(|error| CapabilityError::new("credential_unavailable", error))?
        } else {
            None
        };
        let result = crate::translation::translate(&request, &endpoint, api_key.as_deref())
            .map_err(|error| CapabilityError::new("translate_failed", error))?;
        serde_json::to_value(result).map_err(|error| {
            CapabilityError::new(
                "serialization_failed",
                format!("Cannot serialize translation result: {error}"),
            )
        })
    }

    fn add_watch(&self, workspace_id: &str, input: &Value) -> Result<Value, CapabilityError> {
        let workspace_root = self.workspace_root(workspace_id)?;
        let name = input
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| CapabilityError::new("invalid_parameters", "Watch name is required"))?;
        let url = input
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| CapabilityError::new("invalid_parameters", "Watch URL is required"))?;
        let item = crate::web_watch::add(&workspace_root, name, url)
            .map_err(|error| CapabilityError::new("add_failed", error))?;
        serde_json::to_value(item).map_err(|error| {
            CapabilityError::new(
                "serialization_failed",
                format!("Cannot serialize watch item: {error}"),
            )
        })
    }

    fn check_watch(&self, workspace_id: &str, input: &Value) -> Result<Value, CapabilityError> {
        let workspace_root = self.workspace_root(workspace_id)?;
        let id = input
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| CapabilityError::new("invalid_parameters", "Watch id is required"))?;
        let result = crate::web_watch::check(&workspace_root, id)
            .map_err(|error| CapabilityError::new("check_failed", error))?;
        serde_json::to_value(result).map_err(|error| {
            CapabilityError::new(
                "serialization_failed",
                format!("Cannot serialize watch result: {error}"),
            )
        })
    }

    fn extract_text(&self, workspace_id: &str, input: &Value) -> Result<Value, CapabilityError> {
        let workspace_root = self.workspace_root(workspace_id)?;
        let request: crate::ocr::OcrRequest =
            serde_json::from_value(input.clone()).map_err(|error| {
                CapabilityError::new("invalid_parameters", format!("Invalid OCR input: {error}"))
            })?;
        let result = crate::ocr::extract_text(&request, &workspace_root)
            .map_err(|error| CapabilityError::new("ocr_failed", error))?;
        serde_json::to_value(result).map_err(|error| {
            CapabilityError::new(
                "serialization_failed",
                format!("Cannot serialize OCR result: {error}"),
            )
        })
    }

    fn invoke_developer_worker(
        &self,
        registry: &PluginRegistry,
        invocation: &CapabilityInvocation,
        cancelled: Option<&AtomicBool>,
    ) -> Result<Value, CapabilityError> {
        self.invoke_worker(
            registry,
            &invocation.scene_id,
            &invocation.plugin_id,
            json!({ "capabilityId": invocation.capability_id }),
            invocation.input.clone(),
            cancelled,
        )
    }

    fn invoke_worker(
        &self,
        registry: &PluginRegistry,
        scene_id: &str,
        plugin_id: &str,
        handler: Value,
        input: Value,
        cancelled: Option<&AtomicBool>,
    ) -> Result<Value, CapabilityError> {
        worker_launch::WorkerLaunch::prepare(self, registry, scene_id, plugin_id, handler, input)?
            .run(cancelled)
    }

    fn get_note(&self, workspace_id: &str, input: &Value) -> Result<Value, CapabilityError> {
        let notebook_id = input
            .get("notebookId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let note_id = input
            .get("noteId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let note = self
            .notes
            .scoped(workspace_id)
            .map_err(notes_capability_error)?
            .get_note(notebook_id, note_id)
            .map_err(notes_capability_error)?;
        Ok(json!({ "note": note }))
    }

    fn create_note(&self, workspace_id: &str, input: &Value) -> Result<Value, CapabilityError> {
        let notebook_id = input
            .get("notebookId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let title = input
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let content = input
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let tags = input
            .get("tags")
            .and_then(Value::as_array)
            .map(|tags| {
                tags.iter()
                    .filter_map(Value::as_str)
                    .map(ToOwned::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        let note = self
            .notes
            .scoped(workspace_id)
            .map_err(notes_capability_error)?
            .create_note(notebook_id, title, content, tags, None, None)
            .map_err(notes_capability_error)?;
        Ok(json!({ "note": note }))
    }

    fn search_notes(&self, workspace_id: &str, input: &Value) -> Result<Value, CapabilityError> {
        if workspace_id.trim().is_empty() {
            return Err(CapabilityError::new(
                "invalid_parameters",
                "workspaceId is required for notes search",
            ));
        }
        let query = input
            .get("query")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_lowercase();
        let limit = input
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(20)
            .clamp(1, 50) as usize;
        let notes_root = self
            .data_root
            .join("com.zicode.notes")
            .join("vaults")
            .join(workspace_id);
        fs::create_dir_all(&notes_root).map_err(|_| {
            CapabilityError::new("storage_unavailable", "Notes storage unavailable")
        })?;
        let mut pending = vec![notes_root.clone()];
        let mut matches = Vec::new();
        let mut inspected = 0usize;
        while let Some(directory) = pending.pop() {
            let entries = fs::read_dir(&directory).map_err(|_| {
                CapabilityError::new("storage_unavailable", "Cannot read notes storage")
            })?;
            for entry in entries.flatten() {
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                if file_type.is_symlink() {
                    continue;
                }
                if file_type.is_dir() {
                    pending.push(entry.path());
                    continue;
                }
                if !file_type.is_file()
                    || entry.path().extension().and_then(|value| value.to_str()) != Some("md")
                {
                    continue;
                }
                inspected += 1;
                if inspected > MAX_NOTE_FILES {
                    break;
                }
                let Ok(metadata) = entry.metadata() else {
                    continue;
                };
                if metadata.len() > MAX_NOTE_FILE_BYTES {
                    continue;
                }
                let Ok(content) = fs::read_to_string(entry.path()) else {
                    continue;
                };
                let relative = entry
                    .path()
                    .strip_prefix(&notes_root)
                    .ok()
                    .map(|path| path.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default();
                let haystack = format!("{relative}\n{content}").to_lowercase();
                let Some(index) = haystack.find(&query) else {
                    continue;
                };
                let title = markdown_title(&content).unwrap_or_else(|| {
                    entry
                        .path()
                        .file_stem()
                        .and_then(|value| value.to_str())
                        .unwrap_or("Untitled")
                        .to_string()
                });
                let id = frontmatter_string(&content, "id").unwrap_or_else(|| relative.clone());
                matches.push(json!({
                    "id": id,
                    "path": relative,
                    "title": title,
                    "excerpt": excerpt_around(&haystack, index, 180),
                }));
                if matches.len() >= limit {
                    break;
                }
            }
            if matches.len() >= limit || inspected > MAX_NOTE_FILES {
                break;
            }
        }
        Ok(json!({
            "matches": matches,
            "truncated": inspected > MAX_NOTE_FILES
        }))
    }

    fn insert_idempotency(&mut self, key: String, value: CachedInvocation) {
        if !self.idempotency.contains_key(&key) {
            self.idempotency_order.push_back(key.clone());
        }
        self.idempotency.insert(key, value);
        while self.idempotency_order.len() > IDEMPOTENCY_CAPACITY {
            if let Some(oldest) = self.idempotency_order.pop_front() {
                self.idempotency.remove(&oldest);
            }
        }
    }

    fn write_audit(&self, record: AuditRecord<'_>) {
        let Ok(line) = serde_json::to_vec(&record) else {
            return;
        };
        let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.audit_path)
        else {
            return;
        };
        let _ = file.write_all(&line);
        let _ = file.write_all(b"\n");
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerProcessResponse {
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

fn notes_capability_error(error: crate::notes_vault::NotesError) -> CapabilityError {
    CapabilityError::new(error.code, error.message)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuditRecord<'a> {
    timestamp_ms: u128,
    caller: &'a str,
    scene_id: &'a str,
    plugin_id: &'a str,
    capability_id: &'a str,
    tool_call_id: Option<&'a str>,
    input_hash: &'a str,
    duration_ms: u128,
    ok: bool,
    error_code: Option<&'a str>,
}

pub(crate) fn validate_value(
    schema: &Value,
    value: &Value,
    path: &str,
) -> Result<(), CapabilityError> {
    let schema_type = schema.get("type").and_then(Value::as_str);
    let valid_type = match schema_type {
        Some("object") => value.is_object(),
        Some("array") => value.is_array(),
        Some("string") => value.is_string(),
        Some("integer") => value.as_i64().is_some() || value.as_u64().is_some(),
        Some("number") => value.is_number(),
        Some("boolean") => value.is_boolean(),
        Some("null") => value.is_null(),
        Some(_) | None => true,
    };
    if !valid_type {
        return Err(invalid_parameter(path, "has the wrong type"));
    }
    schema_constraints::validate_constraints(schema, value, path)?;
    if let Some(text) = value.as_str() {
        if schema
            .get("minLength")
            .and_then(Value::as_u64)
            .is_some_and(|minimum| text.chars().count() < minimum as usize)
        {
            return Err(invalid_parameter(path, "is too short"));
        }
        if schema
            .get("maxLength")
            .and_then(Value::as_u64)
            .is_some_and(|maximum| text.chars().count() > maximum as usize)
        {
            return Err(invalid_parameter(path, "is too long"));
        }
    }
    if let Some(number) = value.as_f64() {
        if schema
            .get("minimum")
            .and_then(Value::as_f64)
            .is_some_and(|minimum| number < minimum)
            || schema
                .get("maximum")
                .and_then(Value::as_f64)
                .is_some_and(|maximum| number > maximum)
        {
            return Err(invalid_parameter(path, "is outside the allowed range"));
        }
    }
    if let Some(object) = value.as_object() {
        let properties = schema
            .get("properties")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_else(Map::new);
        for required in schema
            .get("required")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            if !object.contains_key(required) {
                return Err(invalid_parameter(
                    &format!("{path}.{required}"),
                    "is required",
                ));
            }
        }
        if schema.get("additionalProperties").and_then(Value::as_bool) == Some(false)
            && object.keys().any(|key| !properties.contains_key(key))
        {
            return Err(invalid_parameter(path, "contains an undeclared property"));
        }
        for (key, item) in object {
            if let Some(property_schema) = properties.get(key) {
                validate_value(property_schema, item, &format!("{path}.{key}"))?;
            }
        }
    }
    if let Some(items) = value.as_array() {
        if let Some(item_schema) = schema.get("items") {
            for (index, item) in items.iter().enumerate() {
                validate_value(item_schema, item, &format!("{path}[{index}]"))?;
            }
        }
    }
    Ok(())
}

fn invalid_parameter(path: &str, reason: &str) -> CapabilityError {
    CapabilityError::new("invalid_parameters", format!("{path} {reason}"))
}

fn markdown_title(content: &str) -> Option<String> {
    if let Some(title) = frontmatter_string(content, "title") {
        return Some(title);
    }
    content
        .lines()
        .find_map(|line| line.trim().strip_prefix("# ").map(str::trim))
        .filter(|title| !title.is_empty())
        .map(str::to_string)
}

fn frontmatter_string(content: &str, key: &str) -> Option<String> {
    let rest = content.strip_prefix("---\n")?;
    let end = rest.find("\n---\n")?;
    let frontmatter = &rest[..end];
    let value = frontmatter.lines().find_map(|line| {
        let line = line.trim();
        Some(line.strip_prefix(key)?.strip_prefix(':')?.trim())
    })?;
    serde_json::from_str(value).ok()
}

fn excerpt_around(text: &str, match_index: usize, maximum_chars: usize) -> String {
    let prefix = &text[..match_index.min(text.len())];
    let start_chars = prefix.chars().count().saturating_sub(maximum_chars / 3);
    text.chars()
        .skip(start_chars)
        .take(maximum_chars)
        .collect::<String>()
        .replace('\n', " ")
}

fn hex_sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
mod tests {
    use super::{CapabilityBroker, CapabilityInvocation};
    use crate::plugin_registry::PluginRegistry;
    use serde_json::json;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn root() -> std::path::PathBuf {
        std::env::temp_dir()
            .join(format!(
                "zicode-capabilities-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ))
            .join("plugins")
    }

    #[test]
    fn cancelled_invocation_is_audited_without_caching_or_leaking_input() {
        let scratch =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
        fs::create_dir_all(&scratch).unwrap();
        let fixture = scratch.join(format!("broker-cancel-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&fixture).unwrap();
        fs::write(
            fixture.join("owner.json"),
            r#"{"purpose":"broker cancellation audit and retry; remove on success"}"#,
        )
        .unwrap();
        let plugin_root = fixture.join("plugins");
        let registry = PluginRegistry::open(plugin_root.clone()).unwrap();
        let mut broker = CapabilityBroker::new(plugin_root.clone()).unwrap();
        let invocation = CapabilityInvocation {
            caller: "chat".into(),
            scene_id: "programming".into(),
            workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".into(),
            plugin_id: "com.zicode.notes".into(),
            capability_id: "notes.search".into(),
            tool_call_id: Some("cancel-fixture".into()),
            idempotency_scope: Some("fixture-runtime".into()),
            input: json!({"query":"private-cancel-test-input", "limit":5}),
        };
        let flag = std::sync::atomic::AtomicBool::new(true);
        assert_eq!(
            broker
                .invoke_cancellable(&registry, invocation.clone(), Some(&flag))
                .unwrap_err()
                .code,
            "worker_cancelled"
        );
        assert!(broker.idempotency.is_empty());
        let audit = fs::read_to_string(plugin_root.join("audit/capabilities.jsonl")).unwrap();
        assert!(audit.contains("worker_cancelled"));
        assert!(!audit.contains("private-cancel-test-input"));
        flag.store(false, std::sync::atomic::Ordering::Release);
        assert!(broker
            .invoke_cancellable(&registry, invocation, Some(&flag))
            .is_ok());
        assert_eq!(broker.idempotency.len(), 1);
        drop(broker);
        drop(registry);
        assert!(fixture
            .canonicalize()
            .unwrap()
            .starts_with(scratch.canonicalize().unwrap()));
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn searches_managed_markdown_without_leaking_absolute_paths() {
        let root = root();
        let registry = PluginRegistry::open(root.clone()).unwrap();
        let notebook_id = "11111111-1111-4111-8111-111111111111";
        let workspace_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let notes = root
            .parent()
            .unwrap()
            .join("plugin-data/com.zicode.notes/vaults")
            .join(workspace_id)
            .join(notebook_id)
            .join("src/content/notes");
        fs::create_dir_all(&notes).unwrap();
        fs::write(
            notes.join("roadmap.md"),
            "---\nid: \"22222222-2222-4222-8222-222222222222\"\ntitle: \"Roadmap\"\n---\n\nThe plugin broker milestone is ready.",
        )
        .unwrap();
        let mut broker = CapabilityBroker::new(root.clone()).unwrap();
        let result = broker
            .invoke(
                &registry,
                CapabilityInvocation {
                    caller: "chat".into(),
                    scene_id: "programming".into(),
                    workspace_id: workspace_id.into(),
                    plugin_id: "com.zicode.notes".into(),
                    capability_id: "notes.search".into(),
                    tool_call_id: None,
                    idempotency_scope: None,
                    input: json!({"query": "broker", "limit": 5}),
                },
            )
            .unwrap();
        assert_eq!(result["matches"][0]["title"], "Roadmap");
        assert_eq!(
            result["matches"][0]["path"],
            format!("{notebook_id}/src/content/notes/roadmap.md")
        );
        assert!(!result
            .to_string()
            .contains(&root.to_string_lossy().to_string()));
        let audit = fs::read_to_string(root.join("audit/capabilities.jsonl")).unwrap();
        assert!(audit.contains("\"inputHash\""));
        assert!(!audit.contains("broker"));
        let _ = fs::remove_dir_all(root.parent().unwrap());
    }

    #[test]
    fn rejects_invalid_input_and_reuses_idempotent_tool_results() {
        let root = root();
        let registry = PluginRegistry::open(root.clone()).unwrap();
        let mut broker = CapabilityBroker::new(root.clone()).unwrap();
        let invalid = broker.invoke(
            &registry,
            CapabilityInvocation {
                caller: "pi".into(),
                scene_id: "programming".into(),
                workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".into(),
                plugin_id: "com.zicode.notes".into(),
                capability_id: "notes.search".into(),
                tool_call_id: None,
                idempotency_scope: None,
                input: json!({"query": "", "unexpected": true}),
            },
        );
        assert_eq!(invalid.unwrap_err().code, "invalid_parameters");
        let invoke = |query: &str| CapabilityInvocation {
            caller: "pi".into(),
            scene_id: "programming".into(),
            workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".into(),
            plugin_id: "com.zicode.notes".into(),
            capability_id: "notes.search".into(),
            tool_call_id: Some("call-1".into()),
            idempotency_scope: Some("runtime-1".into()),
            input: json!({"query": query}),
        };
        broker.invoke(&registry, invoke("first")).unwrap();
        assert_eq!(
            broker
                .invoke(&registry, invoke("different"))
                .unwrap_err()
                .code,
            "idempotency_conflict"
        );
        let _ = fs::remove_dir_all(root.parent().unwrap());
    }

    #[test]
    fn creates_and_reads_notes_through_pi_capabilities() {
        let root = root();
        let registry = PluginRegistry::open(root.clone()).unwrap();
        let vault = crate::notes_vault::NotesVault::new(root.clone()).unwrap();
        let workspace_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        let scoped = vault.scoped(workspace_id).unwrap();
        let notebook = scoped.create_notebook("Agent notes", None, None).unwrap();
        // Fixture setup must release the exclusive workspace lock before Broker access.
        drop(scoped);
        let mut broker = CapabilityBroker::new(root.clone()).unwrap();

        let created = broker
            .invoke(
                &registry,
                CapabilityInvocation {
                    caller: "pi".into(),
                    scene_id: "programming".into(),
                    workspace_id: workspace_id.into(),
                    plugin_id: "com.zicode.notes".into(),
                    capability_id: "notes.create".into(),
                    tool_call_id: Some("create-1".into()),
                    idempotency_scope: Some("session-1".into()),
                    input: json!({
                        "notebookId": &notebook.id,
                        "title": "Decision log",
                        "content": "Use Markdown as source of truth.",
                        "tags": ["architecture"]
                    }),
                },
            )
            .unwrap();
        let note_id = created["note"]["id"].as_str().unwrap();

        let read = broker
            .invoke(
                &registry,
                CapabilityInvocation {
                    caller: "pi".into(),
                    scene_id: "programming".into(),
                    workspace_id: workspace_id.into(),
                    plugin_id: "com.zicode.notes".into(),
                    capability_id: "notes.get".into(),
                    tool_call_id: None,
                    idempotency_scope: None,
                    input: json!({ "notebookId": &notebook.id, "noteId": note_id }),
                },
            )
            .unwrap();
        assert_eq!(read["note"]["title"], "Decision log");
        assert_eq!(read["note"]["content"], "Use Markdown as source of truth.");

        let _ = fs::remove_dir_all(root.parent().unwrap());
    }
    #[test]
    fn cached_results_bind_invocation_identity_and_recheck_current_pi_grants() {
        let scratch = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/task-scratch")
            .join(format!("broker-identity-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&scratch).unwrap();
        fs::write(scratch.join("owner.json"), json!({"purpose":"isolated Broker cache acceptance","pid":std::process::id(),"lifetime":"removed on success, retained for failures"}).to_string()).unwrap();
        let root = scratch.join("plugins");
        let mut registry = PluginRegistry::open(root.clone()).unwrap();
        let mut broker = CapabilityBroker::new(root.clone()).unwrap();
        let workspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let invocation = CapabilityInvocation {
            caller: "pi".into(),
            scene_id: "programming".into(),
            workspace_id: workspace.into(),
            plugin_id: "com.zicode.notes".into(),
            capability_id: "notes.search".into(),
            tool_call_id: Some("cache-call".into()),
            idempotency_scope: Some("cache-runtime".into()),
            input: json!({"query":"cache-evidence"}),
        };
        let first = broker.invoke(&registry, invocation.clone()).unwrap();
        assert!(first["matches"].as_array().unwrap().is_empty());
        let vault = crate::notes_vault::NotesVault::new(root).unwrap();
        let scoped = vault.scoped(workspace).unwrap();
        let notebook = scoped.create_notebook("Cache test", None, None).unwrap();
        scoped
            .create_note(
                &notebook.id,
                "cache-evidence",
                "new text",
                vec![],
                None,
                None,
            )
            .unwrap();
        assert_eq!(broker.invoke(&registry, invocation.clone()).unwrap(), first);
        for field in ["caller", "scene", "workspace", "capability"] {
            let mut changed = invocation.clone();
            match field {
                "caller" => changed.caller = "chat".into(),
                "scene" => changed.scene_id = "writing".into(),
                "workspace" => changed.workspace_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb".into(),
                _ => changed.capability_id = "notes.get".into(),
            }
            assert_eq!(
                broker.invoke(&registry, changed).unwrap_err().code,
                "idempotency_conflict",
                "{field}"
            );
        }
        let mut other_plugin = invocation.clone();
        other_plugin.plugin_id = "com.other.plugin".into();
        assert_eq!(
            broker.invoke(&registry, other_plugin).unwrap_err().code,
            "capability_unavailable"
        );
        registry
            .set_enabled("programming", "com.zicode.notes", false)
            .unwrap();
        assert_eq!(
            broker
                .invoke(&registry, invocation.clone())
                .unwrap_err()
                .code,
            "capability_unavailable"
        );
        registry
            .set_enabled("programming", "com.zicode.notes", true)
            .unwrap();
        registry
            .set_permission(
                "programming",
                "com.zicode.notes",
                "pi.tools.register",
                false,
            )
            .unwrap();
        assert_eq!(
            broker
                .invoke(&registry, invocation.clone())
                .unwrap_err()
                .code,
            "capability_unavailable"
        );
        registry
            .set_permission("programming", "com.zicode.notes", "pi.tools.register", true)
            .unwrap();
        assert_eq!(
            broker
                .invoke(&registry, invocation.clone())
                .unwrap_err()
                .code,
            "idempotency_authority_changed"
        );
        let mut fresh = invocation;
        fresh.tool_call_id = Some("fresh-after-review".into());
        assert_eq!(
            broker.invoke(&registry, fresh).unwrap()["matches"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        drop(broker);
        drop(registry);
        drop(scoped);
        drop(vault);
        fs::remove_dir_all(scratch).unwrap();
    }

    #[test]
    fn cache_scope_and_call_ids_have_unambiguous_boundaries() {
        let scratch = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/task-scratch")
            .join(format!("broker-key-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&scratch).unwrap();
        fs::write(
            scratch.join("owner.json"),
            json!({"purpose":"Broker key boundary acceptance","pid":std::process::id()})
                .to_string(),
        )
        .unwrap();
        let root = scratch.join("plugins");
        let registry = PluginRegistry::open(root.clone()).unwrap();
        let mut broker = CapabilityBroker::new(root).unwrap();
        for (scope, call) in [("runtime:one", "call"), ("runtime", "one:call")] {
            broker
                .invoke(
                    &registry,
                    CapabilityInvocation {
                        caller: "pi".into(),
                        scene_id: "programming".into(),
                        workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".into(),
                        plugin_id: "com.zicode.notes".into(),
                        capability_id: "notes.search".into(),
                        tool_call_id: Some(call.into()),
                        idempotency_scope: Some(scope.into()),
                        input: json!({"query":"same"}),
                    },
                )
                .unwrap();
        }
        assert_eq!(broker.idempotency.len(), 2);
        drop(broker);
        drop(registry);
        fs::remove_dir_all(scratch).unwrap();
    }
}
