//! Windows acceptance of the advertised hash limits and live Worker control.
use super::*;

const MIB: usize = 1024 * 1024;
// Computed independently with Python hashlib over the exact repeated bytes.
const SINGLE: (&str, &str) = (
    "facb58ac139bf9fc0e1f8b1f147003236b1b69e84f3a4c94166fa66f18f89932",
    "bf3c242afbffc1e460d11a67d6f9879d158938e5f505392b4d40f0060899d7b181a1b21a4d2be58ef3dd9493f116468f3f5e5e5379bd76b359d34637ae9b5b93",
);
const FOUR: [(&str, &str); 4] = [
    ("ad97f87076920684e2ca66fc44e5d322797dc9d64706b174e51b5d0828937043", "559e47d53b75767daad92c33d875eefdbd1f4bc7bf30b2cf4c4b0b8f61ab20c7db6f8c39a070439ee61c42d2deac26be1171ef297c74ed67e9fcb2be728aef15"),
    ("042e995365a46153f8d3a1327d986e2fec93554ed9d6b8126cecc7965ecf3be6", "1e937c18f837be35217cc6ebcf8294190d25a7b064faf788a063f3e26c13fa7d206f41b16796f3b5c44e71c5fe2065db04734f309b14e7da2eefe59950991317"),
    ("50eafc14df6613ee151196ea55fec40a1811bfd06b06aadfd33f200247219004", "d1032a6075ec741f1eeb3387a228f830111a7d8350814aa9e2fc0abad1e1d00d53ca0c599dc0ce4318da1215b991a54940a6f121c0b2445e5992fc0ce07e4f7c"),
    ("2d686f3034d1fb1a4ff6f68d5d5ded0c22b0c4a764e6b6ef775d7c1f0cd2ba25", "0cff0e43311d7fcbd9243b1f04e030ebdf4f62d2507774798770b50af856e9bac99abfc891181854c52f7546242f8d8619f19ae986be74cfea7dc6b0b3ec7cee"),
];
const DIGEST_PLUGIN: &str = "com.zicode.devtools.files";

