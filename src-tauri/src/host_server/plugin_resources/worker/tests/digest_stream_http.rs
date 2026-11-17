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
    host.stop_and_wait().await.unwrap();
}

fn grant_id(value: &Value) -> String {
    value["grantId"].as_str().unwrap().to_owned()
}
