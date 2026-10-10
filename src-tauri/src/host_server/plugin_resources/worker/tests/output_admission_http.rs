//! Pause after completed raw Worker output preparation, before Host publication.
use super::output_http::{material, post};
use super::*;

pub(super) async fn verify(
    host: &HostServer,
    client: &reqwest::Client,
    owner: &Value,
    bytes: &[u8],
    target: &RuntimeTarget,
) -> Value {
    let mut receipts = Vec::new();
    for cause in [
        "cancel",
        "source",
        "permission",
        "disabled",
        "credential",
        "quota",
        "unrelated",
    ] {
        let access = material(host, client, owner, bytes).await;
        let baseline = host.state.plugin_resources.lock().unwrap().record_count();
        let call = uuid::Uuid::new_v4().to_string();
        let events = Arc::new(Mutex::new(Vec::new()));
        let observed = events.clone();
        let (ready_tx, ready_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let release_rx = Arc::new(Mutex::new(release_rx));
        *host.state.plugin_resource_workers.observer.lock().unwrap() =
            Some(Arc::new(move |event, pid| {
                observed.lock().unwrap().push((event, pid));
                if event == "output_prepared" {
                    ready_tx.send(()).unwrap();
                    release_rx
                        .lock()
                        .unwrap()
                        .recv_timeout(Duration::from_secs(15))
                        .unwrap();
                }
            }));
        let request_client = client.clone();
        let url = format!("{}/v2/plugin-resources/invoke-view", host.origin());
        let token = host.desktop_token().to_string();
        let body = json!({"access":access,"toolCallId":call,"input":{}});
        let invocation = tokio::spawn(async move {
            request_client
                .post(url)
                .header("x-zicode-desktop-token", token)
                .json(&body)
                .send()
                .await
                .unwrap()
        });
        ready_rx.recv_timeout(Duration::from_secs(8)).unwrap();
        assert!(
            host.state.plugin_resources.try_lock().is_ok(),
            "Output preparation must release the resource store"
        );
        assert_eq!(
            host.state.plugin_resources.lock().unwrap().record_count(),
            baseline
        );
        // Worker is already terminal before the injected authorization/cancellation change.
        let pid = events
            .lock()
            .unwrap()
            .iter()
            .find(|r| r.0 == "started")
            .unwrap()
            .1;
        for event in ["reaped", "pipes_closed"] {
            assert!(events.lock().unwrap().contains(&(event, pid)));
        }
        let credential = host
            .state
            .plugin_tokens
            .lock()
            .unwrap()
            .get(&target.instance_id)
            .unwrap()
            .clone();
        let mut quota = Vec::new();
        match cause {
            "cancel" => {
                let cancelled = post(
                    host,
                    client,
                    "cancel-view",
                    json!({"schemaVersion":1,"owner":owner,"toolCallId":call}),
                )
                .await
                .json::<Value>()
                .await
                .unwrap();
                assert_eq!(cancelled["status"], "requested");
                assert_eq!(cancelled["executionFinished"], false);
            }
            "source" => {
                assert_eq!(
                    post(host, client, "revoke", access.clone()).await.status(),
                    StatusCode::OK
                );
            }
            "permission" => host
                .state
                .plugins
                .lock()
                .unwrap()
                .set_permission(
                    "programming",
                    "com.zicode.studio.output-fixture",
                    "resource.read",
                    false,
                )
                .unwrap(),
            "disabled" => host
                .state
                .plugins
                .lock()
                .unwrap()
                .set_enabled("programming", "com.zicode.studio.output-fixture", false)
                .unwrap(),
            "credential" => {
                host.state
                    .plugin_tokens
                    .lock()
                    .unwrap()
                    .get_mut(&target.instance_id)
                    .unwrap()
                    .token_hash = sha256_hex(b"temporary-output-boundary-generation")
            }
            "quota" => {
                while host.state.plugin_resources.lock().unwrap().record_count() < 32 {
                    let row=post(host,client,"prepare",json!({"schemaVersion":1,"owner":owner,"mimeType":"text/plain","byteLength":0,"contentVersion":sha256_hex(b"")})).await;
                    assert_eq!(row.status(), StatusCode::OK);
                    let row = row.json::<Value>().await.unwrap();
                    quota.push(json!({"schemaVersion":1,"owner":owner,"resourceId":row["resourceId"],"contentVersion":sha256_hex(b"")}));
                }
            }
            "unrelated" => host
                .state
                .plugins
                .lock()
                .unwrap()
                .set_permission(
                    "programming",
                    "com.zicode.studio.resource-fixture",
                    "resource.read",
                    false,
                )
                .unwrap(),
            _ => unreachable!(),
        }
        let before_publish = host.state.plugin_resources.lock().unwrap().record_count();
        release_tx.send(()).unwrap();
        let response = invocation.await.unwrap();
        let status = response.status();
        let response = response.json::<Value>().await.unwrap();
        if cause == "unrelated" {
            assert_eq!(status, StatusCode::OK);
            assert_eq!(response["resources"].as_array().unwrap().len(), 1);
            assert_eq!(
                host.state.plugin_resources.lock().unwrap().record_count(),
                before_publish + 1
            );
        } else {
            assert_ne!(status, StatusCode::OK);
            assert!(response.get("resources").is_none());
            assert_eq!(
                host.state.plugin_resources.lock().unwrap().record_count(),
                before_publish
            );
            let expected = match cause {
                "cancel" => "worker_cancelled",
                "source" => "resource_unavailable",
                "permission" => "permission_denied",
                "disabled" => "resource_plugin_unavailable",
                "credential" => "resource_authorization_changed",
                "quota" => "resource_budget_exceeded",
                _ => unreachable!(),
            };
            assert_eq!(response["error"]["code"], expected);
        }
        assert_eq!(
            host.state.plugin_resource_workers.slots.available_permits(),
            WORKERS
        );
        *host.state.plugin_resource_workers.observer.lock().unwrap() = None;
        for reserved in quota {
            assert_eq!(
                post(host, client, "revoke", reserved).await.status(),
                StatusCode::OK
            );
        }
        match cause {
            "permission" => host
                .state
                .plugins
                .lock()
                .unwrap()
                .set_permission(
                    "programming",
                    "com.zicode.studio.output-fixture",
                    "resource.read",
                    true,
                )
                .unwrap(),
            "disabled" => host
                .state
                .plugins
                .lock()
                .unwrap()
                .set_enabled("programming", "com.zicode.studio.output-fixture", true)
                .unwrap(),
            "credential" => {
                host.state
                    .plugin_tokens
                    .lock()
                    .unwrap()
                    .insert(target.instance_id.clone(), credential);
            }
            "unrelated" => host
                .state
                .plugins
                .lock()
                .unwrap()
                .set_permission(
                    "programming",
                    "com.zicode.studio.resource-fixture",
                    "resource.read",
                    true,
                )
                .unwrap(),
            _ => {}
        }
        assert_eq!(
            post(host, client, "revoke", access).await.status(),
            StatusCode::OK
        );
        assert_eq!(
            post(
                host,
                client,
                "cancel-view",
                json!({"schemaVersion":1,"owner":owner,"toolCallId":call})
            )
            .await
            .json::<Value>()
            .await
            .unwrap()["executionFinished"],
            true
        );
        let rows = events.lock().unwrap();
        assert_eq!(rows.iter().filter(|r| r.0 == "started").count(), 1);
        receipts.push(json!({"cause":cause,"pid":pid,"outputBytesPrepared":bytes.len(),"workerAlreadyReapedPipesClosed":true,"storeLockReleased":true,"resultPreserved":cause=="unrelated","noOutputsPublished":cause!="unrelated","slotsReleased":true,"errorCode":response["error"]["code"]}));
    }
    Value::Array(receipts)
}
