use super::*;
#[test]
#[ignore = "requires the retained real Studio Worker executable"]
fn real_worker_invalid_output_cache_recheck_and_recovery() {
    use super::super::{CapabilityBroker, CapabilityInvocation};
    use crate::plugin_registry::PluginRegistry;
    use std::{
        fs,
        path::PathBuf,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        },
    };
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .join(format!("output-contract-{}", uuid::Uuid::new_v4()));
    let package = root.join("package");
    fs::create_dir_all(package.join("runtime")).unwrap();
    fs::write(
        root.join("owner.json"),
        json!({"purpose":"bounded actual Worker output-contract evidence",
            "pid":std::process::id(),"lifetime":"retain tiny fixture and hash-only audit"})
        .to_string(),
    )
    .unwrap();
    let output = json!({"value":"synthetic-private-output"});
    let bytes = output.to_string().into_bytes();
    let literal: String = bytes.iter().map(|b| format!("\\{b:02x}")).collect();
    let wasm = format!(
        r#"(module
            (import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32)))
            (memory (export "memory") 1) (data (i32.const 8) "{literal}")
            (func (export "_start") (i32.store (i32.const 0) (i32.const 8))
            (i32.store (i32.const 4) (i32.const {}))
            (drop (call $write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 64)))))"#,
        bytes.len()
    );
    fs::write(package.join("runtime/output.wasm"), wasm).unwrap();
    let good = json!({"type":"object","required":["value"],"additionalProperties":false,"properties":{"value":{"type":"string"}}});
    let mut manifest = json!({"schemaVersion":2,"id":"com.example.output-contract","name":"Output contract",
            "description":"fixture","version":"0.1.0","publisher":"example",
            "engines":{"zicode":">=0.1.0 <1.0.0","pluginApi":"^1.0.0"},
            "requiredProfiles":{"output.schema.v1":"=1.0.0-rc.1"},"runtime":{"wasi":"runtime/output.wasm"},
            "contributes":{"capabilities":[{"id":"main","inputSchema":{"type":"object"},
            "outputSchema":{"type":"object","properties":{"value":{"type":"integer"}}}},
            {"id":"other","inputSchema":{"type":"object"},"outputSchema":good}]}});
    let mut registry = PluginRegistry::open(root.join("registry")).unwrap();
    let install = |registry: &mut PluginRegistry, manifest: &Value| {
        fs::write(package.join("plugin.json"), manifest.to_string()).unwrap();
        registry.install_developer(&package).unwrap();
        registry
            .set_enabled("programming", "com.example.output-contract", true)
            .unwrap();
    };
    install(&mut registry, &manifest);
    let starts = Arc::new(AtomicUsize::new(0));
    let observed = starts.clone();
    let events = Arc::new(Mutex::new(Vec::new()));
    let observed_events = events.clone();
    let mut broker = CapabilityBroker::new(root.join("registry")).unwrap();
    broker.worker_executable = Some(PathBuf::from(
        std::env::var("ZICODE_TEST_WORKER_EXE").unwrap(),
    ));
    broker.worker_observer = Some(Arc::new(move |event, pid| {
        observed_events.lock().unwrap().push((event, pid));
        if event == "started" {
            observed.fetch_add(1, Ordering::SeqCst);
        }
    }));
    let invocation = |id: &str| CapabilityInvocation {
        caller: "view".into(),
        scene_id: "programming".into(),
        workspace_id: "fixture".into(),
        plugin_id: "com.example.output-contract".into(),
        capability_id: id.into(),
        tool_call_id: Some(id.into()),
        idempotency_scope: Some("output-fixture".into()),
        input: json!({}),
    };
    assert_eq!(
        broker
            .invoke(&registry, invocation("main"))
            .unwrap_err()
            .code,
        "worker_protocol_error"
    );
    assert!(broker.idempotency.is_empty());
    assert_eq!(
        broker.invoke(&registry, invocation("other")).unwrap(),
        output
    );
    manifest["contributes"]["capabilities"][0]["outputSchema"] = good.clone();
    install(&mut registry, &manifest);
    assert_eq!(
        broker.invoke(&registry, invocation("main")).unwrap(),
        output
    );
    let prior = starts.load(Ordering::SeqCst);
    assert_eq!(broker.invoke(&registry, invocation("main")).unwrap(), output);
    assert_eq!(starts.load(Ordering::SeqCst), prior);
    let main_call = |call_id: &str| {
        let mut call = invocation("main");
        call.tool_call_id = Some(call_id.into());
        call
    };
    manifest["contributes"]["capabilities"][0]["outputSchema"] = json!({"const":{"value":"different"}});
    install(&mut registry, &manifest);
    // Reinstallation changes authority. Reject the old call before replay or
    // dispatch, then use an explicitly new call to test the current schema.
    assert_eq!(broker.invoke(&registry, invocation("main")).unwrap_err().code, "idempotency_authority_changed");
    assert_eq!(starts.load(Ordering::SeqCst), prior);
    assert_eq!(broker.invoke(&registry, main_call("changed-schema")).unwrap_err().code, "worker_protocol_error");
    assert_eq!(starts.load(Ordering::SeqCst), prior + 1);
    manifest["contributes"]["capabilities"][0]["outputSchema"] = good;
    install(&mut registry, &manifest);
    assert_eq!(broker.invoke(&registry, invocation("main")).unwrap_err().code, "idempotency_authority_changed");
    assert_eq!(starts.load(Ordering::SeqCst), prior + 1);
    assert_eq!(broker.invoke(&registry, main_call("recovered-schema")).unwrap(), output);
    assert_eq!(starts.load(Ordering::SeqCst), prior + 2);
    manifest["contributes"]["capabilities"][0]["maxResultBytes"] = json!(1);
    install(&mut registry, &manifest);
    assert_eq!(broker.invoke(&registry, main_call("recovered-schema")).unwrap_err().code, "idempotency_authority_changed");
    assert_eq!(starts.load(Ordering::SeqCst), prior + 2);
    for attempt in 1..=2 {
        assert_eq!(broker.invoke(&registry, main_call("bounded-result")).unwrap_err().code, "result_too_large");
        assert_eq!(starts.load(Ordering::SeqCst), prior + 2 + attempt);
    }
    manifest["contributes"]["capabilities"][0].as_object_mut().unwrap().remove("maxResultBytes");
    install(&mut registry, &manifest);
    assert_eq!(broker.invoke(&registry, main_call("recovered-schema")).unwrap_err().code, "idempotency_authority_changed");
    assert_eq!(starts.load(Ordering::SeqCst), prior + 4);
    assert_eq!(broker.invoke(&registry, main_call("restored-limit")).unwrap(), output);
    let audit = fs::read_to_string(root.join("registry/audit/capabilities.jsonl")).unwrap();
    assert!(!audit.contains("synthetic-private-output"));
    assert_eq!(starts.load(Ordering::SeqCst), 8);
    let events = events.lock().unwrap();
    let started: Vec<_> = events
        .iter()
        .filter(|(event, _)| *event == "started")
        .map(|(_, pid)| *pid)
        .collect();
    let closed: Vec<_> = events
        .iter()
        .filter(|(event, _)| *event == "pipes_closed")
        .map(|(_, pid)| *pid)
        .collect();
    assert_eq!(started, closed);
    fs::write(
        root.join("worker-events.json"),
        serde_json::to_vec_pretty(&*events).unwrap(),
    )
    .unwrap();
    println!("output-contract fixture={} real Worker starts=8; authority rejection, fresh output validation and recovery passed", root.display());
}
fn capability(schema: Value) -> PluginCapabilityDescriptor {
    PluginCapabilityDescriptor {
        plugin_id: "com.example.output".into(),
        id: "main".into(),
        title: "Output".into(),
        input_schema: json!({}),
        resource_input_max: None,
        output_schema: Some(schema),
        max_result_bytes: None,
    }
}
#[test]
fn provider_envelope_shape_is_checked_without_claiming_diagnostic_profile_support() {
    let schema: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/devtools-diagnostics-candidate01/schemas/result.schema.json"
    ))
    .unwrap();
    validate_declaration(&schema).unwrap();
    let cap = capability(schema);
    for result in [
        json!({"contractVersion":"1.0.0-rc.1","ok":true,"data":{"text":"{}"},"error":null}),
        json!({"contractVersion":"1.0.0-rc.1","ok":false,"data":null,"error":{"code":"INVALID_INPUT","message":"Invalid input"}}),
    ] {
        validate_result(&cap, &result).unwrap();
    }
    let private = "synthetic-private-output";
    for result in [
        json!({"contractVersion":"wrong","ok":true,"data":{"text":private},"error":null}),
        json!({"contractVersion":"1.0.0-rc.1","ok":false,"data":null,"error":{"code":private,"message":private}}),
    ] {
        let error = validate_result(&cap, &result).unwrap_err();
        assert_eq!(error.code, "worker_protocol_error");
        assert!(!error.message.contains(private));
    }
}
#[test]
fn strict_declarations_and_explicit_profile_are_required() {
    let mut deep = json!({});
    for _ in 0..17 {
        deep = json!({"items":deep});
    }
    assert!(validate_declaration(&deep).is_err());
    assert!(validate_declaration(&json!({"enum":vec![json!(null);512]})).is_err());
    for schema in [
        json!({"$ref":"#"}),
        json!({"type":"unknown"}),
        json!({"oneOf":[]}),
        json!({"minLength":-1}),
        json!({"minimum":"1"}),
        json!({"minimum":2,"maximum":1}),
        json!({"additionalProperties":{}}),
        json!({"properties":[]}),
        json!({"required":[1]}),
        json!({"oneOf":vec![json!({});9]}),
        json!({"enum":[]}),
        json!({"description":"x".repeat(32768)}),
    ] {
        assert!(validate_declaration(&schema).is_err());
    }
    let item = json!({"outputSchema":{"type":"object"},"maxResultBytes":48*1024});
    assert!(validate_contribution(1, &json!({}), &item).is_err());
    assert!(validate_contribution(2, &json!({}), &item).is_err());
    validate_contribution(2, &json!({"output.schema.v1":"=1.0.0-rc.1"}), &item).unwrap();
    for limit in [json!(0), json!(-1), json!(1048577), json!(1.5)] {
        assert!(validate_contribution(
            2,
            &json!({"output.schema.v1":"=1.0.0-rc.1"}),
            &json!({"maxResultBytes":limit})
        )
        .is_err());
    }
}
#[test]
fn nested_constraints_one_of_and_shared_work_budget() {
    let cap = capability(
        json!({"type":"array","minItems":1,"maxItems":2,"items":{"oneOf":[
            {"type":"integer","minimum":1,"maximum":3},{"type":["string","null"],"enum":["ok",null]}]}}),
    );
    validate_declaration(cap.output_schema.as_ref().unwrap()).unwrap();
    validate_result(&cap, &json!([1.0, null])).unwrap();
    for value in [json!([]), json!([4]), json!(["bad"]), json!([1, 2, 3])] {
        assert!(validate_result(&cap, &value).is_err());
    }
    assert!(validate_result(&capability(json!({"oneOf":[{},{}]})), &json!(1)).is_err());
    let mut budget = 1;
    assert!(matches_value(&json!({"items":{}}), &json!([1, 2]), &mut budget).is_err());
    let mut bounded = capability(json!({}));
    bounded.max_result_bytes = Some(1);
    assert_eq!(
        validate_result(&bounded, &json!("x")).unwrap_err().code,
        "result_too_large"
    );
}
