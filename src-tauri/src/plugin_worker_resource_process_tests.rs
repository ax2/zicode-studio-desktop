use super::resource_input::{encode, Descriptor, Resource};
use crate::plugin_capabilities::worker_process;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

fn command(executable: &Path) -> std::process::Command {
    let mut command = crate::process_command::new_command(executable);
    command
        .arg("--zicode-plugin-worker")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    command
}

fn digest(path: &Path) -> String {
    let mut file = std::fs::File::open(path).unwrap();
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).unwrap();
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    format!("{:x}", hash.finalize())
}

#[test]
#[ignore = "requires current Studio executable with resource input framing; actual process acceptance"]
fn actual_resource_worker_frame_cancellation_timeout_and_recovery() {
    let executable =
        std::path::PathBuf::from(std::env::var_os("ZICODE_TEST_RESOURCE_WORKER_EXE").unwrap());
    let executable_hash = digest(&executable);
    let scratch =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    let root = scratch.join(format!("resource-worker-process-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(
        root.join("owner.json"),
        br#"{"purpose":"actual Studio binary resource Worker; retain failed fixture"}"#,
    )
    .unwrap();
    let module = root.join("reader.wasm");
    std::fs::write(&module,r#"(module
        (import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32)))
        (import "zicode_resource_input_draft1" "size" (func $size (param i32) (result i64)))
        (import "zicode_resource_input_draft1" "read" (func $read (param i32 i64 i32 i32) (result i32)))
        (memory (export "memory") 1)
        (data (i32.const 64) "{\22text\22:\22XXXXXXXX\22}")
        (func (export "_start")
            i32.const 0 call $size i64.const 300000 i64.ne if unreachable end
            i32.const 0 i64.const 299992 i32.const 73 i32.const 8 call $read
            i32.const 8 i32.ne if unreachable end
            i32.const 0 i32.const 64 i32.store i32.const 4 i32.const 19 i32.store
            i32.const 1 i32.const 0 i32.const 1 i32.const 24 call $write drop))"#).unwrap();
    let mut bytes = vec![173; 300000];
    bytes[299992..].copy_from_slice(b"resource");
    let descriptor: Descriptor = serde_json::from_value(json!({
        "resourceId":uuid::Uuid::new_v4().to_string(),"byteLength":bytes.len(),
        "mimeType":"application/octet-stream","contentVersion":format!("{:x}",Sha256::digest(&bytes))
    })).unwrap();
    let resources = vec![Resource { descriptor, bytes }];
    let request = json!({"workerKind":"wasi","workerPath":module.to_string_lossy(),
        "pluginId":"com.zicode.studio.resource-reader","capabilityId":"resource.read","sceneId":"programming","input":{}});
    let frame = encode(request.clone(), &resources).unwrap();
    let run = |input: Vec<u8>| {
        worker_process::run_cancellable(
            command(&executable),
            input,
            Duration::from_secs(5),
            1024 * 1024,
            None,
        )
        .unwrap()
    };
    let verify_success = || {
        let (status, output) = run(frame.clone());
        assert!(status.success());
        let response: Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(response["ok"], true);
        assert_eq!(response["result"], json!({"text":"resource"}));
    };
    verify_success();
    let mut corrupt = frame.clone();
    *corrupt.last_mut().unwrap() ^= 1;
    let (status, output) = run(corrupt);
    assert!(!status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&output).unwrap()["error"],
        "Resource Worker content mismatch"
    );
    let (status, _) = run(serde_json::to_vec(&request).unwrap());
    assert!(!status.success());

    let cancelled = AtomicBool::new(false);
    let cancel_events = Mutex::new(Vec::new());
    let observer = |event: &'static str, pid| {
        cancel_events.lock().unwrap().push((event, pid));
        if event == "started" {
            cancelled.store(true, Ordering::Release);
        }
    };
    let error = worker_process::run_observed(
        command(&executable),
        frame.clone(),
        Duration::from_secs(5),
        1024 * 1024,
        Some(&cancelled),
        Some(&observer),
    )
    .unwrap_err();
    assert_eq!(error.code, "worker_cancelled");
    let events = cancel_events.into_inner().unwrap();
    let cancelled_pid = events[0].1;
    for event in ["started", "cancel_live", "reaped", "pipes_closed"] {
        assert!(events.contains(&(event, cancelled_pid)));
    }
    verify_success();

    let timeout_events = Mutex::new(Vec::new());
    let observer = |event: &'static str, pid| {
        timeout_events.lock().unwrap().push((event, pid));
    };
    let error = worker_process::run_observed(
        command(&executable),
        frame.clone(),
        Duration::from_nanos(1),
        1024 * 1024,
        None,
        Some(&observer),
    )
    .unwrap_err();
    assert_eq!(error.code, "worker_timeout");
    let events = timeout_events.into_inner().unwrap();
    let timeout_pid = events[0].1;
    for event in ["started", "reaped", "pipes_closed"] {
        assert!(events.contains(&(event, timeout_pid)));
    }
    verify_success();
    assert_eq!(digest(&executable), executable_hash);
    if let Some(path) = std::env::var_os("ZICODE_TEST_RESOURCE_PROCESS_EVIDENCE") {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .unwrap();
        serde_json::to_writer_pretty(&mut file,&json!({
            "passed":true,"executableSha256":executable_hash,"resourceBytes":300000,
            "actualWorkerStdinAndStdout":true,"corruptFrameRejected":true,"legacyImportsDenied":true,
            "cancelledPid":cancelled_pid,"cancelLiveReapedPipesClosed":true,"timeoutPid":timeout_pid,
            "timeoutReapedPipesClosed":true,"nextInvocationRecovered":true,
            "phaseBoundary":"Cancellation/expired deadline during Worker startup; not instruction-level interruption",
            "hostResourceAuthorizationInvoked":false,"devtoolsImageAlgorithmInvoked":false
        })).unwrap();
    }
    assert!(root
        .canonicalize()
        .unwrap()
        .starts_with(scratch.canonicalize().unwrap()));
    std::fs::remove_dir_all(root).unwrap();
}
