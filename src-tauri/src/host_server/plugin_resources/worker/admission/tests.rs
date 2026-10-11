use super::*;
fn key(id: &str) -> Key { ("runtime".into(), "session".into(), id.into()) }

#[test]
fn one_use_input_bound_handles_cannot_be_replayed_or_recreated_by_recovery() {
    let calls = Calls::default();
    assert_eq!(calls.reconcile(&key("missing")).unwrap(), ("not_admissible", true));
    assert!(calls.0.lock().unwrap().is_empty());
    assert_eq!(calls.begin(key("missing"), "fp").err().unwrap(), "resource_call_not_admissible");
    calls.prepare(key("once"), "fp".into()).unwrap();
    assert_eq!(calls.begin(key("once"), "changed").err().unwrap(), "resource_call_changed");
    let lease = calls.begin(key("once"), "fp").unwrap();
    assert_eq!(calls.begin(key("once"), "fp").err().unwrap(), "resource_call_used");
    assert_eq!(calls.reconcile(&key("once")).unwrap(), ("active", false));
    assert!(lease.flag.load(Ordering::Acquire));
    drop(lease);
    assert_eq!(calls.reconcile(&key("once")).unwrap(), ("ended", true));
    assert_eq!(calls.begin(key("once"), "fp").err().unwrap(), "resource_call_used");
    calls.prepare(key("sealed"), "fp".into()).unwrap();
    assert_eq!(calls.reconcile(&key("sealed")).unwrap(), ("not_started", true));
    assert_eq!(calls.reconcile(&key("sealed")).unwrap(), ("not_started", true));
    assert_eq!(calls.begin(key("sealed"), "fp").err().unwrap(), "resource_call_used");
}

#[test]
fn expiry_and_capacity_never_evict_active_work_or_reopen_admission() {
    let calls = Calls::default();
    calls.prepare(key("active"), "fp".into()).unwrap();
    let lease = calls.begin(key("active"), "fp").unwrap();
    calls.prepare(key("expired"), "fp".into()).unwrap();
    for e in calls.0.lock().unwrap().values_mut() { e.changed = Instant::now() - RETENTION; }
    assert_eq!(calls.reconcile(&key("expired")).unwrap(), ("not_admissible", true));
    assert_eq!(calls.reconcile(&key("active")).unwrap(), ("active", false));
    for n in 1..PER_RUNTIME { calls.prepare(key(&n.to_string()), "fp".into()).unwrap(); }
    assert_eq!(calls.prepare(key("overflow"), "fp".into()).unwrap_err(), "resource_call_budget_exceeded");
    drop(lease);
    calls.prepare(key("replacement"), "fp".into()).unwrap();
    assert_eq!(calls.begin(key("active"), "fp").err().unwrap(), "resource_call_not_admissible");
    assert_eq!(calls.reconcile(&key("1")).unwrap(), ("not_started", true));
    calls.prepare(key("after-sealing"), "fp".into()).unwrap();
    assert_eq!(calls.begin(key("1"), "fp").err().unwrap(), "resource_call_not_admissible");
    let second = Calls::default();
    for n in 0..CAPACITY {
        second.prepare((format!("runtime-{}",n/PER_RUNTIME),"s".into(),n.to_string()),"fp".into()).unwrap();
    }
    assert_eq!(second.prepare(("extra".into(),"s".into(),"c".into()),"fp".into()).unwrap_err(),"resource_call_budget_exceeded");
}

#[test]
fn recovery_races_admission_under_the_same_lock() {
    for _ in 0..100 {
        let calls = Calls::default(); calls.prepare(key("race"), "fp".into()).unwrap();
        let ready = Arc::new(std::sync::Barrier::new(2));
        let finish = Arc::new(std::sync::Barrier::new(2));
        std::thread::scope(|scope| {
            scope.spawn(|| {
                ready.wait(); let lease = calls.begin(key("race"), "fp");
                finish.wait(); drop(lease);
            });
            ready.wait();
            let state = calls.reconcile(&key("race")).unwrap();
            assert!(state == ("not_started",true) || state == ("active",false));
            finish.wait();
        });
        assert_eq!(calls.begin(key("race"), "fp").err().unwrap(), "resource_call_used");
    }
}

#[test]
fn strict_requests_and_fingerprints_bind_resource_owner_and_input() {
    let access: Access = serde_json::from_value(json!({"schemaVersion":1,"owner":{"runtimeId":"r","sessionId":"s","pluginId":"p","capabilityId":"c"},"resourceId":uuid::Uuid::new_v4(),"contentVersion":"a".repeat(64)})).unwrap();
    let prepared = json!({"schemaVersion":1,"access":access,"input":{"count":0,"flag":false}});
    assert!(serde_json::from_value::<Prepare>(prepared.clone()).is_ok());
    let mut forbidden = prepared; forbidden["callId"] = json!(uuid::Uuid::new_v4());
    assert!(serde_json::from_value::<Prepare>(forbidden).is_err());
    let first = fingerprint(&access, &json!({"flag":false,"count":0}));
    assert_eq!(first, fingerprint(&access, &json!({"count":0,"flag":false})));
    assert_ne!(first, fingerprint(&access, &json!({"count":1,"flag":false})));
    let mut changed = access.clone(); changed.owner.plugin_id = "other".into();
    assert_ne!(first, fingerprint(&changed, &json!({"count":0,"flag":false})));
    changed = access.clone(); changed.resource_id = uuid::Uuid::new_v4().to_string();
    assert_ne!(first, fingerprint(&changed, &json!({"count":0,"flag":false})));
}
