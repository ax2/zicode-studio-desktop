use super::*;
use crate::metadata_store::MetadataStore;

fn receiver(path: &std::path::Path) {
    std::fs::create_dir_all(path.join("runtime")).unwrap();
    let prefix =
        r#"{"contractVersion":"1.0.0-rc.1","ok":true,"data":{"text":"received","request":"#;
    let suffix = r#"},"error":null}"#;
    let escaped = |text: &str| {
        text.bytes()
            .map(|byte| format!("\\{byte:02x}"))
            .collect::<String>()
    };
    // Self-owned protocol observer: returns the guest's actual stdin JSON, not a diff implementation.
    let module = format!(
        r#"(module
      (import "wasi_snapshot_preview1" "fd_read" (func $read (param i32 i32 i32 i32) (result i32)))
      (import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32)))
      (memory (export "memory") 2)
      (data (i32.const 256) "{}") (data (i32.const 512) "{}")
      (func (export "_start") (local $total i32) (local $n i32)
        (block $done (loop $again
          (i32.store (i32.const 64) (i32.add (i32.const 1024) (local.get $total)))
          (i32.store (i32.const 68) (i32.sub (i32.const 49152) (local.get $total)))
          (drop (call $read (i32.const 0) (i32.const 64) (i32.const 1) (i32.const 80)))
          (local.set $n (i32.load (i32.const 80))) (br_if $done (i32.eqz (local.get $n)))
          (local.set $total (i32.add (local.get $total) (local.get $n))) (br $again)))
        (memory.copy (i32.sub (i32.const 1024) (i32.const {2})) (i32.const 256) (i32.const {2}))
        (memory.copy (i32.add (i32.const 1024) (local.get $total)) (i32.const 512) (i32.const {3}))
        (i32.store (i32.const 0) (i32.sub (i32.const 1024) (i32.const {2})))
        (i32.store (i32.const 4) (i32.add (local.get $total) (i32.const {2})))
        (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const {3})))
        (block $written (loop $write_all
          (drop (call $write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 100)))
          (local.set $n (i32.load (i32.const 100))) (br_if $written (i32.eqz (local.get $n)))
          (i32.store (i32.const 0) (i32.add (i32.load (i32.const 0)) (local.get $n)))
          (i32.store (i32.const 4) (i32.sub (i32.load (i32.const 4)) (local.get $n)))
          (br_if $write_all (i32.ne (i32.load (i32.const 4)) (i32.const 0)))))))"#,
        escaped(prefix),
        escaped(suffix),
        prefix.len(),
        suffix.len()
    );
    std::fs::write(path.join("runtime/observe.wasm"), module).unwrap();
    let schema = json!({"type":"object","properties":{"left":{"type":"string","maxLength":8192},"right":{"type":"string","maxLength":8192}},"required":["left","right"],"additionalProperties":false});
    std::fs::write(path.join("plugin.json"), json!({"schemaVersion":1,"id":"com.example.compare","name":"Synthetic pair observer","description":"Synthetic stdin observer for Studio acceptance","version":"0.1.0","publisher":"studio-test","engines":{"zicode":">=0.1.0 <1.0.0","pluginApi":"^1.0.0"},"activationEvents":["onCapability:compare.lines"],"runtime":{"wasi":"runtime/observe.wasm"},"contributes":{"capabilities":[{"id":"compare.lines","title":"Compare input observer","inputSchema":schema}]}}).to_string()).unwrap();
}

#[tokio::test]
async fn actual_http_multi_input_preview_rejects_unconfirmed_missing_and_overwrite() {
    exercise(false).await;
}

#[tokio::test]
#[ignore = "requires retained Studio Worker EXE; real HTTP and stdin-observing WASI"]
async fn actual_http_multi_input_worker_receives_both_sides_and_replays_once() {
    exercise(true).await;
}

