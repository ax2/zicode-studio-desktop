use super::*;

const SHA: &str = "6c7ddc6cfeee3337d8a310a343d4717ab3e9561704661721a9eac119e3c9cc26";

pub(super) async fn verify(
    host: &HostServer,
    client: &reqwest::Client,
    sender: &Value,
    receiver: &Value,
    root: &std::path::Path,
    workspace: &str,
) {
    let context = export::Context {
        window: "native-encoding-relay".into(),
        workspace: workspace.into(),
        route: "/workspace".into(),
    };
    let post = |route, payload| output_http::post(host, client, route, payload);
    let original = root
        .join("outside-first")
        .canonicalize()
        .unwrap()
        .join("接力用文件.txt");
    let target_directory = root.join("outside-second").canonicalize().unwrap();
    let bytes = vec![b'a'; 8 * 1024 * 1024];
    std::fs::write(&original, &bytes).unwrap();
    let selection = host
        .prepare_native_digest_files(context.clone(), sender.clone(), vec![original.clone()])
        .await
        .unwrap();
    assert_eq!(selection["contentRead"], false);
    let source = host
        .commit_native_digest_file(
            context.clone(),
            sender.clone(),
            selection["files"][0]["grantId"]
                .as_str()
                .unwrap()
                .to_owned(),
            true,
        )
        .await
        .unwrap()["access"]
        .clone();
    let mut target = receiver.clone();
    target["capabilityId"] = json!("devtools.encoding.convert");
    let prepare = || {
        post(
            "prepare-transfer",
            json!({"schemaVersion":1,"source":source,"target":target,"originalFile":true}),
        )
    };
    assert_eq!(
        response(prepare().await).await.1["error"]["code"],
        "resource_file_reference_unavailable"
    );
    let (status, digest) = invoke(host, client, &source).await;
    assert_eq!(status, StatusCode::OK, "{digest}");
    assert_eq!(digest["result"]["files"][0]["sha256"], sha256_hex(&bytes));

    let (status, sharing) = response(prepare().await).await;
    assert_eq!(status, StatusCode::OK, "{sharing}");
    assert_eq!(sharing["fileName"], "接力用文件.txt");
    assert_eq!(sharing["byteLength"], bytes.len());
    assert_eq!(sharing["contentRead"], false);
    assert!(!sharing.to_string().contains("outside-first"));
    let share = |confirmed| {
        post(
            "commit-transfer",
            json!({"schemaVersion":1,"source":source,"grantId":sharing["grantId"],"confirmed":confirmed}),
        )
    };
    let event_count = || {
        host.state
            .plugin_resource_workers
            .events
            .lock()
            .unwrap()
            .len()
    };
    assert_eq!(
        response(share(false).await).await.1["error"]["code"],
        "resource_confirmation_required"
    );
    let before = event_count();
    let (status, shared) = response(share(true).await).await;
    assert_eq!(status, StatusCode::OK, "{shared}");
    assert_eq!(event_count(), before);
    assert_eq!(shared["contentRead"], false);
    let access = json!({"schemaVersion":1,"owner":target,"resourceId":shared["reference"]["resourceId"],"contentVersion":shared["reference"]["contentVersion"]});
    let read = || post("read-view", json!({"access":access,"offset":0,"length":1}));
    assert_eq!(
        response(read().await).await.1["error"]["code"],
        "resource_file_reference_requires_run"
    );
    let input = json!({"sourceEncoding":"utf8","targetEncoding":"utf16le"});
    let (status, converted) = encoding_multi_http::invoke(host, client, &access, &input).await;
    assert_eq!(status, StatusCode::OK, "{converted}");
    assert_eq!(converted["result"]["sourceByteCount"], bytes.len());
    assert_eq!(converted["resources"][0]["byteLength"], 16 * 1024 * 1024);
    assert_eq!(converted["resources"][0]["contentVersion"], SHA);
    let output = encoding_multi_http::derived(&target, &converted["resources"][0]);
    let metadata = host
        .resource_export_metadata(&context, output.clone())
        .unwrap();
    assert_eq!(metadata["extension"], "encoded.txt");

    let destination = target_directory.join("新文件.txt");
    let checkout = host
        .prepare_resource_export(context.clone(), output.clone(), destination.clone())
        .unwrap();
    let grant = checkout["grantId"].as_str().unwrap().to_owned();
    assert!(!destination.exists());
    assert_eq!(
        host.commit_resource_export(context.clone(), output.clone(), grant.clone(), false)
            .unwrap_err(),
        "resource_confirmation_required"
    );
    assert!(!destination.exists());
    let mut other_window = context.clone();
    other_window.window = "wrong-window".into();
    assert!(host
        .commit_resource_export(other_window, output.clone(), grant.clone(), true)
        .is_err());
    let receipt = host
        .commit_resource_export(context.clone(), output.clone(), grant.clone(), true)
        .unwrap();
    assert_eq!(receipt["receipt"]["contentVersion"], SHA);
    let verified = host
        .verify_resource_export(context.clone(), output.clone(), grant)
        .unwrap();
    assert_eq!(verified["status"], "verified");
    assert_eq!(sha256_hex(&std::fs::read(&destination).unwrap()), SHA);
    assert_eq!(std::fs::read(&original).unwrap(), bytes);
    assert_eq!(
        host.prepare_resource_export(context.clone(), output.clone(), original.clone())
            .unwrap_err(),
        "resource_export_conflict"
    );

    let occupied = target_directory.join("写入冲突.txt");
    let conflict = host
        .prepare_resource_export(context.clone(), output.clone(), occupied.clone())
        .unwrap();
    std::fs::write(&occupied, b"existing file").unwrap();
    let conflict_id = conflict["grantId"].as_str().unwrap().to_owned();
    assert_eq!(
        host.commit_resource_export(context, output, conflict_id, true)
            .unwrap_err(),
        "resource_export_conflict"
    );
    assert_eq!(std::fs::read(occupied).unwrap(), b"existing file");

    std::fs::rename(&original, original.with_extension("prior")).unwrap();
    std::fs::write(&original, bytes).unwrap();
    assert_eq!(
        encoding_multi_http::invoke(host, client, &access, &input)
            .await
            .1["error"]["code"],
        "resource_file_changed"
    );
    assert_eq!(
        post("revoke", source.clone()).await.status(),
        StatusCode::OK
    );
    assert_ne!(read().await.status(), StatusCode::OK);
    eprintln!("8 MiB original reference, 16 MiB selected-path export, conflict, replacement and revocation passed");
}
