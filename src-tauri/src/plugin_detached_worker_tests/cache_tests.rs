use super::*;
use std::sync::Mutex;

fn replay(
    broker: &mut CapabilityBroker,
    registry: &PluginRegistry,
    request: &CapabilityInvocation,
) -> Result<Value, CapabilityError> {
    match broker.prepare_worker_invocation(registry, request.clone(), &AtomicBool::new(false)) {
        Dispatch::Complete(result) => result,
        Dispatch::Worker(_) => panic!("Cache replay must never spawn another Worker"),
    }
}

fn publish(
    broker: &mut CapabilityBroker,
    registry: &PluginRegistry,
    request: &CapabilityInvocation,
) {
    let job = prepare(broker, registry, request);
    broker
        .finish_worker_invocation(
            registry,
            *job,
            Ok(json!({"ok":true,"data":{"text":"aGVsbG8="}})),
            &AtomicBool::new(false),
        )
        .unwrap();
}

#[test]
fn stale_cache_rejects_regrant_reinstall_and_module_changes_without_evicting_or_retrying() {
    let (root, mut registry, mut broker, request) = fixture();
    publish(&mut broker, &registry, &request);
    let first = replay(&mut broker, &registry, &request).unwrap();
    registry
        .set_permission(
            "programming",
            "com.zicode.artifacts",
            "storage.plugin",
            false,
        )
        .unwrap();
    registry
        .set_enabled("other-scene", &request.plugin_id, true)
        .unwrap();
    registry.reload_developer_plugins().unwrap();
    assert_eq!(replay(&mut broker, &registry, &request).unwrap(), first);
    registry
        .set_permission(
            "programming",
            &request.plugin_id,
            "pi.tools.register",
            false,
        )
        .unwrap();
    assert_eq!(
        replay(&mut broker, &registry, &request).unwrap_err().code,
        "capability_unavailable"
    );
    registry
        .set_permission("programming", &request.plugin_id, "pi.tools.register", true)
        .unwrap();
    for _ in 0..2 {
        assert_eq!(
            replay(&mut broker, &registry, &request).unwrap_err().code,
            "idempotency_authority_changed"
        );
        assert_eq!(broker.idempotency.len(), 1);
        assert!(broker.worker_reservations.is_empty());
    }
    let mut fresh = request.clone();
    fresh.tool_call_id = Some("reviewed-new-call".into());
    publish(&mut broker, &registry, &fresh);
    let (module, _) = registry
        .plugin_runtime_entry("programming", &request.plugin_id)
        .unwrap();
    let original = fs::read(&module).unwrap();
    let mut changed = original.clone();
    changed[0] ^= 1;
    fs::write(&module, changed).unwrap();
    assert_eq!(
        replay(&mut broker, &registry, &fresh).unwrap_err().code,
        "idempotency_authority_changed"
    );
    fs::write(&module, original).unwrap();
    // Restored unmanaged bytes have the original fingerprint; this is not atomic filesystem proof.
    assert_eq!(replay(&mut broker, &registry, &fresh).unwrap(), first);
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    registry
        .install_developer(&project.join("tests/fixtures/devtools-text-dev57"))
        .unwrap();
    assert_eq!(
        replay(&mut broker, &registry, &fresh).unwrap_err().code,
        "idempotency_authority_changed"
    );
    assert_eq!(broker.idempotency.len(), 2);
    drop(broker);
    drop(registry);
    cleanup(root);
}

fn cleanup(root: PathBuf) {
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .canonicalize()
        .unwrap();
    assert!(root.canonicalize().unwrap().starts_with(scratch));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn cached_builtin_write_is_not_repeated_after_authority_changes() {
    let (root, mut registry, mut broker, mut request) = fixture();
    let workspace = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let vault = crate::notes_vault::NotesVault::new(root.join("plugins")).unwrap();
    let scoped = vault.scoped(workspace).unwrap();
    let notebook = scoped
        .create_notebook("Cache write test", None, None)
        .unwrap();
    drop(scoped);
    request.workspace_id = workspace.into();
    request.plugin_id = "com.zicode.notes".into();
    request.capability_id = "notes.create".into();
    request.input = json!({"notebookId":notebook.id,"title":"Unique cache write","content":"Only one write","tags":[]});
    let created = broker.invoke(&registry, request.clone()).unwrap();
    assert_eq!(broker.invoke(&registry, request.clone()).unwrap(), created);
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
    for _ in 0..3 {
        assert_eq!(
            broker.invoke(&registry, request.clone()).unwrap_err().code,
            "idempotency_authority_changed"
        );
    }
    request.capability_id = "notes.search".into();
    request.tool_call_id = None;
    request.idempotency_scope = None;
    request.input = json!({"query":"Unique cache write"});
    assert_eq!(
        broker.invoke(&registry, request).unwrap()["matches"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(broker.idempotency.len(), 1);
    drop(broker);
    drop(registry);
    drop(vault);
    cleanup(root);
}

#[test]
#[ignore = "requires ZICODE_TEST_WORKER_EXE; actual frozen WASI execution and cache replay"]
fn actual_worker_cache_replay_binds_authority_without_respawn() {
    let (root, mut registry, mut broker, request) = fixture();
    broker.worker_executable = Some(PathBuf::from(
        std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap(),
    ));
    let events = Arc::new(Mutex::new(Vec::new()));
    let observed = events.clone();
    broker.worker_observer = Some(Arc::new(move |name, pid| {
        observed.lock().unwrap().push((name, pid))
    }));
    let mut job = prepare(&mut broker, &registry, &request);
    let flag = AtomicBool::new(false);
    let result = job.execute(&flag).unwrap();
    assert_eq!(result["data"]["text"], "aGVsbG8=");
    broker
        .finish_worker_invocation(&registry, *job, Ok(result.clone()), &flag)
        .unwrap();
    assert_eq!(replay(&mut broker, &registry, &request).unwrap(), result);
    registry
        .set_enabled("other-scene", &request.plugin_id, true)
        .unwrap();
    assert_eq!(replay(&mut broker, &registry, &request).unwrap(), result);
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
    for _ in 0..3 {
        assert_eq!(
            replay(&mut broker, &registry, &request).unwrap_err().code,
            "idempotency_authority_changed"
        );
    }
    let rows = events.lock().unwrap().clone();
    let starts: Vec<_> = rows.iter().filter(|row| row.0 == "started").collect();
    assert_eq!(starts.len(), 1);
    for name in ["reaped", "pipes_closed"] {
        assert!(rows.contains(&(name, starts[0].1)));
    }
    assert_eq!(broker.idempotency.len(), 1);
    assert!(broker.worker_reservations.is_empty());
    if let Some(path) = std::env::var_os("ZICODE_TEST_CACHE_EVIDENCE") {
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .unwrap();
        serde_json::to_writer_pretty(file, &json!({"passed":true,"initialAndUnrelatedReplay":true,"regrantOldCacheRejected":true,"rejectedReplays":3,"workerStarts":1,"reapedPipesClosed":true,"cacheRetained":true,"workerEvents":rows,"devtoolsFullScope":false,"nativeUi":false})).unwrap();
    }
    drop(broker);
    drop(registry);
    cleanup(root);
}