async fn exercise(real_worker: bool) {
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let root = project
        .join(".cache/task-scratch")
        .join(format!("multi-input-http-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("public")).unwrap();
    std::fs::write(root.join("owner.json"), json!({"purpose":"synthetic multi-input HTTP/Worker acceptance","keep":"receipt and tiny observer retained until stage closes"}).to_string()).unwrap();
    receiver(&root.join("receiver"));
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(root.join("public"), NativePiManager::new(16), auth)
        .await
        .unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        for path in [
            project.join("tests/fixtures/devtools-text-dev57"),
            root.join("receiver"),
        ] {
            let id = registry.install_developer(&path).unwrap();
            registry.set_enabled("programming", &id, true).unwrap();
        }
    }
    let events = Arc::new(Mutex::new(Vec::new()));
    let starts = || {
        events
            .lock()
            .unwrap()
            .iter()
            .filter(|(event, _)| *event == "started")
            .count()
    };
    if real_worker {
        let observed = events.clone();
        host.state.capability_broker.lock().unwrap().worker_observer =
            Some(Arc::new(move |event, pid| {
                observed.lock().unwrap().push((event, pid));
            }));
        host.state
            .capability_broker
            .lock()
            .unwrap()
            .worker_executable = Some(PathBuf::from(
            std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap(),
        ));
    }
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let post = |path: &str, body: Value| {
        client
            .post(format!("{}{path}", host.origin()))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&body)
            .send()
    };
    let scope = json!({"workspaceId":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","sceneId":"programming","pluginId":"com.zicode.devtools.text","capabilityId":"devtools.text.base64.encode"});
    let mut invocation = scope.clone();
    invocation["input"] = json!({"text":"source"});
    invocation["captureResult"] = json!(true);
    let reference = if real_worker {
        let result: Value = post("/v2/plugin-capabilities/invoke", invocation.clone())
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(result["result"]["data"]["text"], "c291cmNl");
        result["resultRef"].clone()
    } else {
        let request: CapabilityInvokeRequest = serde_json::from_value(invocation.clone()).unwrap();
        let registry = host.state.plugins.lock().unwrap();
        let expected = source_proof(&registry, &request).unwrap();
        capture(
            &host.state,
            &registry,
            &request,
            &expected,
            &json!({"ok":true,"data":{"text":"c291cmNl"}}),
        )
        .unwrap()
    };
    let found: Value = post(
        "/v2/plugin-results/targets",
        json!({"scope":scope,"resultId":reference["resultId"],"query":"Compare input observer"}),
    )
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(found["total"], 2);
    assert_eq!(found["items"][0]["field"], "left");
    assert_eq!(found["items"][0]["requiredInputs"], json!(["right"]));
    assert_eq!(found["items"][1]["field"], "right");
    assert_eq!(found["items"][1]["requiredInputs"], json!(["left"]));
    let mut grants = Vec::new();
    for (field, other) in [("left", "right"), ("right", "left")] {
        let before_preview = starts();
        let mut prepare = json!({"scope":scope,"resultId":reference["resultId"],"target":{"pluginId":"com.example.compare","capabilityId":"compare.lines"},"field":field,"inputs":{other:"other\r\n中"}});
        let valid_inputs = prepare["inputs"].clone();
        for invalid in [
            json!({}),
            json!({other:"x",field:"overwrite"}),
            json!({other:7}),
            json!({other:"中".repeat(2731)}),
        ] {
            prepare["inputs"] = invalid;
            assert_eq!(
                post("/v2/plugin-results/prepare-transfer", prepare.clone())
                    .await
                    .unwrap()
                    .status(),
                StatusCode::CONFLICT
            );
        }
        prepare["inputs"] = valid_inputs.clone();
        let preview: Value = post("/v2/plugin-results/prepare-transfer", prepare)
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(preview["preview"]["inputs"], valid_inputs);
        assert_eq!(preview["preview"]["text"], "c291cmNl");
        let mut commit = json!({"scope":scope,"grantId":preview["grantId"],"confirmed":false});
        assert_eq!(
            post("/v2/plugin-results/commit-transfer", commit.clone())
                .await
                .unwrap()
                .status(),
            StatusCode::CONFLICT
        );
        assert_eq!(starts(), before_preview);
        if real_worker {
            commit["confirmed"] = json!(true);
            let response: Value = post("/v2/plugin-results/commit-transfer", commit.clone())
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
            assert_eq!(
                response["result"]["data"]["request"]["input"][field],
                "c291cmNl"
            );
            assert_eq!(
                response["result"]["data"]["request"]["input"][other],
                "other\r\n中"
            );
            let before_replay = starts();
            let replay: Value = post("/v2/plugin-results/commit-transfer", commit.clone())
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
            assert_eq!(replay["replayed"], true);
            assert_eq!(replay["resultRef"], response["resultRef"]);
            assert_eq!(starts(), before_replay);
        }
        grants.push(commit);
    }
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry
            .set_enabled("programming", "com.example.compare", false)
            .unwrap();
    }
    for mut grant in grants {
        grant["confirmed"] = json!(true);
        assert_eq!(
            post("/v2/plugin-results/commit-transfer", grant)
                .await
                .unwrap()
                .status(),
            StatusCode::CONFLICT
        );
    }
    if real_worker {
        let result: Value = post("/v2/plugin-capabilities/invoke", invocation)
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(result["result"]["data"]["text"], "c291cmNl");
    }
    assert!(host
        .state
        .artifacts
        .lock()
        .unwrap()
        .scoped(scope["workspaceId"].as_str().unwrap())
        .unwrap()
        .list("programming", None, None, None)
        .unwrap()
        .artifacts
        .is_empty());
    host.stop_and_wait().await.unwrap();
    assert_eq!(starts(), if real_worker { 4 } else { 0 });
    let events = events.lock().unwrap().clone();
    assert_eq!(
        events
            .iter()
            .filter(|(event, _)| *event == "pipes_closed")
            .count(),
        if real_worker { 4 } else { 0 }
    );
    let receipt = json!({"passed":true,"realWorker":real_worker,"mappings":2,"replays":if real_worker {2} else {0},"artifactsSaved":0,"hostStopped":true,"workerEvents":events,"devtoolsDiffAccepted":false});
    std::fs::write(root.join("receipt.json"), receipt.to_string()).unwrap();
    if let Some(destination) = std::env::var_os("ZICODE_TEST_EVIDENCE_DIR") {
        std::fs::create_dir_all(&destination).unwrap();
        std::fs::write(
            PathBuf::from(destination).join(if real_worker {
                "worker-receipt.json"
            } else {
                "http-receipt.json"
            }),
            json!({"root":root,"receipt":receipt}).to_string(),
        )
        .unwrap();
    }
}
