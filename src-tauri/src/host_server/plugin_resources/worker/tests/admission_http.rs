use super::*;
async fn post(host: &HostServer, client: &reqwest::Client, route: &str, body: Value) -> reqwest::Response {
    client.post(format!("{}/v2/plugin-resources/{route}",host.origin()))
        .header("x-zicode-desktop-token",host.desktop_token()).json(&body).send().await.unwrap()
}
async fn prepare(host: &HostServer, client: &reqwest::Client, access: &Value) -> Value {
    let response = post(host,client,"prepare-call",json!({"schemaVersion":1,"access":access,"input":{}})).await;
    assert_eq!(response.status(),StatusCode::OK);
    let value: Value = response.json().await.unwrap();
    assert_eq!(value["profile"],"resource.call.admission.draft1");
    assert!(value["callId"].as_str().unwrap().starts_with("resource-call-"));
    assert_eq!(value["owner"],access["owner"]);
    value
}
fn invocation(access: &Value, prepared: &Value) -> Value {
    json!({"access":access,"callId":prepared["callId"],"hostInstanceId":prepared["hostInstanceId"],"input":{}})
}
fn recovery(access: &Value, prepared: &Value) -> Value {
    json!({"schemaVersion":1,"owner":access["owner"],"callId":prepared["callId"],"hostInstanceId":prepared["hostInstanceId"]})
}
async fn error(host: &HostServer, client: &reqwest::Client, route: &str, body: Value, expected: &str) {
    let response = post(host,client,route,body).await;
    assert_eq!(response.status(),StatusCode::CONFLICT);
    assert_eq!(response.json::<Value>().await.unwrap()["error"]["code"],expected);
}
pub(super) async fn verify(host: &HostServer, client: &reqwest::Client, access: &Value) -> Value {
    let before = host.state.plugin_resource_workers.events.lock().unwrap().len();
    let ticket = prepare(host,client,access).await;
    let mut changed = invocation(access,&ticket); changed["input"] = json!({"changed":true});
    error(host,client,"invoke-call",changed,"resource_call_changed").await;
    let mut changed = invocation(access,&ticket); changed["access"]["owner"]["capabilityId"] = json!("other");
    error(host,client,"invoke-call",changed,"resource_call_not_admissible").await;
    let mut changed = invocation(access,&ticket); changed["hostInstanceId"] = json!(uuid::Uuid::new_v4());
    error(host,client,"invoke-call",changed,"resource_call_host_changed").await;
    // Removing the strict route cannot reinterpret the opaque call ID as a legacy UUID.
    error(host,client,"invoke-view",json!({"access":access,"toolCallId":ticket["callId"],"input":{}}),"resource_call_invalid").await;
    let sealed: Value = post(host,client,"reconcile-call",recovery(access,&ticket)).await.json().await.unwrap();
    assert_eq!(sealed["phase"],"not_started"); assert_eq!(sealed["executionFinished"],true);
    assert_eq!(sealed["admissionClosed"],true);
    let sealed_again: Value = post(host,client,"reconcile-call",recovery(access,&ticket)).await.json().await.unwrap();
    assert_eq!(sealed_again["phase"],"not_started");
    error(host,client,"invoke-call",invocation(access,&ticket),"resource_call_used").await;
    assert_eq!(host.state.plugin_resource_workers.events.lock().unwrap().len(),before);
    let completed = prepare(host,client,access).await;
    let response = post(host,client,"invoke-call",invocation(access,&completed)).await;
    assert_eq!(response.status(),StatusCode::OK);
    assert_eq!(response.json::<Value>().await.unwrap()["result"],json!({"text":"resource"}));
    let ended: Value = post(host,client,"reconcile-call",recovery(access,&completed)).await.json().await.unwrap();
    assert_eq!(ended["phase"],"ended"); assert_eq!(ended["executionFinished"],true);
    error(host,client,"invoke-call",invocation(access,&completed),"resource_call_used").await;
    let unknown = json!({"callId":format!("resource-call-{}",uuid::Uuid::new_v4()),"hostInstanceId":completed["hostInstanceId"]});
    let missing: Value = post(host,client,"reconcile-call",recovery(access,&unknown)).await.json().await.unwrap();
    assert_eq!(missing["phase"],"not_admissible"); assert_eq!(missing["executionFinished"],true);
    error(host,client,"invoke-call",invocation(access,&unknown),"resource_call_not_admissible").await;
    let mut wrong_host = recovery(access,&completed); wrong_host["hostInstanceId"] = json!(uuid::Uuid::new_v4());
    error(host,client,"reconcile-call",wrong_host,"resource_call_host_changed").await;
    for (route,body) in [
        ("prepare-call",json!({"schemaVersion":1,"access":access,"input":{}})),
        ("invoke-call",invocation(access,&completed)), ("reconcile-call",recovery(access,&completed)),
    ] {
        assert_eq!(client.post(format!("{}/v2/plugin-resources/{route}",host.origin()))
            .bearer_auth("fixture-resource-credential").json(&body).send().await.unwrap().status(),StatusCode::FORBIDDEN);
    }
    let mut invalid = json!({"schemaVersion":1,"access":access,"input":{}}); invalid["callId"] = completed["callId"].clone();
    assert_eq!(post(host,client,"prepare-call",invalid).await.status(),StatusCode::UNPROCESSABLE_ENTITY);

    let active = prepare(host,client,access).await;
    let (events_tx,events_rx) = mpsc::channel(); let (release_tx,release_rx) = mpsc::channel();
    let release_rx = Mutex::new(release_rx);
    *host.state.plugin_resource_workers.observer.lock().unwrap() = Some(Arc::new(move |event,pid| {
        events_tx.send((event,pid)).unwrap();
        if event == "started" { release_rx.lock().unwrap().recv_timeout(Duration::from_secs(10)).unwrap(); }
    }));
    let request = client.post(format!("{}/v2/plugin-resources/invoke-call",host.origin()))
        .header("x-zicode-desktop-token",host.desktop_token()).json(&invocation(access,&active));
    let task = tokio::spawn(async move { request.send().await.unwrap() });
    let started = events_rx.recv_timeout(Duration::from_secs(5)).unwrap(); assert_eq!(started.0,"started");
    host.state.plugins.lock().unwrap().set_permission("programming","com.zicode.studio.resource-fixture","resource.read",false).unwrap();
    let cancelling: Value = post(host,client,"reconcile-call",recovery(access,&active)).await.json().await.unwrap();
    assert_eq!(cancelling["phase"],"active"); assert_eq!(cancelling["executionFinished"],false);
    release_tx.send(()).unwrap();
    let response = task.await.unwrap(); assert!(!response.status().is_success());
    let ended: Value = post(host,client,"reconcile-call",recovery(access,&active)).await.json().await.unwrap();
    assert_eq!(ended["phase"],"ended"); assert_eq!(ended["executionFinished"],true);
    let events: Vec<_> = events_rx.try_iter().collect();
    for name in ["cancel_live","reaped","pipes_closed"] { assert!(events.contains(&(name,started.1))); }
    assert_eq!(host.state.plugin_resource_workers.slots.available_permits(),WORKERS);
    *host.state.plugin_resource_workers.observer.lock().unwrap() = None;
    host.state.plugins.lock().unwrap().set_permission("programming","com.zicode.studio.resource-fixture","resource.read",true).unwrap();
    json!({"passed":true,"sealedPreparedNeverStarted":true,"completedReplayRejected":true,
        "inputScopeAndHostBound":true,"legacyRouteCannotConsumeTicket":true,"missingIsNotAdmissible":true,
        "activeReconciliationWaitsForLeaseDrop":true,"recoveryAfterPermissionRevocation":true,
        "cancelledPid":started.1,"reapedPipesClosed":true,"slotsReleased":true,"desktopOnly":true})
}
