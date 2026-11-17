#![cfg(windows)]
use super::*;
use std::io::Write;

const SHA256: &str = "ba8289c7591c5f7a04cd8e8b7f1a59fd315fa15ee2ccf2fca36427f173accfef";
const SHA512: &str = "157843af4d5f403af9b41ad9a0afd9bfe87bfb1254cbc020de6f47ba95533470e9258b9b448d42089d2391ae71501885d6a4883c1c8247671ccccf325195030c";

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
#[ignore = "requires the frozen streaming package and the production Windows Worker"]
async fn native_digest_stream_checks_disk_progress_cancellation_and_revocation() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .join(format!("native-digest-stream-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    let workspace = root.join("workspace");
    let selected = root.join("outside-workspace");
    for dir in [&public, &workspace, &selected] {
        std::fs::create_dir_all(dir).unwrap();
    }
    let selected = selected.canonicalize().unwrap();
    let empty = selected.join("空文件.txt");
    std::fs::write(&empty, b"").unwrap();
    let large = selected.join("大文件.bin");
    let mut file = std::fs::File::create(&large).unwrap();
    let pattern = (0..=255u8).collect::<Vec<_>>().repeat(256);
    for _ in 0..96 * 16 {
        file.write_all(&pattern).unwrap();
    }
    file.write_all(&pattern[..17]).unwrap();
    drop(file);
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start_with_mode(
        public,
        NativePiManager::new(16),
        auth,
        HashMap::new(),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    let target = RuntimeTarget::new(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "digest-stream-session",
        "digest-stream-runtime",
    );
    host.start_tool_session(target.clone()).unwrap();
    host.state
        .data
        .workspace_roots()
        .write()
        .unwrap()
        .insert(target.workspace_id.clone(), workspace);
    let plugin = crate::plugin_resource_execution::file_digest::PLUGIN;
    let package = PathBuf::from(std::env::var_os("ZICODE_TEST_FILES_STREAM_PACKAGE").unwrap());
    *host
        .state
        .plugin_resource_workers
        .executable
        .lock()
        .unwrap() = Some(PathBuf::from(
        std::env::var_os("ZICODE_TEST_RESOURCE_WORKER_EXE").unwrap(),
    ));
    {
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(registry.install_developer(&package).unwrap(), plugin);
        registry
            .set_permission("programming", plugin, "resource.read", true)
            .unwrap();
        registry.set_enabled("programming", plugin, true).unwrap();
    }
    let context = export::Context {
        window: "digest-stream-window".into(),
        workspace: target.workspace_id.clone(),
        route: "/workspace".into(),
    };
    let owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":plugin,"capabilityId":"devtools.files.hash"});
    let prepare = |paths| host.prepare_native_digest_stream(context.clone(), owner.clone(), paths);
    let run = |id, confirmed, expected| {
        host.run_native_digest_stream(context.clone(), owner.clone(), id, confirmed, expected)
    };
    let prepare_large = || prepare(vec![empty.clone(), large.clone()]);
    assert!(host
        .prepare_native_digest_files(context.clone(), owner.clone(), vec![large.clone()])
        .await
        .is_err());
    assert_eq!(
        prepare(vec![empty.clone(), empty.clone()])
            .await
            .unwrap_err(),
        "resource_file_selection_invalid"
    );
    assert_eq!(
        prepare(vec![empty.clone(); 65]).await.unwrap_err(),
        "resource_file_selection_invalid"
    );
    let prepared = prepare_large().await.unwrap();
    let id = grant_id(&prepared);
    assert_eq!(prepared["contentRead"], false);
    assert_eq!(
        prepared["files"],
        json!([{"name":"空文件.txt","byteLength":0},{"name":"大文件.bin","byteLength":96*1024*1024+17}])
    );
    assert!(!prepared.to_string().contains("outside-workspace"));
    assert_eq!(
        run(id.clone(), false, String::new()).await.unwrap_err(),
        "resource_confirmation_required"
    );
    assert_eq!(
        run(id.clone(), true, "abc".into()).await.unwrap_err(),
        "invalid_parameters"
    );
    let sibling = export::Context {
        window: "sibling".into(),
        ..context.clone()
    };
    assert_eq!(
        host.run_native_digest_stream(
            sibling.clone(),
            owner.clone(),
            id.clone(),
            true,
            String::new()
        )
        .await
        .unwrap_err(),
        "resource_file_grant_invalid"
    );
    assert_eq!(
        host.cancel_native_digest_stream(&sibling, owner.clone(), &id)
            .unwrap_err(),
        "resource_file_grant_invalid"
    );
    assert!(host
        .native_digest_stream_progress(&context, owner.clone(), &id)
        .is_err());

    let progress = |id: String| {
        let host = &host;
        let context = &context;
        let owner = &owner;
        async move {
            let until = Instant::now() + Duration::from_secs(12);
            loop {
                if let Ok(value) = host.native_digest_stream_progress(context, owner.clone(), &id) {
                    if value["bytesRead"].as_u64().unwrap() > 0 {
                        break value;
                    }
                }
                assert!(Instant::now() < until, "no streaming progress");
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }
    };
    let (result, observed) = tokio::join!(
        run(id.clone(), true, SHA512.to_owned()),
        progress(id.clone())
    );
    assert_eq!(observed["totalBytes"], 96 * 1024 * 1024 + 17);
    assert!(observed["bytesRead"].as_u64().unwrap() < observed["totalBytes"].as_u64().unwrap());
    assert!(host
        .native_digest_stream_progress(&context, owner.clone(), &id)
        .is_err());
    let result = result.unwrap();
    assert_eq!(
        result["result"]["files"][1],
        json!({"index":1,"bytes":96*1024*1024+17,"sha256":SHA256,"sha512":SHA512,"matches":true})
    );
    assert_eq!(result["result"]["files"][0]["sha256"], sha256_hex(b""));
    assert_eq!(result["report"]["files"][1]["name"], "大文件.bin");
    assert_eq!(result["report"]["packageVersion"], "0.2.0");
    assert_eq!(result["report"]["comparison"]["algorithm"], "SHA-512");
    assert!(host
        .prepare_native_digest_stream_original(&context, result["reportAccess"].clone(), 1)
        .is_err());
    assert!(!result.to_string().contains("outside-workspace"));
    assert_eq!(
        run(id, true, String::new()).await.unwrap_err(),
        "resource_file_grant_invalid"
    );

    let id = grant_id(&prepare_large().await.unwrap());
    let (outcome, ()) = tokio::join!(run(id.clone(), true, String::new()), async {
        progress(id.clone()).await;
        host.cancel_native_digest_stream(&context, owner.clone(), &id)
            .unwrap();
    });
    assert_eq!(outcome.unwrap_err(), "worker_cancelled");
    let id = grant_id(&prepare_large().await.unwrap());
    let (outcome, ()) = tokio::join!(run(id.clone(), true, String::new()), async {
        progress(id.clone()).await;
        host.state
            .plugins
            .lock()
            .unwrap()
            .set_permission("programming", plugin, "resource.read", false)
            .unwrap();
    });
    assert_eq!(outcome.unwrap_err(), "resource_authorization_changed");
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry
            .set_permission("programming", plugin, "resource.read", true)
            .unwrap();
        registry.set_enabled("programming", plugin, true).unwrap();
    }

    let old = selected.join("变更.txt");
    std::fs::write(&old, b"abc").unwrap();
    let changed = grant_id(&prepare(vec![old.clone()]).await.unwrap());
    std::fs::rename(&old, old.with_extension("prior")).unwrap();
    std::fs::write(&old, b"abc").unwrap();
    assert_eq!(
        run(changed, true, String::new()).await.unwrap_err(),
        "resource_file_changed"
    );

    let mut paths = Vec::new();
    for index in 0..64 {
        let path = selected.join(format!("file-{index:02}.txt"));
        std::fs::write(&path, [index as u8]).unwrap();
        paths.push(path);
    }
    let id = grant_id(&prepare(paths).await.unwrap());
    let result = run(id, true, String::new()).await.unwrap();
    for (index, row) in result["report"]["files"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
    {
        assert_eq!(row["name"], format!("file-{index:02}.txt"));
        assert_eq!(row["sha256"], sha256_hex(&[index as u8]));
    }
    assert_eq!(result["result"]["files"].as_array().unwrap().len(), 64);
    eprintln!("native stream: 96 MiB, 64 files, live progress, cancel, revocation, wrong window and replacement passed");
    verify_report_and_original(&host, &context, &selected, &result, &owner).await;
    host.stop_and_wait().await.unwrap();
}

fn grant_id(value: &Value) -> String {
    value["grantId"].as_str().unwrap().to_owned()
}

async fn verify_report_and_original(
    host: &HostServer,
    context: &export::Context,
    root: &std::path::Path,
    result: &Value,
    owner: &Value,
) {
    let report = &result["reportAccess"];
    let descriptor = &result["reportResource"];
    assert_eq!(
        descriptor["profile"],
        "resource.host.file-digest-stream-report.draft1"
    );
    assert!(descriptor["byteLength"].as_u64().unwrap() > 8192);
    let destination = root.join("64-file-report.json");
    let preview = host
        .prepare_resource_export(context.clone(), report.clone(), destination.clone())
        .unwrap();
    let grant = grant_id(&preview);
    assert!(!destination.exists());
    assert_eq!(
        host.commit_resource_export(context.clone(), report.clone(), grant.clone(), false)
            .unwrap_err(),
        "resource_confirmation_required"
    );
    assert!(!destination.exists());
    let receipt = host
        .commit_resource_export(context.clone(), report.clone(), grant.clone(), true)
        .unwrap();
    assert_eq!(
        receipt["receipt"]["contentVersion"],
        descriptor["contentVersion"]
    );
    host.verify_resource_export(context.clone(), report.clone(), grant)
        .unwrap();
    let bytes = std::fs::read(&destination).unwrap();
    assert_eq!(sha256_hex(&bytes), descriptor["contentVersion"]);
    assert_eq!(
        serde_json::from_slice::<Value>(&bytes).unwrap(),
        result["report"]
    );
    assert_eq!(
        host.prepare_resource_export(context.clone(), report.clone(), destination)
            .unwrap_err(),
        "resource_export_conflict"
    );

    let receiver = "com.zicode.devtools.encoding";
    {
        let mut registry = host.state.plugins.lock().unwrap();
        let package = PathBuf::from(std::env::var_os("ZICODE_TEST_ENCODING_PACKAGE").unwrap());
        assert_eq!(registry.install_developer(&package).unwrap(), receiver);
        registry
            .set_permission("programming", receiver, "resource.read", true)
            .unwrap();
        registry.set_enabled("programming", receiver, true).unwrap();
    }
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let request = |route, payload| output_http::post(host, &client, route, payload);
    let mut target = owner.clone();
    target["pluginId"] = json!(receiver);
    target["capabilityId"] = json!("devtools.encoding.convert");
    let original =
        |index| host.prepare_native_digest_stream_original(context, report.clone(), index);
    let first = original(42).unwrap();
    assert_eq!(first["contentRead"], false);
    assert_eq!(first["access"], original(42).unwrap()["access"]);
    let wrong = export::Context {
        window: "wrong".into(),
        ..context.clone()
    };
    assert!(host
        .prepare_native_digest_stream_original(&wrong, report.clone(), 42)
        .is_err());
    assert_eq!(first["fileName"], "file-42.txt");
    let source = &first["access"];
    let direct = request("read-view", json!({"access":source,"offset":0,"length":1}))
        .await
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(
        direct["error"]["code"],
        "resource_file_reference_requires_run"
    );
    assert!(host
        .resource_export_metadata(context, source.clone())
        .is_err());
    let prepare = |source: &Value| {
        request(
            "prepare-transfer",
            json!({"schemaVersion":1,"source":source,"target":target,"originalFile":true}),
        )
    };
    let consent = prepare(source).await.json::<Value>().await.unwrap();
    let commit = |source: &Value, grant_id: &Value, confirmed| {
        request(
            "commit-transfer",
            json!({"schemaVersion":1,"source":source,"grantId":grant_id,"confirmed":confirmed}),
        )
    };
    assert_eq!(
        commit(source, &consent["grantId"], false)
            .await
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_confirmation_required"
    );
    let shared = commit(source, &consent["grantId"], true)
        .await
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(shared["contentRead"], false);
    let delegated = json!({"schemaVersion":1,"owner":target,"resourceId":shared["reference"]["resourceId"],"contentVersion":shared["reference"]["contentVersion"]});
    let input = json!({"sourceEncoding":"utf8","targetEncoding":"utf16le"});
    let prepared = request(
        "prepare-call",
        json!({"schemaVersion":1,"access":delegated,"input":input}),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    let response = request("invoke-call", json!({"access":delegated,"callId":prepared["callId"],"hostInstanceId":prepared["hostInstanceId"],"input":input})).await;
    let status = response.status();
    let converted = response.json::<Value>().await.unwrap();
    assert_eq!(status, StatusCode::OK, "{converted}");
    assert_eq!(
        converted["resources"][0]["contentVersion"],
        sha256_hex(b"*\0")
    );

    let other = original(43).unwrap();
    let changed = root.join("file-43.txt");
    std::fs::rename(&changed, changed.with_extension("prior")).unwrap();
    std::fs::write(&changed, [43]).unwrap();
    let source = &other["access"];
    let consent = prepare(source).await.json::<Value>().await.unwrap();
    assert_eq!(
        commit(source, &consent["grantId"], true)
            .await
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_file_changed"
    );
    assert_eq!(
        request("revoke", report.clone()).await.status(),
        StatusCode::OK
    );
    assert!(original(42).is_err());
    eprintln!("64-file JSON saved and verified; original reference guarded and converted; replace and revoke rejected");
}
