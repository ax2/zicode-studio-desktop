use super::*;
#[path = "plugin_detached_worker_tests/cache_tests.rs"]
mod cache_tests;

fn fixture() -> (
    PathBuf,
    PluginRegistry,
    CapabilityBroker,
    CapabilityInvocation,
) {
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let root = project
        .join(".cache/task-scratch")
        .join(format!("detached-worker-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    fs::write(
        root.join("owner.json"),
        r#"{"purpose":"detached Worker reservation/revocation tests; retain compact evidence"}"#,
    )
    .unwrap();
    let mut registry = PluginRegistry::open(root.join("plugins")).unwrap();
    registry
        .install_developer(&project.join("tests/fixtures/devtools-text-dev57"))
        .unwrap();
    registry
        .set_enabled("programming", "com.zicode.devtools.text", true)
        .unwrap();
    registry
        .set_permission(
            "programming",
            "com.zicode.devtools.text",
            "pi.tools.register",
            true,
        )
        .unwrap();
    let broker = CapabilityBroker::new(root.join("plugins")).unwrap();
    let request = CapabilityInvocation {
        caller: "pi".into(),
        scene_id: "programming".into(),
        workspace_id: "fixture".into(),
        plugin_id: "com.zicode.devtools.text".into(),
        capability_id: "devtools.text.base64.encode".into(),
        tool_call_id: Some("same-call".into()),
        idempotency_scope: Some("same-runtime".into()),
        input: json!({"text":"hello"}),
    };
    (root, registry, broker, request)
}

fn prepare(
    broker: &mut CapabilityBroker,
    registry: &PluginRegistry,
    request: &CapabilityInvocation,
) -> Box<Invocation> {
    match broker.prepare_worker_invocation(registry, request.clone(), &AtomicBool::new(false)) {
        Dispatch::Worker(job) => job,
        Dispatch::Complete(result) => panic!("Expected prepared Worker: {result:?}"),
    }
}

#[test]
fn reservations_replay_conflict_drop_and_audit_preserve_single_broker_state() {
    let (root, registry, mut broker, request) = fixture();
    let flag = AtomicBool::new(false);
    let job = prepare(&mut broker, &registry, &request);
    assert_eq!(
        broker.invoke(&registry, request.clone()).unwrap_err().code,
        "plugin_call_in_progress"
    );
    drop(job);
    let job = prepare(&mut broker, &registry, &request);
    // This test injects only the execution result; real transport is tested separately.
    let value = json!({"ok":true,"data":{"text":"aGVsbG8="}});
    assert_eq!(
        broker
            .finish_worker_invocation(&registry, *job, Ok(value.clone()), &flag)
            .unwrap(),
        value
    );
    match broker.prepare_worker_invocation(&registry, request.clone(), &flag) {
        Dispatch::Complete(Ok(cached)) => assert_eq!(cached, value),
        _ => panic!("Replay must not create another Worker"),
    }
    let mut changed = request;
    changed.input = json!({"text":"other"});
    match broker.prepare_worker_invocation(&registry, changed, &flag) {
        Dispatch::Complete(Err(error)) => assert_eq!(error.code, "idempotency_conflict"),
        _ => panic!("Conflicting replay must be rejected"),
    }
    let audit = fs::read_to_string(root.join("plugins/audit/capabilities.jsonl")).unwrap();
    assert!(!audit.contains("hello"));
    assert!(audit.contains("plugin_call_in_progress"));
    assert_eq!(broker.idempotency.len(), 1);
}

#[test]
fn revoke_regrant_cancel_and_module_change_never_publish_or_cache_old_results() {
    let (_root, mut registry, mut broker, request) = fixture();
    let flag = AtomicBool::new(false);
    let result = || Ok(json!({"ok":true,"data":{"text":"aGVsbG8="}}));
    let job = prepare(&mut broker, &registry, &request);
    registry
        .set_permission(
            "programming",
            &request.plugin_id,
            "pi.tools.register",
            false,
        )
        .unwrap();
    registry
        .set_permission("programming", &request.plugin_id, "pi.tools.register", true)
        .unwrap();
    assert_eq!(
        broker
            .finish_worker_invocation(&registry, *job, result(), &flag)
            .unwrap_err()
            .code,
        "capability_changed"
    );
    let job = prepare(&mut broker, &registry, &request);
    flag.store(true, Ordering::Release);
    assert_eq!(
        broker
            .finish_worker_invocation(&registry, *job, result(), &flag)
            .unwrap_err()
            .code,
        "worker_cancelled"
    );
    flag.store(false, Ordering::Release);
    let job = prepare(&mut broker, &registry, &request);
    let (module, _) = registry
        .plugin_runtime_entry("programming", &request.plugin_id)
        .unwrap();
    let original = fs::read(&module).unwrap();
    let mut changed = original.clone();
    changed.push(0);
    fs::write(&module, changed).unwrap();
    assert_eq!(
        broker
            .finish_worker_invocation(&registry, *job, result(), &flag)
            .unwrap_err()
            .code,
        "capability_changed"
    );
    fs::write(module, original).unwrap();
    assert!(broker.idempotency.is_empty());
    assert!(broker.worker_reservations.is_empty());
}

#[test]
fn unrelated_mutations_preserve_worker_but_identical_reinstall_invalidates_it() {
    let (_root, mut registry, mut broker, request) = fixture();
    let flag = AtomicBool::new(false);
    let result = || Ok(json!({"ok":true,"data":{"text":"aGVsbG8="}}));
    let job = prepare(&mut broker, &registry, &request);
    let global = registry.result_epoch();
    registry.set_enabled("other-scene", &request.plugin_id, true).unwrap();
    registry.set_permission("programming", "com.zicode.artifacts", "storage.plugin", false).unwrap();
    registry.reload_developer_plugins().unwrap();
    assert_ne!(global, registry.result_epoch());
    broker.finish_worker_invocation(&registry, *job, result(), &flag).unwrap();
    let mut fresh = request.clone();
    fresh.tool_call_id = Some("fresh-reinstall-check".into());
    let job = prepare(&mut broker, &registry, &fresh);
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    registry.install_developer(&project.join("tests/fixtures/devtools-text-dev57")).unwrap();
    assert_eq!(broker.finish_worker_invocation(&registry, *job, result(), &flag).unwrap_err().code, "capability_changed");
    assert!(broker.worker_reservations.is_empty());
}
