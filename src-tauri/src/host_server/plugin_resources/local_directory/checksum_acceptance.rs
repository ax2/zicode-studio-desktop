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
    let folder = root.join("workspace/folder");
    let public = root.join("public");
    fs::create_dir_all(&folder).unwrap();
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
        .insert(target.workspace_id.clone(), root.join("workspace"));
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
    let prepare = || {
        post(
            "/v2/plugin-resources/prepare-local-directory",
            json!({"schemaVersion":1,"owner":owner,"relativePath":"folder","checksumManifest":manifest}),
        )
    };
    let commit = |grant: &Value, confirmed: bool| {
        post(
            "/v2/plugin-resources/commit-local-directory",
            json!({"schemaVersion":1,"owner":owner,"grantId":grant,"confirmed":confirmed}),
        )
    };
    let preview: Value = prepare().await.unwrap().json().await.unwrap();
    assert_eq!(preview["profile"], checksum::PROFILE, "{preview}");
    assert_eq!(preview["entryNamesRead"], false);
    assert!(preview.get("entries").is_none());
    assert_eq!(
        commit(&preview["grantId"], false)
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_confirmation_required"
    );
    let report: Value = commit(&preview["grantId"], true)
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
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
        commit(&preview["grantId"], true)
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_directory_grant_unavailable"
    );
    let preview: Value = prepare().await.unwrap().json().await.unwrap();
    let cancelled: Value = post(
        "/v2/plugin-resources/cancel-local-directory",
        json!({"schemaVersion":1,"owner":owner,"grantId":preview["grantId"]}),
    )
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(cancelled["cancelled"], true, "{cancelled}");
    assert_eq!(
        commit(&preview["grantId"], true)
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_directory_grant_unavailable"
    );
    let preview: Value = prepare().await.unwrap().json().await.unwrap();
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_permission("programming", FILES, "resource.read", false)
        .unwrap();
    let rejected: Value = commit(&preview["grantId"], true)
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        rejected["error"]["code"], "resource_plugin_unavailable",
        "{rejected}"
    );
    assert_eq!(fs::read(folder.join("entry-0.txt")).unwrap(), b"abc");
    assert_eq!(fs::read(folder.join("entry-1.txt")).unwrap(), b"modified");
    assert!(!folder.join("entry-2.txt").exists());
}
