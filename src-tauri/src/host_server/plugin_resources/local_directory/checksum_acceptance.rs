use super::*;
use crate::host_server::{HostMode, HostServer};
use std::fs;

const FILES: &str = "com.zicode.devtools.files";
const MANIFEST: &str = "com.zicode.devtools.checksum-manifest";
const HASH: &str = crate::plugin_resource_execution::file_digest::CAPABILITY;
const REVIEW: &str = "devtools.checksum-manifest.review";
const ABC: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires receipt-verified candidate directories and a retained Studio Worker executable"]
async fn checksum_folder_uses_confirmed_directory_and_independent_wasi_review() {
    let env_path = |name: &str| PathBuf::from(std::env::var_os(name).expect(name));
    let files_package = env_path("ZICODE_TEST_FILES_PACKAGE");
    let manifest_package = env_path("ZICODE_TEST_CHECKSUM_MANIFEST_PACKAGE");
    let worker = env_path("ZICODE_TEST_WORKER_EXE");
    assert!(worker.is_file());
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .join(format!("checksum-folder-{}", uuid::Uuid::new_v4()));
    let folder = root.join("用户选择的目录");
    let workspace = root.join("workspace");
    let public = root.join("public");
    fs::create_dir_all(&folder).unwrap();
    fs::create_dir_all(&workspace).unwrap();
    let folder = folder.canonicalize().unwrap();
    assert!(!folder.starts_with(workspace.canonicalize().unwrap()));
    fs::create_dir_all(&public).unwrap();
    fs::write(root.join("owner.json"), br#"{"purpose":"Checksum folder Host/Worker acceptance","lifetime":"retain compact evidence"}"#).unwrap();
    fs::create_dir(folder.join("entry-3.txt")).unwrap();
    let names: Vec<_> = (0..64).map(|i| format!("entry-{i}.txt")).collect();
    for (index, name) in names.iter().enumerate() {
        match index {
            1 => fs::write(folder.join(name), b"modified").unwrap(),
            2 | 3 => {}
            _ => fs::write(folder.join(name), b"abc").unwrap(),
        }
    }
    let mut manifest = names
        .iter()
        .map(|name| format!("{ABC}  {name}\n"))
        .collect::<String>();
    manifest.extend(std::iter::repeat_n('\n', 32 * 1024 - manifest.len()));
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
        "checksum-session",
        "checksum-runtime",
    );
    host.start_tool_session(target.clone()).unwrap();
    host.state
        .data
        .workspace_roots()
        .write()
        .unwrap()
        .insert(target.workspace_id.clone(), workspace);
    {
        let mut registry = host.state.plugins.lock().unwrap();
        for (id, package) in [(FILES, files_package), (MANIFEST, manifest_package)] {
            assert_eq!(registry.install_developer(&package).unwrap(), id);
        }
        registry
            .set_permission("programming", FILES, "resource.read", true)
            .unwrap();
        for id in [FILES, MANIFEST] {
            registry.set_enabled("programming", id, true).unwrap();
        }
    }
    host.state
        .capability_broker
        .lock()
        .unwrap()
        .worker_executable = Some(worker);
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let post = |route: &str, body: Value| {
        client
            .post(format!("{}{route}", host.origin()))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&body)
            .send()
    };
    let owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":FILES,"capabilityId":HASH});
    let context = Context {
        window: "native-workspace-checksum".into(),
        workspace: target.workspace_id.clone(),
        route: "/workspace".into(),
    };
    let foreign_window = Context {
        window: "native-workspace-other".into(),
        ..context.clone()
    };
    let foreign_route = Context {
        route: "/other".into(),
        ..context.clone()
    };
    let foreign_workspace = Context {
        workspace: "other-workspace".into(),
        ..context.clone()
    };
    let prepare = || {
        host.prepare_native_checksum_folder(
            context.clone(),
            owner.clone(),
            manifest.clone(),
            folder.clone(),
        )
    };
    let commit = |grant: &str, confirmed: bool| {
        host.commit_native_plugin_directory(
            context.clone(),
            owner.clone(),
            grant.to_owned(),
            confirmed,
        )
    };
    let denied = host
        .prepare_native_checksum_folder(
            foreign_workspace,
            owner.clone(),
            manifest.clone(),
            folder.clone(),
        )
        .await
        .unwrap_err();
    assert_eq!(denied, "resource_authorization_changed");
    let preview = prepare().await.unwrap();
    assert_eq!(preview["profile"], checksum::PROFILE, "{preview}");
    assert_eq!(preview["entryNamesRead"], false);
    assert_eq!(preview["displayName"], "用户选择的目录");
    assert!(preview.get("entries").is_none() && preview.get("relativePath").is_none());
    assert!(!preview.to_string().contains("task-scratch"));
    let grant_id = preview["grantId"].as_str().unwrap();
    let counters = host
        .native_checksum_folder_progress(&context, owner.clone(), grant_id)
        .unwrap();
    assert_eq!(counters["filesTotal"], 64);
    assert_eq!(counters["filesCompleted"], 0);
    assert_eq!(counters["fileSize"], Value::Null);
    assert_eq!(
        host.native_checksum_folder_progress(&foreign_route, owner.clone(), grant_id)
            .unwrap_err(),
        "resource_directory_grant_unavailable"
    );
    assert_eq!(
        commit(grant_id, false).await.unwrap_err(),
        "resource_confirmation_required"
    );
    let denied = host
        .commit_native_plugin_directory(foreign_window, owner.clone(), grant_id.to_owned(), true)
        .await
        .unwrap_err();
    assert_eq!(denied, "resource_directory_grant_unavailable");
    let denied = host
        .cancel_native_plugin_directory(&foreign_route, owner.clone(), grant_id.to_owned())
        .unwrap_err();
    assert_eq!(denied, "resource_directory_grant_unavailable");
    let denied: Value = post(
        "/v2/plugin-resources/commit-local-directory",
        json!({"schemaVersion":1,"owner":owner,"grantId":grant_id,"confirmed":true}),
    )
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(
        denied["error"]["code"],
        "resource_directory_grant_unavailable"
    );
    let report = commit(grant_id, true).await.unwrap();
    assert_eq!(
        host.native_checksum_folder_progress(&context, owner.clone(), grant_id)
            .unwrap_err(),
        "resource_directory_grant_unavailable"
    );
    assert_eq!(report["profile"], checksum::PROFILE, "{report}");
    let rows = report["entries"].as_array().unwrap();
    assert_eq!(rows.len(), 64);
    for (index, row) in rows.iter().enumerate() {
        let status = match index {
            1 => "mismatch",
            2 => "missing",
            3 => "read_error",
            _ => "match",
        };
        assert_eq!(row["name"], names[index]);
        assert_eq!(row["status"], status);
        assert_eq!(row["expected"], ABC);
    }
    assert!(!report.to_string().contains("workspace") && report.get("access").is_none());
    let revision = host
        .state
        .plugins
        .lock()
        .unwrap()
        .manual_revision("programming");
    let generated_dir = root.join("generate-selection");
    fs::create_dir_all(&generated_dir).unwrap();
    let generated_dir = generated_dir.canonicalize().unwrap();
    let paths = (0..64)
        .map(|index| {
            let path = generated_dir.join(format!("文件-{index:02}.txt"));
            if index == 0 {
                fs::write(&path, vec![b'A'; 131_073]).unwrap();
            } else {
                fs::write(&path, b"abc").unwrap();
            }
            path
        })
        .collect::<Vec<_>>();
    let prepare_files =
        |selected| host.prepare_native_checksum_files(context.clone(), owner.clone(), selected);
    let mixed = vec![paths[0].clone(), folder.join("entry-0.txt")];
    assert_eq!(
        prepare_files(mixed).await.unwrap_err(),
        "resource_checksum_selection_invalid"
    );
    assert_eq!(
        prepare_files(vec![paths[0].clone(), paths[0].clone()])
            .await
            .unwrap_err(),
        "resource_checksum_manifest_invalid"
    );
    let mut too_many = paths.clone();
    too_many.push(generated_dir.join("65.txt"));
    assert_eq!(
        prepare_files(too_many).await.unwrap_err(),
        "resource_checksum_selection_invalid"
    );
    let generation = prepare_files(paths.clone()).await.unwrap();
    let generation_id = generation["grantId"].as_str().unwrap();
    assert_eq!(generation["read"], false);
    assert_eq!(generation["files"].as_array().unwrap().len(), 64);
    assert!(!generation.to_string().contains("generate-selection"));
    assert_eq!(
        commit(generation_id, false).await.unwrap_err(),
        "resource_confirmation_required"
    );
    fs::write(&paths[0], b"changed before confirmation").unwrap();
    assert_eq!(
        commit(generation_id, true).await.unwrap_err(),
        "resource_checksum_source_changed"
    );
    fs::write(&paths[0], vec![b'A'; 131_073]).unwrap();
    const LARGE: &str = "027834c3408428d92caa105b4da46b5da61005c84c4e49528a396b6afb363503";
    let generation = prepare_files(paths.into_iter().rev().collect())
        .await
        .unwrap();
    let result = commit(generation["grantId"].as_str().unwrap(), true)
        .await
        .unwrap();
    assert_eq!(result["profile"], checksum::GENERATE_PROFILE);
    let generation_files = result["files"].as_array().unwrap();
    assert_eq!(generation_files.len(), 64);
    for (index, file) in generation_files.iter().rev().enumerate() {
        assert_eq!(
            file,
            &json!({
                "name":format!("文件-{index:02}.txt"),
                "sha256":if index == 0 { LARGE } else { ABC }
            })
        );
    }
    let scope = json!({"sceneId":"programming","workspaceId":target.workspace_id,
        "pluginId":MANIFEST,"capabilityId":"devtools.checksum-manifest.generate"});
    let mut request = scope.clone();
    request["catalogRevision"] = json!(revision);
    request["captureResult"] = json!(true);
    request["input"] = json!({"files":generation_files});
    let ticket: Value = post("/v2/plugin-capabilities/prepare-call", request.clone())
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(ticket["callId"].is_string(), "{ticket}");
    request["callId"] = ticket["callId"].clone();
    let generated: Value = post("/v2/plugin-capabilities/invoke", request)
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(generated["result"]["ok"], true, "{generated}");
    let expected = (0..64)
        .map(|index| {
            let hash = if index == 0 { LARGE } else { ABC };
            format!("{hash}  文件-{index:02}.txt\n")
        })
        .collect::<String>();
    assert_eq!(generated["result"]["data"]["text"], expected);
    assert_eq!(generated["resultRef"]["byteLength"], expected.len());
    let source = json!({"scope":scope,"resultId":generated["resultRef"]["resultId"]});
    let metadata = host
        .result_text_export_metadata(&context, source.clone())
        .unwrap();
    assert_eq!(metadata["suggestedFileName"], "SHA256SUMS");
    assert!(metadata["extension"].is_null());
    let destination = generated_dir.join("SHA256SUMS");
    let cancelled = host
        .prepare_result_text_export(context.clone(), source.clone(), destination.clone())
        .unwrap();
    host.cancel_result_text_export(
        context.clone(),
        source.clone(),
        cancelled["grantId"].as_str().unwrap().to_owned(),
    )
    .unwrap();
    assert!(!destination.exists());
    let prepared = host
        .prepare_result_text_export(context.clone(), source.clone(), destination.clone())
        .unwrap();
    let export_id = prepared["grantId"].as_str().unwrap().to_owned();
    assert_eq!(
        host.commit_result_text_export(context.clone(), source.clone(), export_id.clone(), false)
            .unwrap_err(),
        "result_confirmation_required"
    );
    assert!(!destination.exists());
    assert_eq!(
        host.commit_result_text_export(context.clone(), source.clone(), export_id.clone(), true)
            .unwrap()["saved"],
        true
    );
    assert_eq!(
        host.verify_result_text_export(context.clone(), source.clone(), export_id)
            .unwrap()["status"],
        "verified"
    );
    assert_eq!(fs::read(&destination).unwrap(), expected.as_bytes());
    assert_eq!(
        host.prepare_result_text_export(context.clone(), source, destination)
            .unwrap_err(),
        "resource_export_conflict"
    );

    for batch in rows.chunks(16) {
        let text = batch
            .iter()
            .map(|row| format!("{ABC}  {}\n", row["name"].as_str().unwrap()))
            .collect::<String>();
        let files = batch
            .iter()
            .filter(|row| row["actual"].is_string())
            .map(|row| json!({"name":row["name"],"sha256":row["actual"]}))
            .collect::<Vec<_>>();
        let mut request = json!({"sceneId":"programming", "workspaceId":target.workspace_id,
            "pluginId":MANIFEST,"capabilityId":REVIEW,"catalogRevision":revision,"input":{"manifest":text,"files":files}});
        let prepared: Value = post("/v2/plugin-capabilities/prepare-call", request.clone())
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(prepared["callId"].is_string(), "{prepared}");
        request["callId"] = prepared["callId"].clone();
        let response: Value = post("/v2/plugin-capabilities/invoke", request)
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(response["result"]["ok"], true, "{response}");
        let parsed: Value =
            serde_json::from_str(response["result"]["data"]["text"].as_str().unwrap()).unwrap();
        let reviewed = parsed["entries"].as_array().unwrap();
        assert_eq!(reviewed.len(), batch.len());
        for (source, result) in batch.iter().zip(reviewed) {
            assert_eq!(source["name"], result["name"]);
            assert_eq!(source["expected"], result["expected"]);
            assert_eq!(
                result["status"],
                if source["actual"].is_null() {
                    json!("not_provided")
                } else {
                    source["status"].clone()
                }
            );
        }
    }
    assert_eq!(
        commit(grant_id, true).await.unwrap_err(),
        "resource_directory_grant_unavailable"
    );
    let preview = prepare().await.unwrap();
    let grant_id = preview["grantId"].as_str().unwrap();
    let cancelled = host
        .cancel_native_plugin_directory(&context, owner.clone(), grant_id.to_owned())
        .unwrap();
    assert_eq!(cancelled["cancelled"], true, "{cancelled}");
    assert_eq!(
        commit(grant_id, true).await.unwrap_err(),
        "resource_directory_grant_unavailable"
    );
    let preview = prepare().await.unwrap();
    let grant_id = preview["grantId"].as_str().unwrap();
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_permission("programming", FILES, "resource.read", false)
        .unwrap();
    assert_eq!(
        commit(grant_id, true).await.unwrap_err(),
        "resource_plugin_unavailable"
    );
    assert_eq!(fs::read(folder.join("entry-0.txt")).unwrap(), b"abc");
    assert_eq!(fs::read(folder.join("entry-1.txt")).unwrap(), b"modified");
    assert!(!folder.join("entry-2.txt").exists());
}
