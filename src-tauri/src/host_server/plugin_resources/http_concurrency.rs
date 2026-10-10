//! Actual HTTP quota/backpressure acceptance inside the resource fixture.
use super::*;

pub(super) async fn check(
    host: &HostServer,
    client: &reqwest::Client,
    token: &str,
    read: &Value,
    access: &Value,
) {
    // Hold only the resource store, not the runtime, registry or other Host data.
    let state = host.state.clone();
    let (ready_tx, ready_rx) = oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let held = std::thread::spawn(move || {
        let _guard = state.plugin_resources.lock().unwrap();
        if ready_tx.send(()).is_ok() {
            let _ = release_rx.recv_timeout(Duration::from_secs(5));
        }
    });
    tokio::time::timeout(Duration::from_secs(1), ready_rx)
        .await
        .unwrap()
        .unwrap();
    let mut calls = Vec::new();
    for _ in 0..8 {
        let request = client
            .post(format!("{}/v2/plugin-resources/read", host.origin()))
            .bearer_auth(token)
            .json(read);
        calls.push(tokio::spawn(async move { request.send().await.unwrap() }));
    }
    tokio::time::timeout(Duration::from_secs(2), async {
        while host.state.plugin_resource_operations.active_count() != 8 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let denied = tokio::time::timeout(
        Duration::from_millis(500),
        client
            .post(format!("{}/v2/plugin-resources/revoke", host.origin()))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(access)
            .send(),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(denied.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        denied.json::<Value>().await.unwrap()["error"]["code"],
        "resource_busy"
    );
    // A separate real Host endpoint must remain available while work is saturated.
    let target = host
        .state
        .runtimes
        .statuses()
        .unwrap()
        .into_iter()
        .find(|status| status.target.instance_id == access["owner"]["runtimeId"].as_str().unwrap())
        .unwrap()
        .target;
    let bootstrap = tokio::time::timeout(
        Duration::from_millis(500),
        client
            .get(format!("{}/v2/bootstrap", host.origin()))
            .query(&[
                ("workspaceId", &target.workspace_id),
                ("sessionId", &target.session_id),
            ])
            .send(),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(bootstrap.status().is_success());
    // Drain without logging the bootstrap payload or its credentials.
    bootstrap.bytes().await.unwrap();
    let abandoned = calls.remove(0);
    abandoned.abort();
    assert!(abandoned.await.unwrap_err().is_cancelled());
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert_eq!(host.state.plugin_resource_operations.active_count(), 8);
    release_tx.send(()).unwrap();
    held.join().unwrap();
    for call in calls {
        let response = call.await.unwrap();
        assert!(response.status().is_success());
        let response: Value = response.json().await.unwrap();
        assert_eq!(response["contentVersion"], access["contentVersion"]);
    }
    tokio::time::timeout(Duration::from_secs(1), async {
        while host.state.plugin_resource_operations.active_count() != 0 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let next = client
        .post(format!("{}/v2/plugin-resources/read", host.origin()))
        .bearer_auth(token)
        .json(read)
        .send()
        .await
        .unwrap();
    assert!(next.status().is_success());
    assert_eq!(
        next.json::<Value>().await.unwrap()["contentVersion"],
        access["contentVersion"]
    );
}
