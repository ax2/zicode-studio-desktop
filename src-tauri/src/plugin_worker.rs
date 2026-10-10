use boa_engine::{Context, Source};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io;
use std::path::Path;
#[path = "plugin_worker_failures.rs"]
pub(crate) mod failures;
#[path = "plugin_worker_stack.rs"]
mod execution_stack;
#[cfg(test)]
#[path = "plugin_worker_diagnostics_tests.rs"]
mod diagnostics_tests;
#[path = "plugin_worker_resource_input.rs"]
pub(crate) mod resource_input;
#[cfg(test)]
#[path = "plugin_worker_resource_process_tests.rs"]
mod resource_process_tests;
#[path = "plugin_worker_resource_reads.rs"]
mod resource_reads;
#[path = "plugin_worker_resource_output.rs"]
pub(crate) mod resource_output;
#[path = "plugin_worker_resource_writes.rs"]
mod resource_writes;
const MAX_WORKER_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerRequest {
    worker_path: String,
    #[serde(default = "default_worker_kind")]
    worker_kind: String,
    plugin_id: String,
    #[serde(default)]
    capability_id: Option<String>,
    #[serde(default)]
    command_id: Option<String>,
    scene_id: String,
    input: Value,
}

fn default_worker_kind() -> String {
    "javascript".to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerResponse {
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

pub fn run_stdio() -> i32 {
    let response = resource_input::read(io::stdin().lock()).and_then(|input| {
        let binary = match input.request.get("resourceOutputProfile") {
            None => false,
            Some(Value::String(profile)) if profile == resource_output::PROFILE
                && !input.resources.is_empty() && input.module.is_some() => true,
            _ => return Err("Unsupported resource output profile".into()),
        };
        let request = serde_json::from_value::<WorkerRequest>(input.request)
            .map_err(|_| "Invalid Worker request".to_string())?;
        if input.resources.is_empty() {
            execute(request).map(resource_output::Bundle::json)
        } else {
            execution_stack::execute(move || execute_wasi_bundle(
                &request, wasmtime::OptLevel::None, input.resources, input.module, binary,
            ))
        }
    });
    let output = match response {
        Ok(bundle) if bundle.binary => return match resource_output::write(io::stdout().lock(), &bundle) {
            Ok(()) => 0,
            Err(_) => 2,
        },
        Ok(result) => WorkerResponse {
            ok: true,
            result: Some(result.result),
            error: None,
        },
        Err(error) => WorkerResponse {
            ok: false,
            result: None,
            error: Some(error),
        },
    };
    match serde_json::to_writer(io::stdout(), &output) {
        Ok(()) if output.ok => 0,
        Ok(()) => 1,
        Err(_) => 2,
    }
}

fn execute(request: WorkerRequest) -> Result<Value, String> {
    if request.worker_kind == "wasi" {
        return execute_wasi(&request);
    }
    if request.worker_kind != "javascript" {
        return Err("Unsupported plugin worker kind".into());
    }
    let worker_path = Path::new(&request.worker_path);
    let metadata =
        fs::metadata(worker_path).map_err(|error| format!("Cannot inspect worker: {error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_WORKER_BYTES {
        return Err("Worker must be a JavaScript file no larger than 1 MiB".into());
    }
    let source =
        fs::read_to_string(worker_path).map_err(|error| format!("Cannot read worker: {error}"))?;
    if source.contains('\0') {
        return Err("Worker contains invalid null bytes".into());
    }
    let context_json = serde_json::to_string(&serde_json::json!({
        "pluginId": request.plugin_id,
        "sceneId": request.scene_id,
    }))
    .map_err(|error| error.to_string())?;
    let (handler_collection, handler_id) = match (&request.capability_id, &request.command_id) {
        (Some(capability), None) => ("__zicodeHandlers", capability),
        (None, Some(command)) => ("__zicodeCommands", command),
        _ => return Err("Worker request must select exactly one handler".into()),
    };
    let handler_json = serde_json::to_string(handler_id).map_err(|error| error.to_string())?;
    let input_json = serde_json::to_string(&request.input).map_err(|error| error.to_string())?;
    let program = format!(
        r#"
"use strict";
globalThis.zicode = Object.freeze({{
  capabilities: Object.freeze({{
    register(id, handler) {{
      if (typeof id !== "string" || typeof handler !== "function") throw new TypeError("Invalid capability handler");
      if (Object.prototype.hasOwnProperty.call(globalThis.__zicodeHandlers, id)) throw new Error("Duplicate capability handler");
      globalThis.__zicodeHandlers[id] = handler;
    }}
  }}),
  commands: Object.freeze({{
    register(id, handler) {{
      if (typeof id !== "string" || typeof handler !== "function") throw new TypeError("Invalid command handler");
      if (Object.prototype.hasOwnProperty.call(globalThis.__zicodeCommands, id)) throw new Error("Duplicate command handler");
      globalThis.__zicodeCommands[id] = handler;
    }}
  }})
}});
globalThis.__zicodeHandlers = Object.create(null);
globalThis.__zicodeCommands = Object.create(null);
{source}
const __handler = globalThis.{handler_collection}[{handler_json}];
if (typeof __handler !== "function") throw new Error("Worker handler is not registered");
__handler({input_json}, Object.freeze({context_json}));
"#
    );
    let mut context = Context::default();
    let value = context
        .eval(Source::from_bytes(&program))
        .map_err(|error| format!("Worker execution failed: {error}"))?;
    value
        .to_json(&mut context)
        .map_err(|error| format!("Worker result is not JSON-compatible: {error}"))?
        .ok_or_else(|| "Worker returned undefined".to_string())
}

fn execute_wasi(request: &WorkerRequest) -> Result<Value, String> {
    execute_wasi_with_optimization(request, wasmtime::OptLevel::None)
}

fn execute_wasi_with_optimization(
    request: &WorkerRequest,
    optimization: wasmtime::OptLevel,
) -> Result<Value, String> {
    execute_wasi_resource(request, optimization, Vec::new())
}

fn execute_wasi_resource(
    request: &WorkerRequest,
    optimization: wasmtime::OptLevel,
    resources: Vec<resource_input::Resource>,
) -> Result<Value, String> {
    let request = request.clone();
    execution_stack::execute(move || execute_wasi_snapshot(&request, optimization, resources, None))
}

fn execute_wasi_snapshot(
    request: &WorkerRequest,
    optimization: wasmtime::OptLevel,
    resources: Vec<resource_input::Resource>,
    module_snapshot: Option<Vec<u8>>,
) -> Result<Value, String> {
    execute_wasi_bundle(request, optimization, resources, module_snapshot, false).map(|bundle| bundle.result)
}

fn execute_wasi_bundle(
    request: &WorkerRequest,
    optimization: wasmtime::OptLevel,
    resources: Vec<resource_input::Resource>,
    module_snapshot: Option<Vec<u8>>,
    binary: bool,
) -> Result<resource_output::Bundle, String> {
    use wasmtime::{Config, Engine, Linker, Module, Store, StoreLimits, StoreLimitsBuilder};
    #[cfg(test)]
    let started = std::time::Instant::now();
    use wasmtime_wasi::p2::pipe::{MemoryInputPipe, MemoryOutputPipe};
    use wasmtime_wasi::preview1::{self, WasiP1Ctx};
    use wasmtime_wasi::WasiCtxBuilder;

    if module_snapshot
        .as_ref()
        .is_some_and(|bytes| bytes.is_empty() || bytes.len() > MAX_WORKER_BYTES as usize * 2)
    {
        return Err("WASI module must be no larger than 2 MiB".into());
    }
    let worker_path = Path::new(&request.worker_path);
    if module_snapshot.is_none() {
        let metadata = fs::metadata(worker_path)
            .map_err(|error| format!("Cannot inspect WASI module: {error}"))?;
        if !metadata.is_file() || metadata.len() > MAX_WORKER_BYTES * 2 {
            return Err("WASI module must be no larger than 2 MiB".into());
        }
    }
    let resource_mode = !resources.is_empty();
    let mut envelope = serde_json::json!({
        "pluginId": request.plugin_id,
        "sceneId": request.scene_id,
        "capabilityId": request.capability_id,
        "commandId": request.command_id,
        "input": request.input,
    });
    if resource_mode {
        if binary { envelope["resourceOutputProfile"] = Value::String(resource_output::PROFILE.into()); }
        envelope["resourceInputProfile"] = Value::String(
            if module_snapshot.is_some() {
                "resource.wasi.input.draft2"
            } else {
                "resource.wasi.input.draft1"
            }
            .into(),
        );
        envelope["resources"] = serde_json::json!(resources.iter().enumerate().map(|(index, r)| {
            serde_json::json!({"index":index,"resourceId":r.descriptor.resource_id,"contentVersion":r.descriptor.content_version,"mimeType":r.descriptor.mime_type,"byteLength":r.bytes.len()})
        }).collect::<Vec<_>>());
    }
    let input = serde_json::to_vec(&envelope)
        .map_err(|error| format!("Cannot encode WASI input: {error}"))?;
    let stdin = MemoryInputPipe::new(input);
    let stdout = MemoryOutputPipe::new(1024 * 1024);
    let stderr = MemoryOutputPipe::new(64 * 1024);
    let mut config = Config::new();
    // These command workers are freshly compiled per invocation. Prefer cold
    // startup over optimizing a short bounded operation; isolation/fuel remain.
    config.cranelift_opt_level(optimization);
    config.consume_fuel(true);
    config.max_wasm_stack(2 * 1024 * 1024);
    let engine =
        Engine::new(&config).map_err(|error| format!("Cannot start WASI engine: {error}"))?;
    #[cfg(test)]
    eprintln!("WASI phase=engine_ready elapsed_us={}", started.elapsed().as_micros());
    let module = if let Some(bytes) = &module_snapshot {
        Module::new(&engine, bytes)
    } else {
        Module::from_file(&engine, worker_path)
    }
    .map_err(|error| format!("Cannot compile WASI module: {error}"))?;
    #[cfg(test)]
    let compiled = started.elapsed();
    #[cfg(test)]
    eprintln!("WASI phase=module_compiled elapsed_us={}", compiled.as_micros());
    struct WasiState {
        context: WasiP1Ctx,
        limits: StoreLimits,
        reads: resource_reads::Reads,
        writes: resource_writes::Writes,
    }
    let mut linker: Linker<WasiState> = Linker::new(&engine);
    preview1::add_to_linker_sync(&mut linker, |state| &mut state.context)
        .map_err(|error| format!("Cannot link WASI module: {error}"))?;
    if resource_mode {
        resource_reads::link(&mut linker, |state| &mut state.reads)?;
    }
    if binary { resource_writes::link(&mut linker, |state| &mut state.writes)?; }
    let wasi = WasiCtxBuilder::new()
        .stdin(stdin)
        .stdout(stdout.clone())
        .stderr(stderr.clone())
        .args(&["zicode-plugin"])
        .build_p1();
    let limits = StoreLimitsBuilder::new()
        .memory_size(if resource_mode { 256 } else { 64 } * 1024 * 1024)
        .instances(1)
        .memories(2)
        .tables(4)
        .build();
    let mut store = Store::new(
        &engine,
        WasiState {
            context: wasi,
            limits,
            reads: resource_reads::Reads::new(resources),
            writes: resource_writes::Writes::default(),
        },
    );
    store.limiter(|state| &mut state.limits);
    store
        .set_fuel(10_000_000)
        .map_err(|error| format!("Cannot set WASI execution budget: {error}"))?;
    let instance = linker
        .instantiate(&mut store, &module)
        .map_err(|error| format!("Cannot instantiate WASI module: {error}"))?;
    let start = instance
        .get_typed_func::<(), ()>(&mut store, "_start")
        .map_err(|_| "WASI module must export _start".to_string())?;
    #[cfg(test)]
    let execution_started = std::time::Instant::now();
    #[cfg(test)]
    eprintln!("WASI phase=guest_start elapsed_us={}", started.elapsed().as_micros());
    let execution = start.call(&mut store, ());
    #[cfg(test)]
    eprintln!("WASI budgets compile_ms={} execution_ms={} fuel_remaining={}",
        compiled.as_millis(), execution_started.elapsed().as_millis(), store.get_fuel().unwrap_or(0));
    if let Err(error) = execution {
        // Preview1 proc_exit(0) is a successful command termination, but
        // still require one complete JSON result below. Nonzero exits/traps fail.
        if error
            .downcast_ref::<wasmtime_wasi::I32Exit>()
            .map(|exit| exit.0)
            != Some(0)
        {
            return Err(failures::execution(&error).into());
        }
    }
    let bytes = stdout.contents();
    if bytes.is_empty() {
        return Err("WASI module returned an empty response".into());
    }
    #[cfg(test)]
    eprintln!(
        "WASI timing optimization={optimization:?} compile_ms={} total_ms={}",
        compiled.as_millis(),
        started.elapsed().as_millis()
    );
    let result = serde_json::from_slice(&bytes).map_err(|_| "WASI module stdout must be one JSON value".to_string())?;
    let resources = store.into_data().writes.finish()?;
    Ok(resource_output::Bundle { binary, result, resources })
}

#[cfg(test)]
mod tests {
    use super::{execute, WorkerRequest};
    use serde_json::json;
    use std::fs;

    #[test]
    fn executes_a_registered_capability_without_host_apis() {
        let path = std::env::temp_dir().join(format!(
            "zicode-worker-capability-{}.js",
            std::process::id()
        ));
        fs::write(
            &path,
            r#"zicode.capabilities.register("demo.echo", (input, call) => ({ value: input.value, scene: call.sceneId }));"#,
        )
        .unwrap();
        let result = execute(WorkerRequest {
            worker_path: path.to_string_lossy().into_owned(),
            worker_kind: "javascript".into(),
            plugin_id: "com.example.demo".into(),
            capability_id: Some("demo.echo".into()),
            command_id: None,
            scene_id: "programming".into(),
            input: json!({ "value": "hello" }),
        })
        .unwrap();
        assert_eq!(result, json!({ "value": "hello", "scene": "programming" }));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn executes_a_registered_command_without_host_apis() {
        let path =
            std::env::temp_dir().join(format!("zicode-worker-command-{}.js", std::process::id()));
        fs::write(
            &path,
            r#"zicode.commands.register("demo.run", (args, call) => ({ message: args.message, plugin: call.pluginId }));"#,
        )
        .unwrap();
        let result = execute(WorkerRequest {
            worker_path: path.to_string_lossy().into_owned(),
            worker_kind: "javascript".into(),
            plugin_id: "com.example.demo".into(),
            capability_id: None,
            command_id: Some("demo.run".into()),
            scene_id: "programming".into(),
            input: json!({ "message": "done" }),
        })
        .unwrap();
        assert_eq!(
            result,
            json!({ "message": "done", "plugin": "com.example.demo" })
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn executes_a_wasi_module_without_host_directories_or_network() {
        let path =
            std::env::temp_dir().join(format!("zicode-worker-wasi-{}.wat", std::process::id()));
        fs::write(
            &path,
            r#"(module
              (import "wasi_snapshot_preview1" "fd_write"
                (func $fd_write (param i32 i32 i32 i32) (result i32)))
              (memory (export "memory") 1)
              (data (i32.const 8) "{\22value\22:\22wasi\22}")
              (func (export "_start")
                (i32.store (i32.const 0) (i32.const 8))
                (i32.store (i32.const 4) (i32.const 16))
                (drop (call $fd_write
                  (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 24))))
            )"#,
        )
        .unwrap();
        let result = execute(WorkerRequest {
            worker_path: path.to_string_lossy().into_owned(),
            worker_kind: "wasi".into(),
            plugin_id: "com.example.wasi".into(),
            capability_id: Some("demo.echo".into()),
            command_id: None,
            scene_id: "programming".into(),
            input: json!({ "value": "hello" }),
        })
        .unwrap();
        assert_eq!(result, json!({ "value": "wasi" }));
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn preview1_successful_exit_requires_complete_json_and_nonzero_exit_fails() {
        for (code, payload, valid) in [
            (0, r#"{"ok":true}"#, true),
            (0, "", false),
            (0, "incomplete", false),
            (7, r#"{"ok":true}"#, false),
        ] {
            let path =
                std::env::temp_dir().join(format!("zicode-exit-{}.wat", uuid::Uuid::new_v4()));
            let escaped = payload
                .bytes()
                .map(|b| format!("\\{b:02x}"))
                .collect::<String>();
            fs::write(&path, format!(r#"(module
                (import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32)))
                (import "wasi_snapshot_preview1" "proc_exit" (func $exit (param i32)))
                (memory (export "memory") 1) (data (i32.const 8) "{escaped}")
                (func (export "_start")
                    (i32.store (i32.const 0) (i32.const 8))
                    (i32.store (i32.const 4) (i32.const {length}))
                    (drop (call $write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 100)))
                    (call $exit (i32.const {code}))))"#, length=payload.len())).unwrap();
            let result = execute(WorkerRequest {
                worker_path: path.to_string_lossy().into_owned(),
                worker_kind: "wasi".into(),
                plugin_id: "com.example.exit".into(),
                capability_id: Some("exit.test".into()),
                command_id: None,
                scene_id: "programming".into(),
                input: json!({}),
            });
            fs::remove_file(path).unwrap();
            assert_eq!(
                result.is_ok(),
                valid,
                "exit={code} payload={payload:?} result={result:?}"
            );
        }
    }

    #[test]
    fn actual_devtools_candidate_conforms_and_outputs_can_feed_another_tool() {
        use base64::Engine as _;
        use sha2::{Digest, Sha256};
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/devtools-text-dev57");
        let module = root.join("runtime/tools.wasm");
        let bytes = fs::read(&module).unwrap();
        assert_eq!(
            format!("{:x}", Sha256::digest(&bytes)),
            "abfd0dbe45c064c4f8e40a5945c004694eb356cdf13688f8d7adf6536e64f20a"
        );
        let call = |capability: &str, input: serde_json::Value| {
            execute(WorkerRequest {
                worker_path: module.to_string_lossy().into_owned(),
                worker_kind: "wasi".into(),
                plugin_id: "com.zicode.devtools.text".into(),
                capability_id: Some(capability.into()),
                command_id: None,
                scene_id: "programming".into(),
                input,
            })
            .unwrap()
        };
        let fixtures: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join("fixtures/text.json")).unwrap()).unwrap();
        for case in fixtures["cases"].as_array().unwrap() {
            let input = if let Some(generator) = case.get("inputGenerator") {
                json!({"text":generator["textRepeat"].as_str().unwrap().repeat(generator["count"].as_u64().unwrap() as usize)})
            } else {
                case["input"].clone()
            };
            let result = call(case["capabilityId"].as_str().unwrap(), input);
            assert_eq!(result["contractVersion"], "1.0.0-rc.1", "{}", case["id"]);
            if let Some(error) = case.get("expectedError") {
                assert_eq!(result["ok"], false, "{}", case["id"]);
                assert!(result["data"].is_null());
                assert_eq!(&result["error"]["code"], error, "{}", case["id"]);
                assert!(result["error"]["message"].as_str().unwrap().chars().count() <= 240);
            } else {
                assert_eq!(result["ok"], true, "{}: {result}", case["id"]);
                let expected = if let Some(text) = case.get("expectedText") {
                    text.as_str().unwrap().to_string()
                } else {
                    base64::engine::general_purpose::STANDARD.encode("a".repeat(8192))
                };
                assert_eq!(result["data"]["text"], expected, "{}", case["id"]);
            }
        }
        let formatted = call(
            "devtools.text.json.format",
            json!({"text":"{\"z\":2,\"a\":1}"}),
        );
        let encoded = call("devtools.text.base64.encode", formatted["data"].clone());
        let decoded = call("devtools.text.base64.decode", encoded["data"].clone());
        let compact = call("devtools.text.json.minify", decoded["data"].clone());
        assert_eq!(compact["data"]["text"], r#"{"a":1,"z":2}"#);
    }
    #[test]
    fn actual_candidate_installs_with_scene_isolation_and_explicit_pi_permission() {
        use crate::plugin_registry::PluginRegistry;
        let project = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let source = project.join("tests/fixtures/devtools-text-dev57");
        let root = project
            .join(".cache/task-scratch")
            .join(format!("devtools-registry-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("owner.json"), serde_json::to_vec(&json!({
            "purpose":"isolated DevTools receiver registry acceptance", "pid":std::process::id(),
            "lifetime":"removed after this test; retain on failure for diagnosis"
        })).unwrap()).unwrap();
        let mut registry = PluginRegistry::open(root.clone()).unwrap();
        let plugin = registry.install_developer(&source).unwrap();
        assert_eq!(plugin, "com.zicode.devtools.text");
        assert!(registry
            .plugin_runtime_entry("programming", &plugin)
            .is_err());
        registry.set_enabled("programming", &plugin, true).unwrap();
        assert_eq!(
            registry
                .capabilities("programming")
                .iter()
                .filter(|c| c.plugin_id == plugin)
                .count(),
            5
        );
        assert!(registry
            .capability("programming", &plugin, "devtools.text.unknown")
            .is_none());
        assert!(registry.plugin_runtime_entry("writing", &plugin).is_err());
        assert!(registry
            .view_document("programming", &plugin, "devtools.text.main")
            .is_ok());
        assert!(registry
            .view_document("writing", &plugin, "devtools.text.main")
            .is_err());
        assert!(!registry
            .pi_tools("programming")
            .iter()
            .any(|t| t.plugin_id == plugin));
        registry
            .set_permission("programming", &plugin, "pi.tools.register", true)
            .unwrap();
        assert_eq!(
            registry
                .pi_tools("programming")
                .iter()
                .filter(|t| t.plugin_id == plugin)
                .count(),
            5
        );
        let (module, kind) = registry
            .plugin_runtime_entry("programming", &plugin)
            .unwrap();
        let result = execute(WorkerRequest {
            worker_path: module.to_string_lossy().into_owned(),
            worker_kind: kind.into(),
            plugin_id: plugin.clone(),
            capability_id: Some("devtools.text.base64.encode".into()),
            command_id: None,
            scene_id: "programming".into(),
            input: json!({"text":"hello"}),
        })
        .unwrap();
        assert_eq!(result["data"]["text"], "aGVsbG8=");
        registry
            .set_permission("programming", &plugin, "pi.tools.register", false)
            .unwrap();
        assert!(!registry
            .pi_tools("programming")
            .iter()
            .any(|t| t.plugin_id == plugin));
        assert!(registry
            .capability("programming", &plugin, "devtools.text.base64.encode")
            .is_some());
        registry.set_enabled("programming", &plugin, false).unwrap();
        assert!(registry
            .plugin_runtime_entry("programming", &plugin)
            .is_err());
        registry.uninstall_developer(&plugin).unwrap();
        assert!(!registry
            .list("programming")
            .iter()
            .any(|p| p.manifest.id == plugin));
        drop(registry);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn actual_candidate_cold_start_optimization_preserves_result() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/devtools-text-dev57/runtime/tools.wasm");
        let request = WorkerRequest {
            worker_path: path.to_string_lossy().into_owned(),
            worker_kind: "wasi".into(),
            plugin_id: "com.zicode.devtools.text".into(),
            capability_id: Some("devtools.text.sha256".into()),
            command_id: None,
            scene_id: "programming".into(),
            input: json!({"text":"hello"}),
        };
        let previous =
            super::execute_wasi_with_optimization(&request, wasmtime::OptLevel::Speed).unwrap();
        let cold =
            super::execute_wasi_with_optimization(&request, wasmtime::OptLevel::None).unwrap();
        assert_eq!(previous, cold);
        assert_eq!(
            cold["data"]["text"],
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }
}
