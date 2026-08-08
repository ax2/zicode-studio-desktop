use crate::notes_vault::NotesVault;
use crate::plugin_registry::{PluginCapabilityDescriptor, PluginRegistry};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::Stdio;
use std::thread;
use std::time::Duration;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

pub const MAX_CAPABILITY_INPUT_BYTES: usize = 256 * 1024;
pub const MAX_CAPABILITY_OUTPUT_BYTES: usize = 1024 * 1024;
const MAX_NOTE_FILES: usize = 500;
const MAX_NOTE_FILE_BYTES: u64 = 2 * 1024 * 1024;
const IDEMPOTENCY_CAPACITY: usize = 256;
const WORKER_TIMEOUT: Duration = Duration::from_secs(5);

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
    input_hash: String,
    result: Value,
}

pub struct CapabilityBroker {
    data_root: PathBuf,
    notes: NotesVault,
    audit_path: PathBuf,
    idempotency: HashMap<String, CachedInvocation>,
    idempotency_order: VecDeque<String>,
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
            data_root,
            notes,
            audit_path: audit_root.join("capabilities.jsonl"),
            idempotency: HashMap::new(),
            idempotency_order: VecDeque::new(),
        })
    }

    pub fn invoke(
        &mut self,
        registry: &PluginRegistry,
        invocation: CapabilityInvocation,
    ) -> Result<Value, CapabilityError> {
        let started = Instant::now();
        let input_bytes = serde_json::to_vec(&invocation.input).map_err(|_| {
            CapabilityError::new("invalid_parameters", "Capability input is not serializable")
        })?;
        let input_hash = hex_sha256(&input_bytes);
        if input_bytes.len() > MAX_CAPABILITY_INPUT_BYTES {
            let error =
                CapabilityError::new("payload_too_large", "Capability input exceeds 256 KiB");
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
        let cache_key = invocation
            .idempotency_scope
            .as_ref()
            .zip(invocation.tool_call_id.as_ref())
            .map(|(scope, call)| format!("{scope}:{call}"));
        let outcome = if let Some(key) = &cache_key {
            if let Some(cached) = self.idempotency.get(key) {
                if cached.input_hash != input_hash {
                    Err(CapabilityError::new(
                        "idempotency_conflict",
                        "toolCallId was already used with different input",
                    ))
                } else {
                    Ok(cached.result.clone())
                }
            } else {
                self.invoke_uncached(registry, &invocation)
            }
        } else {
            self.invoke_uncached(registry, &invocation)
        };
        if let (Ok(result), Some(key)) = (&outcome, cache_key) {
            self.insert_idempotency(
                key,
                CachedInvocation {
                    input_hash: input_hash.clone(),
                    result: result.clone(),
                },
            );
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

    fn invoke_uncached(
        &self,
        registry: &PluginRegistry,
        invocation: &CapabilityInvocation,
    ) -> Result<Value, CapabilityError> {
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
        validate_value(&capability.input_schema, &invocation.input, "$")?;
        let result = self.dispatch(registry, &capability, invocation)?;
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
                "Command arguments exceed 256 KiB",
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
        )
    }

    fn dispatch(
        &self,
        registry: &PluginRegistry,
        capability: &PluginCapabilityDescriptor,
        invocation: &CapabilityInvocation,
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
            _ => self.invoke_developer_worker(registry, invocation),
        }
    }

    fn invoke_developer_worker(
        &self,
        registry: &PluginRegistry,
        invocation: &CapabilityInvocation,
    ) -> Result<Value, CapabilityError> {
        self.invoke_worker(
            registry,
            &invocation.scene_id,
            &invocation.plugin_id,
            json!({ "capabilityId": invocation.capability_id }),
            invocation.input.clone(),
        )
    }

    fn invoke_worker(
        &self,
        registry: &PluginRegistry,
        scene_id: &str,
        plugin_id: &str,
        handler: Value,
        input: Value,
    ) -> Result<Value, CapabilityError> {
        let (worker_path, worker_kind) = registry
            .plugin_runtime_entry(scene_id, plugin_id)
            .map_err(|error| CapabilityError::new("plugin_not_active", error))?;
        let executable = std::env::current_exe().map_err(|error| {
            CapabilityError::new(
                "plugin_not_active",
                format!("Cannot locate plugin worker executable: {error}"),
            )
        })?;
        let mut command = crate::process_command::new_command(executable);
        command
            .arg("--zicode-plugin-worker")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = command.spawn().map_err(|error| {
            CapabilityError::new(
                "plugin_not_active",
                format!("Cannot start plugin Worker Runtime: {error}"),
            )
        })?;
        let mut request = json!({
            "workerPath": worker_path,
            "workerKind": worker_kind,
            "pluginId": plugin_id,
            "sceneId": scene_id,
            "input": input,
        });
        if let (Some(request), Some(handler)) = (request.as_object_mut(), handler.as_object()) {
            request.extend(handler.clone());
        }
        if let Some(mut stdin) = child.stdin.take() {
            serde_json::to_writer(&mut stdin, &request).map_err(|error| {
                let _ = child.kill();
                CapabilityError::new(
                    "worker_protocol_error",
                    format!("Cannot send Worker request: {error}"),
                )
            })?;
        }
        let started = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if started.elapsed() < WORKER_TIMEOUT => {
                    thread::sleep(Duration::from_millis(10));
                }
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(CapabilityError::new(
                        "worker_timeout",
                        "Plugin Worker exceeded the 5 second execution limit",
                    ));
                }
                Err(error) => {
                    let _ = child.kill();
                    return Err(CapabilityError::new(
                        "worker_failed",
                        format!("Cannot monitor plugin Worker: {error}"),
                    ));
                }
            }
        };
        let mut output = Vec::new();
        child
            .stdout
            .take()
            .ok_or_else(|| CapabilityError::new("worker_protocol_error", "Worker stdout missing"))?
            .take((MAX_CAPABILITY_OUTPUT_BYTES + 64 * 1024) as u64)
            .read_to_end(&mut output)
            .map_err(|error| {
                CapabilityError::new(
                    "worker_protocol_error",
                    format!("Cannot read Worker response: {error}"),
                )
            })?;
        let response: WorkerProcessResponse = serde_json::from_slice(&output).map_err(|_| {
            CapabilityError::new(
                "worker_protocol_error",
                "Plugin Worker returned an invalid response",
            )
        })?;
        if !status.success() || !response.ok {
            return Err(CapabilityError::new(
                "worker_failed",
                response
                    .error
                    .unwrap_or_else(|| "Plugin Worker execution failed".into()),
            ));
        }
        response.result.ok_or_else(|| {
            CapabilityError::new("worker_protocol_error", "Plugin Worker result is missing")
        })
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

fn validate_value(schema: &Value, value: &Value, path: &str) -> Result<(), CapabilityError> {
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
        if schema.get("additionalProperties").and_then(Value::as_bool) == Some(false) {
            if let Some(key) = object.keys().find(|key| !properties.contains_key(*key)) {
                return Err(invalid_parameter(
                    &format!("{path}.{key}"),
                    "is not allowed",
                ));
            }
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
}
