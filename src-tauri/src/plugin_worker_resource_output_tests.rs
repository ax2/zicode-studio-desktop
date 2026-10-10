use super::*;
use serde_json::json;

#[test]
fn binary_frame_roundtrips_large_raw_bytes_and_rejects_corruption_or_trailing_data() {
    let bundle = Bundle {
        binary: true,
        result: json!({"text":"ready"}),
        resources: vec![
            Blob {
                mime_type: "application/octet-stream".into(),
                bytes: vec![173; 2 * 1024 * 1024],
            },
            Blob {
                mime_type: "text/plain".into(),
                bytes: Vec::new(),
            },
        ],
    };
    let mut frame = Vec::new();
    write(&mut frame, &bundle).unwrap();
    assert!(frame.len() < 2 * 1024 * 1024 + 4096);
    let decoded = decode(&frame).unwrap();
    assert_eq!(decoded.result, bundle.result);
    assert_eq!(decoded.resources[0].bytes, bundle.resources[0].bytes);
    assert!(decoded.resources[1].bytes.is_empty());
    let mut changed = frame.clone();
    *changed.last_mut().unwrap() ^= 1;
    assert!(decode(&changed).is_err());
    frame.push(0);
    assert!(decode(&frame).is_err());
    frame.pop();
    frame.pop();
    assert!(decode(&frame).is_err());
}

#[test]
fn output_header_enforces_metadata_lengths_versions_and_escaping_before_writing() {
    let valid = json!({"schemaVersion":1,"profile":PROFILE,"result":{},"resources":[]});
    let encode = |value: Value| {
        let bytes = serde_json::to_vec(&value).unwrap();
        let mut frame = MAGIC.to_vec();
        frame.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        frame.extend(bytes);
        frame
    };
    assert!(decode(&encode(valid.clone())).is_ok());
    for value in [
        json!({"schemaVersion":2,"profile":PROFILE,"result":{},"resources":[]}),
        json!({"schemaVersion":1,"profile":"unknown","result":{},"resources":[]}),
        json!({"schemaVersion":1,"profile":PROFILE,"result":{},"resources":[],"path":"forbidden"}),
    ] {
        assert!(decode(&encode(value)).is_err());
    }
    for (index, mime, length, version) in [
        (1, "text/plain", 0, "0".repeat(64)),
        (0, "text/html", 0, "0".repeat(64)),
        (0, "text/plain", MAX_BYTES + 1, "0".repeat(64)),
        (0, "text/plain", 0, "A".repeat(64)),
    ] {
        let mut value = valid.clone();
        value["resources"] =
            json!([{"index":index,"mimeType":mime,"byteLength":length,"contentVersion":version}]);
        assert!(decode(&encode(value)).is_err());
    }
    let mut frame = MAGIC.to_vec();
    frame.extend_from_slice(&((MAX_HEADER + 1) as u32).to_le_bytes());
    assert!(decode(&frame).is_err());
    let bundle = Bundle {
        binary: true,
        result: json!("\0".repeat(MAX_HEADER / 5)),
        resources: Vec::new(),
    };
    let mut sink = Vec::new();
    assert!(write(&mut sink, &bundle).is_err());
    assert!(sink.is_empty());
}

