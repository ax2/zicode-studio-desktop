//! Deterministic busy-slot/control-plane test; no simulated HTTP responses.
use super::*;

pub(super) async fn verify(host: &HostServer, client: &reqwest::Client, prepare: &Value) {
    let preview: Value = client
        .post(format!(
            "{}/v2/plugin-resources/prepare-local-file",
            host.origin()
        ))
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(prepare)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let body = json!({"schemaVersion":1,"owner":prepare["owner"],"grantId":preview["grantId"],"confirmed":true});
    let request: FileGrant = serde_json::from_value(body.clone()).unwrap();
    let (grant, control) = host
        .state
        .plugin_resources
        .lock()
        .unwrap()
        .file_imports
        .begin(&request)
        .unwrap();
    let lease = reading::Lease {
        state: host.state.clone(),
        id: request.grant_id.clone(),
    };
    let baseline = host.state.plugin_resources.lock().unwrap().record_count();
    let mut tasks = Vec::new();
    let mut releases = Vec::new();
    let mut read = Some((grant, control, lease));
    for _ in 0..8 {
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let state = host.state.clone();
        let read = read.take();
        tasks.push(tokio::spawn(async move {
            state
                .plugin_resource_operations
                .run(move || {
                    ready_tx.send(()).unwrap();
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                    if let Some((grant, control, _lease)) = read {
                        let error = files::snapshot_controlled(
                            &grant.root,
                            &grant.relative,
                            &grant.stamp,
                            &control,
                        )
                        .unwrap_err();
                        assert_eq!(error.1 .0["error"]["code"], "resource_file_read_cancelled");
                    }
                    Ok(json!({"finished":true}))
                })
                .await
        }));
        releases.push(release_tx);
        tokio::time::timeout(Duration::from_secs(2), ready_rx)
            .await
            .unwrap()
            .unwrap();
    }
    assert_eq!(host.state.plugin_resource_operations.active_count(), 8);
    // The active grant is deliberately staged at the read boundary. All real
    // operation slots are occupied, so routing cancellation through them fails.
    let response = tokio::time::timeout(
        Duration::from_secs(2),
        client
            .post(format!(
                "{}/v2/plugin-resources/cancel-local-file",
                host.origin()
            ))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&body)
            .send(),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let result: Value = response.json().await.unwrap();
    assert_eq!(result["cancellationRequested"], true);
    assert_eq!(result["executionFinished"], false);
    assert_eq!(result["contentRead"], Value::Null);
    assert_eq!(host.state.plugin_resource_operations.active_count(), 8);
    assert_eq!(
        host.state
            .plugin_resources
            .lock()
            .unwrap()
            .file_imports
            .1
            .len(),
        1
    );
    for release in releases {
        release.send(()).unwrap();
    }
    for task in tasks {
        assert_eq!(task.await.unwrap().unwrap().0["finished"], true);
    }
    assert_eq!(host.state.plugin_resource_operations.active_count(), 0);
    let store = host.state.plugin_resources.lock().unwrap();
    assert!(store.file_imports.1.is_empty());
    assert_eq!(store.record_count(), baseline);
    println!("Real HTTP cancel admitted with 8 busy slots; staged read rejected; lease removed; no resource published");
}
