use boa_engine::{Context, Source};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::{self, Read};
use std::path::Path;

const MAX_REQUEST_BYTES: u64 = 256 * 1024;
const MAX_WORKER_BYTES: u64 = 1024 * 1024;

#[derive(Deserialize)]
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
    let mut input = String::new();
    let response = match io::stdin()
        .take(MAX_REQUEST_BYTES + 1)
        .read_to_string(&mut input)
    {
        Ok(read) if read as u64 <= MAX_REQUEST_BYTES => {
            serde_json::from_str::<WorkerRequest>(&input)
                .map_err(|error| format!("Invalid worker request: {error}"))
                .and_then(execute)
        }
        Ok(_) => Err("Worker request exceeds 256 KiB".into()),
        Err(error) => Err(format!("Cannot read worker request: {error}")),
    };
    let output = match response {
        Ok(result) => WorkerResponse {
            ok: true,
            result: Some(result),
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
    use wasmtime::{Config, Engine, Linker, Module, Store, StoreLimits, StoreLimitsBuilder};
    use wasmtime_wasi::p2::pipe::{MemoryInputPipe, MemoryOutputPipe};
    use wasmtime_wasi::preview1::{self, WasiP1Ctx};
    use wasmtime_wasi::WasiCtxBuilder;

    let worker_path = Path::new(&request.worker_path);
    let metadata = fs::metadata(worker_path)
        .map_err(|error| format!("Cannot inspect WASI module: {error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_WORKER_BYTES * 2 {
        return Err("WASI module must be no larger than 2 MiB".into());
    }
    let input = serde_json::to_vec(&serde_json::json!({
        "pluginId": request.plugin_id,
        "sceneId": request.scene_id,
        "capabilityId": request.capability_id,
        "commandId": request.command_id,
        "input": request.input,
    }))
    .map_err(|error| format!("Cannot encode WASI input: {error}"))?;
    let stdin = MemoryInputPipe::new(input);
    let stdout = MemoryOutputPipe::new(1024 * 1024);
    let stderr = MemoryOutputPipe::new(64 * 1024);
    let mut config = Config::new();
    config.consume_fuel(true);
    config.max_wasm_stack(2 * 1024 * 1024);
    let engine =
        Engine::new(&config).map_err(|error| format!("Cannot start WASI engine: {error}"))?;
    let module = Module::from_file(&engine, worker_path)
        .map_err(|error| format!("Cannot compile WASI module: {error}"))?;
    struct WasiState {
        context: WasiP1Ctx,
        limits: StoreLimits,
    }
    let mut linker: Linker<WasiState> = Linker::new(&engine);
    preview1::add_to_linker_sync(&mut linker, |state| &mut state.context)
        .map_err(|error| format!("Cannot link WASI module: {error}"))?;
    let wasi = WasiCtxBuilder::new()
        .stdin(stdin)
        .stdout(stdout.clone())
        .stderr(stderr.clone())
        .args(&["zicode-plugin"])
        .build_p1();
    let limits = StoreLimitsBuilder::new()
        .memory_size(64 * 1024 * 1024)
        .instances(1)
        .memories(2)
        .tables(4)
        .build();
    let mut store = Store::new(
        &engine,
        WasiState {
            context: wasi,
            limits,
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
    start.call(&mut store, ()).map_err(|error| {
        let detail = String::from_utf8_lossy(&stderr.contents())
            .trim()
            .to_string();
        if detail.is_empty() {
            format!("WASI execution failed: {error}")
        } else {
            format!(
                "WASI execution failed: {}",
                detail.chars().take(240).collect::<String>()
            )
        }
    })?;
    let bytes = stdout.contents();
    if bytes.is_empty() {
        return Err("WASI module returned an empty response".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "WASI module stdout must be one JSON value".into())
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
}