#[test]
#[ignore = "requires current ZICODE_TEST_RESOURCE_WORKER_EXE; real binary output process"]
fn actual_binary_output_worker_returns_raw_bytes_and_discards_unsealed_or_trapped_results() {
    use crate::plugin_capabilities::worker_process;
    use crate::plugin_worker::resource_input::{Descriptor, Resource};
    use std::path::PathBuf;
    use std::process::Stdio;
    use std::sync::atomic::AtomicBool;
    use std::time::Duration;
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_RESOURCE_WORKER_EXE").unwrap());
    let module = r#"(module
      (import "zicode_resource_output_draft1" "create" (func $create (param i32 i64) (result i32)))
      (import "zicode_resource_output_draft1" "write" (func $write (param i32 i32 i32) (result i32)))
      (import "zicode_resource_output_draft1" "finish" (func $finish (param i32) (result i32)))
      (import "wasi_snapshot_preview1" "fd_write" (func $json (param i32 i32 i32 i32) (result i32)))
      (memory (export "memory") 2)
      (data (i32.const 0) "resource-output")
      (data (i32.const 65536) "{\22text\22:\22binary-ready\22}")
      (func (export "_start") (local $n i32)
        i32.const 0 i64.const 2097152 call $create i32.const 0 i32.ne if unreachable end
        (loop $loop
          i32.const 0 i32.const 0 i32.const 65536 call $write i32.const 65536 i32.ne if unreachable end
          local.get $n i32.const 1 i32.add local.tee $n i32.const 32 i32.lt_u br_if $loop)
        i32.const 0 call $finish i32.const 0 i32.ne if unreachable end
        i32.const 65600 i32.const 65536 i32.store i32.const 65604 i32.const 23 i32.store
        i32.const 1 i32.const 65600 i32.const 1 i32.const 65620 call $json drop))"#;
    let request = json!({"workerPath":"unused-module-snapshot","workerKind":"wasi","pluginId":"com.zicode.output-fixture","sceneId":"programming","capabilityId":"output.fixture","input":{},"resourceOutputProfile":PROFILE});
    let resource = Resource {
        descriptor: Descriptor {
            resource_id: uuid::Uuid::new_v4().to_string(),
            content_version: format!("{:x}", Sha256::digest([1])),
            mime_type: "application/octet-stream".into(),
            byte_length: 1,
        },
        bytes: vec![1],
    };
    let frame = |request: Value, module: &str| {
        super::super::resource_input::encode_module_snapshot(
            request,
            std::slice::from_ref(&resource),
            module.as_bytes(),
        )
        .unwrap()
    };
    let command = || {
        let mut c = crate::process_command::new_command(&executable);
        c.arg("--zicode-plugin-worker")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        c
    };
    let events = std::sync::Mutex::new(Vec::new());
    let observer = |event, pid| events.lock().unwrap().push((event, pid));
    let run = |bytes| {
        worker_process::run_observed(
            command(),
            bytes,
            Duration::from_secs(5),
            MAX_FRAME,
            Some(&AtomicBool::new(false)),
            Some(&observer),
        )
        .unwrap()
    };
    let (status, bytes) = run(frame(request.clone(), module));
    assert!(status.success());
    let decoded = decode(&bytes).unwrap();
    assert_eq!(decoded.result, json!({"text":"binary-ready"}));
    assert_eq!(decoded.resources.len(), 1);
    assert_eq!(decoded.resources[0].bytes.len(), 2 * 1024 * 1024);
    for chunk in decoded.resources[0].bytes.chunks(65536) {
        assert_eq!(&chunk[..15], b"resource-output");
        assert!(chunk[15..].iter().all(|b| *b == 0));
    }
    assert!(bytes.len() < 2 * 1024 * 1024 + 4096);
    let unsealed = module.replace(
        "i32.const 0 call $finish i32.const 0 i32.ne if unreachable end",
        "nop",
    );
    let trapped = module.replace(
        "i32.const 65600 i32.const 65536 i32.store",
        "unreachable i32.const 65600 i32.const 65536 i32.store",
    );
    let mut legacy = request.clone();
    legacy
        .as_object_mut()
        .unwrap()
        .remove("resourceOutputProfile");
    for data in [
        frame(request.clone(), &unsealed),
        frame(request.clone(), &trapped),
        frame(legacy, module),
        serde_json::to_vec(&request).unwrap(),
    ] {
        let (status, bytes) = run(data);
        assert!(!status.success());
        assert!(decode(&bytes).is_err());
        let error: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(error["ok"], false);
        assert!(error["result"].is_null());
    }
    let cancelled = AtomicBool::new(false);
    let cancel_observer = |event, pid| {
        observer(event, pid);
        if event == "started" {
            cancelled.store(true, std::sync::atomic::Ordering::Release);
        }
    };
    let error = worker_process::run_observed(
        command(),
        frame(request.clone(), module),
        Duration::from_secs(5),
        MAX_FRAME,
        Some(&cancelled),
        Some(&cancel_observer),
    )
    .unwrap_err();
    assert_eq!(error.code, "worker_cancelled");
    let error = worker_process::run_observed(
        command(),
        frame(request.clone(), module),
        Duration::from_nanos(1),
        MAX_FRAME,
        None,
        Some(&observer),
    )
    .unwrap_err();
    assert_eq!(error.code, "worker_timeout");
    let (status, bytes) = run(frame(request, module));
    assert!(status.success());
    assert!(decode(&bytes).is_ok());
    let rows = events.lock().unwrap();
    let starts: Vec<_> = rows.iter().filter(|r| r.0 == "started").collect();
    assert_eq!(starts.len(), 8);
    for row in starts {
        for event in ["reaped", "pipes_closed"] {
            assert!(rows.contains(&(event, row.1)));
        }
    }
    if let Some(path) = std::env::var_os("ZICODE_TEST_BINARY_OUTPUT_EVIDENCE") {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .unwrap();
        serde_json::to_writer_pretty(file,&json!({"passed":true,"outputBytes":2097152,"rawBinary":true,"failureResultsDiscarded":true,"legacyImportsDenied":true,"normalJsonOptInDenied":true,"recovered":true,"startupCancellationVerified":true,"expiredDeadlineVerified":true,"workerStarts":8,"allReapedPipesClosed":true,"workerEvents":*rows,"hostRegistration":false,"devtoolsAlgorithm":false,"nativeUi":false})).unwrap();
    }
}