pub(super) async fn verify(
    host: &HostServer,
    client: &reqwest::Client,
    owner: &Value,
    root: &std::path::Path,
    workspace: &str,
) {
    let directory = root.join("digest-limits");
    std::fs::create_dir(&directory).unwrap();
    let directory = directory.canonicalize().unwrap();
    let context = export::Context {
        window: "native-workspace-digest-max".into(),
        workspace: workspace.into(),
        route: "/workspace".into(),
    };
    let single = directory.join("exact-32m.bin");
    let extra = directory.join("one-extra-byte.bin");
    std::fs::write(&single, vec![b'a'; 32 * MIB]).unwrap();
    std::fs::write(&extra, b"!").unwrap();

    assert_eq!(
        host.prepare_native_digest_files(
            context.clone(),
            owner.clone(),
            vec![single.clone(), extra.clone()]
        )
        .await
        .unwrap_err(),
        "resource_input_too_large"
    );
    let exact = capture(host, &context, owner, vec![single])
        .await
        .pop()
        .unwrap();
    let excess = capture(host, &context, owner, vec![extra])
        .await
        .pop()
        .unwrap();
    let single_started = Instant::now();
    let (status, result) = invoke(host, client, &exact, &[]).await;
    assert_eq!(status, StatusCode::OK, "32 MiB single: {result}");
    assert_rows(&result, 32 * MIB, &[SINGLE]);
    let single_ms = single_started.elapsed().as_millis();

    let (status, result) = invoke(host, client, &exact, std::slice::from_ref(&excess)).await;
    assert_ne!(status, StatusCode::OK);
    assert_eq!(result["error"]["code"], "resource_input_too_large");
    for access in [exact, excess] {
        assert_eq!(
            output_http::post(host, client, "revoke", access)
                .await
                .status(),
            StatusCode::OK
        );
    }

    let paths: Vec<_> = (b'a'..=b'd')
        .map(|byte| {
            let path = directory.join(format!("part-{}.bin", char::from(byte)));
            std::fs::write(&path, vec![byte; 8 * MIB]).unwrap();
            path
        })
        .collect();
    let group = capture(host, &context, owner, paths).await;
    let batch_started = Instant::now();
    let (status, result) = invoke(host, client, &group[0], &group[1..]).await;
    assert_eq!(status, StatusCode::OK, "32 MiB batch: {result}");
    assert_rows(&result, 8 * MIB, &FOUR);
    assert_eq!(
        result["reportResource"]["derivedFromAll"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
    let batch_ms = batch_started.elapsed().as_millis();
    println!("Validated both exact size groups and the one-byte excess through Host.");

    lifecycle(host, client, owner, &group[0], false).await;
    let (status, restored) = invoke(host, client, &group[0], &[]).await;
    assert_eq!(status, StatusCode::OK, "after cancellation: {restored}");
    assert_rows(&restored, 8 * MIB, &FOUR[..1]);
    lifecycle(host, client, owner, &group[0], true).await;
    set_permission(host, true);
    // Revoking a required permission also disables the installed plugin.
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_enabled("programming", DIGEST_PLUGIN, true)
        .unwrap();
    let (status, stale) = invoke(host, client, &group[0], &[]).await;
    assert_ne!(status, StatusCode::OK, "{stale}");
    let fresh = output_http::material(host, client, owner, b"after permission change").await;
    assert_eq!(invoke(host, client, &fresh, &[]).await.0, StatusCode::OK);
    println!(
        "File digest Windows acceptance: {}",
        json!({
            "singleBytes":32*MIB,"fourFilesTotalBytes":32*MIB,"singleMs":single_ms,"fourFilesMs":batch_ms,
            "oversizeRejected":true,"samePluginConcurrencyRejected":true,"liveCancellationReaped":true,
            "livePermissionRevocation":true,"oldGrantsRejectedAfterRegrant":true,"freshCallSucceeded":true
        })
    );
}

async fn capture(
    host: &HostServer,
    context: &export::Context,
    owner: &Value,
    paths: Vec<PathBuf>,
) -> Vec<Value> {
    let preview = host
        .prepare_native_digest_files(context.clone(), owner.clone(), paths)
        .await
        .unwrap();
    assert_eq!(preview["contentRead"], false);
    let mut group = Vec::new();
    for file in preview["files"].as_array().unwrap() {
        let receipt = host
            .commit_native_digest_file(
                context.clone(),
                owner.clone(),
                file["grantId"].as_str().unwrap().to_owned(),
                true,
            )
            .await
            .unwrap();
        group.push(receipt["access"].clone());
    }
    group
}

fn assert_rows(result: &Value, bytes: usize, digests: &[(&str, &str)]) {
    assert_eq!(result["result"]["ok"], true, "{result}");
    let rows = result["result"]["files"].as_array().unwrap();
    assert_eq!(rows.len(), digests.len());
    for (index, (row, (sha256, sha512))) in rows.iter().zip(digests.iter()).enumerate() {
        assert_eq!(row["index"], index);
        assert_eq!(row["bytes"], bytes);
        assert_eq!(row["sha256"], *sha256);
        assert_eq!(row["sha512"], *sha512);
    }
}

async fn invoke(
    host: &HostServer,
    client: &reqwest::Client,
    access: &Value,
    additional: &[Value],
) -> (StatusCode, Value) {
    let response = output_http::post(
        host,
        client,
        "prepare-call",
        json!({"schemaVersion":1,"access":access,"additionalAccesses":additional,"input":{}}),
    )
    .await;
    let status = response.status();
    let ticket: Value = response.json().await.unwrap();
    if status != StatusCode::OK {
        return (status, ticket);
    }
    let response = output_http::post(
        host,
        client,
        "invoke-call",
        json!({"access":access,"additionalAccesses":additional,
        "callId":ticket["callId"],"hostInstanceId":ticket["hostInstanceId"],"input":{}}),
    )
    .await;
    (response.status(), response.json().await.unwrap())
}

fn set_permission(host: &HostServer, granted: bool) {
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_permission("programming", DIGEST_PLUGIN, "resource.read", granted)
        .unwrap();
}

async fn lifecycle(
    host: &HostServer,
    client: &reqwest::Client,
    owner: &Value,
    access: &Value,
    revoke: bool,
) {
    let before = host.state.plugin_resources.lock().unwrap().record_count();
    let (events_tx, events_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let release = Mutex::new(release_rx);
    *host.state.plugin_resource_workers.observer.lock().unwrap() =
        Some(Arc::new(move |event, pid| {
            let _ = events_tx.send((event, pid));
            if event == "started" {
                let _ = release
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(15));
            }
        }));
    let call_id = uuid::Uuid::new_v4().to_string();
    let request = client
        .post(format!("{}/v2/plugin-resources/invoke-view", host.origin()))
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&json!({"access":access,"toolCallId":call_id,"input":{}}));
    let worker = tokio::spawn(async move { request.send().await.unwrap() });
    let (event, pid) = events_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(event, "started");
    if revoke {
        set_permission(host, false);
        assert_eq!(
            events_rx.recv_timeout(Duration::from_secs(5)).unwrap().0,
            "authorization_lost"
        );
    } else {
        let (status, busy) = invoke(host, client, access, &[]).await;
        assert_ne!(status, StatusCode::OK);
        assert_eq!(busy["error"]["code"], "resource_worker_busy");
        assert_eq!(
            output_http::post(
                host,
                client,
                "cancel-view",
                json!({"schemaVersion":1,
            "owner":owner,"toolCallId":call_id})
            )
            .await
            .status(),
            StatusCode::OK
        );
    }
    release_tx.send(()).unwrap();
    let response = tokio::time::timeout(Duration::from_secs(10), worker)
        .await
        .unwrap()
        .unwrap();
    assert!(!response.status().is_success());
    let body: Value = response.json().await.unwrap();
    if !revoke {
        assert_eq!(body["error"]["code"], "worker_cancelled");
    }
    assert!(body.get("reportResource").is_none());
    let events: Vec<_> = events_rx.try_iter().collect();
    for event in ["cancel_live", "reaped", "pipes_closed"] {
        assert!(events.contains(&(event, pid)), "{events:?}");
    }
    assert_eq!(
        host.state.plugin_resource_workers.slots.available_permits(),
        WORKERS
    );
    assert_eq!(
        host.state
            .plugin_resource_workers
            .image_profile_slots
            .available_permits(),
        crate::plugin_resource_execution::IMAGE_RESIZE_MAX_CALLS
    );
    assert_eq!(
        host.state.plugin_resources.lock().unwrap().record_count(),
        before
    );
    *host.state.plugin_resource_workers.observer.lock().unwrap() = None;
}
