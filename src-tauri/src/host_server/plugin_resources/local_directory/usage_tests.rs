//! Exercises the usage snapshot contract with an independent synthetic Worker.
use super::*;
use crate::host_server::{HostMode, HostServer, RemoteAuth};
use crate::native_pi_manager::NativePiManager;
use crate::runtime_coordinator::RuntimeTarget;
use base64::Engine;
use std::fs;

#[tokio::test]
#[ignore = "requires ZICODE_TEST_RESOURCE_WORKER_EXE pointing to the Windows production Worker"]
async fn confirmed_usage_snapshot_reaches_only_its_worker() {
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let scratch = project.join(".cache/task-scratch");
    fs::create_dir_all(&scratch).unwrap();
    let fixture = tempfile::tempdir_in(scratch).unwrap();
    let root = fixture.path().canonicalize().unwrap();
    fs::create_dir_all(root.join("scan/sub")).unwrap();
    fs::write(root.join("scan/sub/large.txt"), b"contents not shared").unwrap();
    fs::write(root.join("scan/small.txt"), b"ok").unwrap();
    fs::create_dir(root.join("public")).unwrap();
    fs::create_dir_all(root.join("package/runtime")).unwrap();
    let mut manifest: Value = serde_json::from_slice(
        &fs::read(project.join("tests/fixtures/devtools-text-dev57/plugin.json")).unwrap(),
    )
    .unwrap();
    manifest["id"] = json!(usage::PLUGIN);
    manifest["name"] = json!("Directory usage snapshot test");
    manifest["runtime"] =
        json!({"wasi":"runtime/tools.wasm","resourceInputProfile":"resource.wasi.input.draft2"});
    manifest["activationEvents"] = json!([format!("onCapability:{}", usage::CAPABILITY)]);
    manifest["contributes"] = json!({"capabilities":[{"id":usage::CAPABILITY,"title":"Directory snapshot fixture","inputSchema":{"type":"object","properties":{},"additionalProperties":false}}]});
    manifest["permissions"] = json!({"required":[],"optional":[
        {"name":"resource.read","reason":"read the confirmed metadata resource"},
        {"name":"resource.directory.read","reason":"test isolation from the single-level grant"},
        {"name":usage::PERMISSION,"reason":"read the confirmed directory usage metadata"}
    ]});
    fs::write(
        root.join("package/plugin.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    // This test module returns exactly the supplied metadata bytes. It is a
    // conformance fixture, with no filesystem API and no production analyzer.
    fs::write(root.join("package/runtime/tools.wasm"), r#"(module
       (import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32)))
       (import "zicode_resource_input_draft1" "size" (func $size (param i32) (result i64)))
       (import "zicode_resource_input_draft1" "read" (func $read (param i32 i64 i32 i32) (result i32)))
       (memory (export "memory") 1)
       (func (export "_start") (local $length i32)
            i32.const 0 call $size i32.wrap_i64 local.set $length
            local.get $length i32.const 8192 i32.gt_u if unreachable end
            i32.const 0 i64.const 0 i32.const 256 local.get $length call $read
            local.get $length i32.ne if unreachable end
            i32.const 0 i32.const 256 i32.store
            i32.const 4 local.get $length i32.store
            i32.const 1 i32.const 0 i32.const 1 i32.const 8 call $write drop))"#).unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start_with_mode(
        root.join("public"),
        NativePiManager::new(16),
        auth,
        HashMap::new(),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    let target = RuntimeTarget::new(
        "2d22f30c-7a2d-4af1-8cd4-aadf063cc80d",
        "usage-contract-session",
        "usage-contract-runtime",
    );
    host.start_tool_session(target.clone()).unwrap();
    host.state
        .data
        .workspace_roots()
        .write()
        .unwrap()
        .insert(target.workspace_id.clone(), root.clone());
    *host
        .state
        .plugin_resource_workers
        .executable
        .lock()
        .unwrap() = Some(
        std::env::var_os("ZICODE_TEST_RESOURCE_WORKER_EXE")
            .unwrap()
            .into(),
    );
    {
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(
            registry.install_developer(&root.join("package")).unwrap(),
            usage::PLUGIN
        );
        registry
            .set_enabled("programming", usage::PLUGIN, true)
            .unwrap();
        for permission in ["resource.read", "resource.directory.read"] {
            registry
                .set_permission("programming", usage::PLUGIN, permission, true)
                .unwrap();
        }
    }
    let grant_usage = |allowed| {
        host.state
            .plugins
            .lock()
            .unwrap()
            .set_permission("programming", usage::PLUGIN, usage::PERMISSION, allowed)
            .unwrap()
    };
    let owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":usage::PLUGIN,"capabilityId":usage::CAPABILITY});
    let prepare =
        json!({"schemaVersion":1,"owner":owner,"relativePath":"scan","profile":usage::PROFILE});
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let post = |operation: &str, body: Value| {
        client
            .post(format!("{}/v2/plugin-resources/{operation}", host.origin()))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&body)
            .send()
    };
    let request = |preview: &Value, confirmed| {
        json!({
            "schemaVersion":1,"owner":owner,"grantId":preview["grantId"],"confirmed":confirmed
        })
    };

    let denied: Value = post("prepare-local-directory", prepare.clone())
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(denied["error"]["code"], "permission_denied");
    grant_usage(true);
    let mut outside = prepare.clone();
    outside["relativePath"] = json!("../other");
    assert!(!post("prepare-local-directory", outside)
        .await
        .unwrap()
        .status()
        .is_success());
    let preview: Value = post("prepare-local-directory", prepare.clone())
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(preview["profile"], usage::PROFILE, "{preview}");
    assert_eq!(preview["entryNamesRead"], false);
    assert!(!preview.to_string().contains("small.txt"));
    let unconfirmed: Value = post("commit-local-directory", request(&preview, false))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        unconfirmed["error"]["code"],
        "resource_confirmation_required"
    );
    let cancelled: Value = post("cancel-local-directory", request(&preview, false))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(cancelled["cancelled"], true);
    assert!(!post("commit-local-directory", request(&preview, true))
        .await
        .unwrap()
        .status()
        .is_success());

    let preview: Value = post("prepare-local-directory", prepare.clone())
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let resource: Value = post("commit-local-directory", request(&preview, true))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(resource["profile"], usage::PROFILE, "{resource}");
    assert_eq!(resource["entryCount"], 3);
    assert_eq!(resource["partial"], false);
    assert!(!post("commit-local-directory", request(&preview, true))
        .await
        .unwrap()
        .status()
        .is_success());
    let access = &resource["access"];
    let read = json!({"access":access,"offset":0,"length":4096});
    let blob: Value = post("read-view", read.clone())
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(blob["dataBase64"].as_str().unwrap())
        .unwrap();
    let payload: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        payload["entries"],
        json!([
           {"kind":"file","path":"small.txt","logicalBytes":"2"},
           {"kind":"directory","path":"sub"},
           {"kind":"file","path":"sub/large.txt","logicalBytes":"19"}
        ])
    );
    assert!(!payload.to_string().contains("contents not shared"));
    assert!(!payload.to_string().contains(root.to_str().unwrap()));
    let invoke = json!({"access":access,"toolCallId":uuid::Uuid::new_v4(),"input":{}});
    let observed: Value = post("invoke-view", invoke)
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(observed["result"], payload, "{observed}");

    let pending: Value = post("prepare-local-directory", prepare)
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    grant_usage(false);
    assert!(!post("commit-local-directory", request(&pending, true))
        .await
        .unwrap()
        .status()
        .is_success());
    assert!(!post("read-view", read).await.unwrap().status().is_success());
    host.stop_and_wait().await.unwrap();
}
