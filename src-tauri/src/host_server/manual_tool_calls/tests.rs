use super::*;

fn request() -> CapabilityInvokeRequest {
    CapabilityInvokeRequest {
        scene_id: "programming".into(),
        workspace_id: "workspace-a".into(),
        plugin_id: "com.zicode.fixture".into(),
        capability_id: "fixture.wait".into(),
        input: json!({"text":"private input"}),
        capture_result: false,
        catalog_revision: Some("revision-a".into()),
        call_id: None,
    }
}

#[test]
fn cancellation_before_start_survives_handshake_and_is_not_terminal() {
    let calls = Calls::default();
    let mut request = request();
    let id = calls.prepare(&request).unwrap();
    let scope = Scope::from_request(&request);
    let pending = calls.inspect(&scope, &id, true).unwrap();
    assert_eq!(pending["status"], "cancel_requested");
    assert_eq!(pending["executionFinished"], false);
    request.call_id = Some(id.clone());
    let lease = calls.begin(&request).unwrap();
    assert!(lease.flag.load(Ordering::Acquire));
    assert!(calls.begin(&request).is_err());
    lease.finish(&Err(rejected("worker_cancelled")));
    assert_eq!(
        calls.inspect(&scope, &id, false).unwrap()["executionFinished"],
        false
    );
    drop(lease);
    let finished = calls.inspect(&scope, &id, true).unwrap();
    assert_eq!(finished["status"], "finished");
    assert_eq!(finished["outcome"], "worker_cancelled");
    assert!(calls.begin(&request).is_err());
}

#[test]
fn handle_binds_scope_input_revision_and_capture() {
    let calls = Calls::default();
    let original = request();
    let id = calls.prepare(&original).unwrap();
    for field in [
        "workspaceId",
        "sceneId",
        "pluginId",
        "capabilityId",
        "catalogRevision",
        "input",
        "captureResult",
    ] {
        let mut changed = json!({"workspaceId":original.workspace_id,"sceneId":original.scene_id,
            "pluginId":original.plugin_id,"capabilityId":original.capability_id,
            "catalogRevision":original.catalog_revision,"input":original.input,"captureResult":false,
            "callId":id});
        changed[field] = match field {
            "input" => json!({"text":"changed"}),
            "captureResult" => json!(true),
            _ => json!("changed"),
        };
        let changed: CapabilityInvokeRequest = serde_json::from_value(changed).unwrap();
        assert!(calls.begin(&changed).is_err(), "{field}");
    }
    let mut foreign = Scope::from_request(&original);
    foreign.workspace_id = "workspace-b".into();
    assert!(calls.inspect(&foreign, &id, true).is_err());
    assert_eq!(
        calls
            .inspect(&Scope::from_request(&original), &id, false)
            .unwrap()["status"],
        "prepared"
    );
}

#[test]
fn budgets_expiry_and_abandoned_execution_are_bounded() {
    let calls = Calls::default();
    let mut request = request();
    let mut leases = Vec::new();
    for _ in 0..ACTIVE_LIMIT {
        request.call_id = Some(calls.prepare(&request).unwrap());
        leases.push(calls.begin(&request).unwrap());
    }
    let id = calls.prepare(&request).unwrap();
    request.call_id = Some(id.clone());
    assert!(calls.begin(&request).is_err());
    drop(leases.pop());
    let lease = calls.begin(&request).unwrap();
    drop(lease);
    assert_eq!(
        calls
            .inspect(&Scope::from_request(&request), &id, false)
            .unwrap()["outcome"],
        "plugin_execution_abandoned"
    );
    for entry in calls.0.lock().unwrap().values_mut() {
        entry.changed = Instant::now() - RETENTION;
    }
    assert_eq!(calls.entries().unwrap().len(), ACTIVE_LIMIT - 1);
    for _ in (ACTIVE_LIMIT - 1)..CAPACITY {
        calls.prepare(&request).unwrap();
    }
    assert!(calls.prepare(&request).is_err());
    drop(leases);
}

#[test]
fn reconciliation_seals_prepared_and_never_replays_results() {
    let calls = Calls::default();
    let mut request = request();
    let scope = Scope::from_request(&request);
    let id = calls.prepare(&request).unwrap();
    let proof = calls.reconcile(&scope, &id, &calls.1).unwrap();
    assert_eq!(proof["executionFinished"], true);
    assert_eq!(proof["outcome"], "manual_call_not_started");
    assert!(proof.get("input").is_none() && proof.get("result").is_none());
    request.call_id = Some(id.clone());
    assert!(calls.begin(&request).is_err());
    assert_eq!(calls.reconcile(&scope, &id, &calls.1).unwrap(), proof);
}

#[test]
fn reconciliation_does_not_retire_active_even_after_retention() {
    let calls = Calls::default();
    let mut request = request();
    let scope = Scope::from_request(&request);
    let id = calls.prepare(&request).unwrap();
    request.call_id = Some(id.clone());
    let lease = calls.begin(&request).unwrap();
    calls.0.lock().unwrap().get_mut(&id).unwrap().changed = Instant::now() - RETENTION;
    let proof = calls.reconcile(&scope, &id, &calls.1).unwrap();
    assert_eq!(proof["executionFinished"], false);
    assert_eq!(proof["status"], "cancel_requested");
    assert!(lease.flag.load(Ordering::Acquire));
    drop(lease);
    calls.0.lock().unwrap().get_mut(&id).unwrap().changed = Instant::now() - RETENTION;
    assert!(calls.inspect(&scope, &id, false).is_err());
    let retired = calls.reconcile(&scope, &id, &calls.1).unwrap();
    assert_eq!(retired["executionFinished"], true);
    assert_eq!(retired["outcome"], "manual_call_retired");
    assert!(calls.begin(&request).is_err());
    assert_eq!(calls.entries().unwrap().len(), 0, "no tombstones allocated");
}

#[test]
fn reconciliation_requires_same_host_and_matching_live_scope() {
    let calls = Calls::default();
    let other = Calls::default();
    let request = request();
    let scope = Scope::from_request(&request);
    let id = calls.prepare(&request).unwrap();
    assert!(other.reconcile(&scope, &id, &calls.1).is_err());
    let mut foreign = scope.clone();
    foreign.workspace_id = "foreign".into();
    assert!(calls.reconcile(&foreign, &id, &calls.1).is_err());
    assert_eq!(
        calls.inspect(&scope, &id, false).unwrap()["status"],
        "prepared"
    );
    assert!(calls
        .reconcile(&scope, &uuid::Uuid::new_v4().to_string(), &other.1)
        .is_err());
}

#[test]
fn reconciliation_and_begin_cannot_both_claim_a_sealed_handle() {
    for _ in 0..64 {
        let calls = Calls::default();
        let mut request = request();
        let scope = Scope::from_request(&request);
        let id = calls.prepare(&request).unwrap();
        request.call_id = Some(id.clone());
        let gate = std::sync::Barrier::new(2);
        std::thread::scope(|threads| {
            let begin = threads.spawn(|| {
                gate.wait();
                calls.begin(&request)
            });
            let reconcile = threads.spawn(|| {
                gate.wait();
                calls.reconcile(&scope, &id, &calls.1).unwrap()
            });
            let lease = begin.join().unwrap();
            let proof = reconcile.join().unwrap();
            assert_eq!(proof["executionFinished"], lease.is_err());
            if let Ok(lease) = lease {
                assert!(lease.flag.load(Ordering::Acquire));
                drop(lease);
            }
        });
    }
}
