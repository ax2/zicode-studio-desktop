//! Frozen JSON file provider through the HTTP Host and production Worker.
use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};

const PLUGIN: &str = crate::plugin_resource_execution::json_transform::PLUGIN;
const MAX_FILE: usize = crate::plugin_resource_execution::json_transform::MAX_FILE;
const PATH: &str = "devtools.json-file.format";
const ORDERED: &str = "devtools.json-file.minify";
const UNORDERED: &str = "devtools.json-file.validate";

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires immutable JSON file provider package and current Windows Studio Worker"]
async fn json_file_transform_frozen_host_http_and_explicit_export() {
    let package = PathBuf::from(std::env::var_os("ZICODE_TEST_JSON_FORMAT_PACKAGE").unwrap());
    let receipt_path = package.with_file_name(format!(
        "{}-verification.json",
        package.file_name().unwrap().to_string_lossy()
    ));
    let receipt: Value = serde_json::from_slice(&std::fs::read(receipt_path).unwrap()).unwrap();
    for entry in receipt["files"].as_array().unwrap() {
        let bytes = std::fs::read(package.join(entry["path"].as_str().unwrap())).unwrap();
        assert_eq!(entry["size"], bytes.len());
        assert_eq!(entry["sha256"], sha256_hex(&bytes));
    }
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_RESOURCE_WORKER_EXE").unwrap());
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    std::fs::create_dir_all(&scratch).unwrap();
    let scratch = scratch.canonicalize().unwrap();
    let root = scratch.join(format!("json-file-http-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    std::fs::write(
        root.join("owner.json"),
        br#"{"purpose":"isolated JSON file test","lifetime":"remove on success"}"#,
    )
    .unwrap();
    let workspace = root.join("workspace");
    std::fs::create_dir(&workspace).unwrap();
    std::fs::create_dir(root.join("public")).unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    let issued = RuntimeTarget::new(
        "ffffeeee-dddd-4ddd-8ddd-eeeeffffffff",
        "json-file-test",
        "json-file-instance",
    );
    let runtime = runtimes.register_in_memory(issued.clone()).unwrap();
    let host = HostServer::start_with_mode(
        root.join("public"),
        runtimes,
        auth,
        HashMap::new(),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    host.state.plugin_tokens.lock().unwrap().insert(
        issued.instance_id.clone(),
        RuntimePluginToken {
            token_hash: sha256_hex(b"generated-json-file-test-only-token"),
            target: issued.clone(),
            expires_at: SystemTime::now() + PLUGIN_BROKER_TOKEN_TTL,
        },
    );
    let target = host
        .state
        .runtimes
        .bind_session_id(&issued, "json-file-session")
        .unwrap();
    host.state
        .data
        .workspace_roots()
        .write()
        .unwrap()
        .insert(target.workspace_id.clone(), workspace.clone());
    {
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(registry.install_developer(&package).unwrap(), PLUGIN);
        registry
            .set_permission("programming", PLUGIN, "resource.read", true)
            .unwrap();
        registry.set_enabled("programming", PLUGIN, true).unwrap();
        let catalog = registry
            .manual_catalog(&crate::plugin_registry::manual_catalog::CatalogQuery {
                scene_id: "programming".into(),
                plugin_id: Some(PLUGIN.into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(catalog["total"], 3, "{catalog}");
        for capability in [PATH, ORDERED, UNORDERED] {
            let detail = registry
                .manual_tool_detail(&crate::plugin_registry::manual_catalog::DetailQuery {
                    scene_id: "programming".into(),
                    plugin_id: PLUGIN.into(),
                    capability_id: capability.into(),
                    revision: registry.manual_revision("programming"),
                    resource_mime_type: None,
                })
                .unwrap();
            assert_eq!(detail["enabled"], true);
            assert_eq!(detail["resourceInputProfile"], "resource.wasi.input.draft2");
        }
    }
    *host
        .state
        .plugin_resource_workers
        .executable
        .lock()
        .unwrap() = Some(executable);
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let owner = |capability| {
        json!({"runtimeId":target.instance_id,"sessionId":target.session_id,
        "pluginId":PLUGIN,"capabilityId":capability})
    };
    let request = |route, body| output_http::post(&host, &client, route, body);

    for (capability, input, expected) in [
        (
            PATH,
            br#"{"b":2,"a":[1,true,null]}"#.as_slice(),
            b"{\n  \"a\": [\n    1,\n    true,\n    null\n  ],\n  \"b\": 2\n}".as_slice(),
        ),
        (
            ORDERED,
            br#"{ "b":2, "a": [1,true,null] }"#.as_slice(),
            br#"{"a":[1,true,null],"b":2}"#.as_slice(),
        ),
        (
            UNORDERED,
            br#"{"a":true}"#.as_slice(),
            br#"{"valid":true}"#.as_slice(),
        ),
    ] {
        let owner = owner(capability);
        let access = output_http::material(&host, &client, &owner, input).await;
        let before = host.state.plugin_resources.lock().unwrap().record_count();
        let (status, result) = invoke(&host, &client, &access, &[], json!({})).await;
        assert_eq!(status, StatusCode::OK, "{result}");
        assert_eq!(result["result"]["sourceByteCounts"], json!([input.len()]));
        let output = &result["resources"][0];
        assert_eq!(output["mimeType"], "application/json");
        assert_eq!(output["contentVersion"], sha256_hex(expected));
        assert_eq!(output["derivedFrom"]["resourceId"], access["resourceId"]);
        assert_eq!(
            host.state.plugin_resources.lock().unwrap().record_count(),
            before + 1
        );
        let derived = json!({"schemaVersion":1,"owner":owner,"resourceId":output["resourceId"],"contentVersion":output["contentVersion"]});
        let (status, preview) =
            response(request("prepare-save", json!({"schemaVersion":1,"source":derived})).await)
                .await;
        assert_eq!(status, StatusCode::OK, "{preview}");
        let path = workspace.join(preview["preview"]["relativePath"].as_str().unwrap());
        assert!(!path.exists());
        let mut confirmation = json!({"schemaVersion":1,"source":derived,"grantId":preview["grantId"],"confirmed":false});
        assert!(
            !request("commit-save", confirmation.clone())
                .await
                .status()
                .is_success()
        );
        assert!(!path.exists());
        confirmation["confirmed"] = json!(true);
        let (status, saved) = response(request("commit-save", confirmation.clone()).await).await;
        assert_eq!(status, StatusCode::OK, "{saved}");
        assert_eq!(std::fs::read(&path).unwrap(), expected);
        let (status, replay) = response(request("commit-save", confirmation).await).await;
        assert_eq!(status, StatusCode::OK, "{replay}");
        assert_eq!(replay["replayed"], true);
        assert_eq!(replay["receipt"], saved["receipt"]);
        // Unconfirmed save cannot alter the source or create another output.
        assert_eq!(std::fs::read(&path).unwrap(), expected);
    }
    let fixtures = PathBuf::from(std::env::var_os("ZICODE_TEST_JSON_FORMAT_BOUNDARY").unwrap());
    let input = std::fs::read(fixtures.join("input.json")).unwrap();
    let expected = std::fs::read(fixtures.join("expected.json")).unwrap();
    assert_eq!(expected.len(), 8 * MAX_FILE);
    assert_eq!(
        sha256_hex(&expected),
        "6ee3a2a4f06c8f086f6533bcf6dc77757179b048bfdb7e3b400f93761238602e"
    );
    let boundary_owner = owner(PATH);
    let access = output_http::material(&host, &client, &boundary_owner, &input).await;
    let (status, result) = invoke(&host, &client, &access, &[], json!({})).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    let output = &result["resources"][0];
    assert_eq!(output["byteLength"], expected.len());
    assert_eq!(output["contentVersion"], sha256_hex(&expected));
    let derived = json!({"schemaVersion":1,"owner":boundary_owner,"resourceId":output["resourceId"],"contentVersion":output["contentVersion"]});
    let (status, preview) =
        response(request("prepare-save", json!({"schemaVersion":1,"source":derived})).await).await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    let path = workspace.join(preview["preview"]["relativePath"].as_str().unwrap());
    assert!(!path.exists());
    let (status, saved) = response(request("commit-save", json!({"schemaVersion":1,"source":derived,"grantId":preview["grantId"],"confirmed":true})).await).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(std::fs::read(&path).unwrap(), expected);
    assert_eq!(std::fs::read(fixtures.join("input.json")).unwrap(), input);
    let safe_owner = owner(ORDERED);
    let sample = format!("\"{}\"", "x".repeat(MAX_FILE - 2));
    let access = output_http::material(&host, &client, &safe_owner, sample.as_bytes()).await;
    let (status, result) = invoke(&host, &client, &access, &[], json!({})).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["resources"][0]["byteLength"], MAX_FILE);
    assert_eq!(
        result["resources"][0]["contentVersion"],
        sha256_hex(sample.as_bytes())
    );
    let original = request("read-view", json!({"access":access,"offset":0,"length":16}))
        .await
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(
        STANDARD
            .decode(original["dataBase64"].as_str().unwrap())
            .unwrap(),
        &sample.as_bytes()[..16]
    );
    for (source, expected_error) in [
        (b"{".as_slice(), "INVALID_JSON"),
        (br#"{"x":1,"\u0078":2}"#, "JSON_POLICY_REJECTED"),
        (b"9007199254740992", "JSON_POLICY_REJECTED"),
        (b"18446744073709551616", "JSON_POLICY_REJECTED"),
        (b"0.123456789012345678901234567890", "JSON_POLICY_REJECTED"),
        (b"0 0", "INVALID_JSON"),
    ] {
        let access = output_http::material(&host, &client, &safe_owner, source).await;
        let before = host.state.plugin_resources.lock().unwrap().record_count();
        let (status, result) = invoke(&host, &client, &access, &[], json!({})).await;
        assert_eq!(status, StatusCode::OK, "{result}");
        assert_eq!(result["result"]["error"]["code"], expected_error);
        assert!(
            !result["result"]["error"]["message"]
                .as_str()
                .unwrap()
                .is_empty()
        );
        assert!(
            result["resources"].is_null()
                || result["resources"].as_array().is_some_and(Vec::is_empty)
        );
        assert_eq!(
            host.state.plugin_resources.lock().unwrap().record_count(),
            before
        );
    }
    let oversized =
        output_http::material(&host, &client, &safe_owner, &vec![b' '; MAX_FILE + 1]).await;
    let (status, result) = invoke(&host, &client, &oversized, &[], json!({})).await;
    assert_ne!(status, StatusCode::OK);
    assert_eq!(result["error"]["code"], "resource_input_too_large");
    let mismatched = owner(PATH);
    let access = output_http::material(&host, &client, &mismatched, b"0").await;
    let (status, _) = invoke(
        &host,
        &client,
        &access,
        std::slice::from_ref(&access),
        json!({}),
    )
    .await;
    assert_ne!(status, StatusCode::OK);
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry
            .set_permission("programming", PLUGIN, "resource.read", false)
            .unwrap();
    }
    assert!(
        !request("read-view", json!({"access":access,"offset":0,"length":1}))
            .await
            .status()
            .is_success()
    );
    eprintln!(
        "JSON transform Host: all3 capabilities installed, authorised, executed, exact export, negative confirmation and replay; 1MiB input, unchanged original, malformed/duplicate/unsafe/oversize/extra input/revoked access refused"
    );
    drop(runtime);
    host.stop_and_wait().await.unwrap();
    let root = root.canonicalize().unwrap();
    assert_eq!(root.parent(), Some(scratch.as_path()));
    std::fs::remove_dir_all(root).unwrap();
}

async fn response(result: reqwest::Response) -> (StatusCode, Value) {
    (result.status(), result.json().await.unwrap())
}

async fn invoke(
    host: &HostServer,
    client: &reqwest::Client,
    access: &Value,
    additional: &[Value],
    input: Value,
) -> (StatusCode, Value) {
    let (status, ticket) = response(output_http::post(host, client, "prepare-call",
        json!({"schemaVersion":1,"access":access,"additionalAccesses":additional,"input":input})).await).await;
    if status != StatusCode::OK {
        return (status, ticket);
    }
    response(
        output_http::post(
            host,
            client,
            "invoke-call",
            json!({"access":access,"additionalAccesses":additional,"callId":ticket["callId"],
               "hostInstanceId":ticket["hostInstanceId"],"input":input}),
        )
        .await,
    )
    .await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires the current Windows production Worker"]
async fn reviewed_local_plugin_activation_uses_frozen_json_tool_and_preserves_state() {
    let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures");
    let package = fixtures.join("devtools-json-file-0.1.0-candidate-91");
    let receipt: Value = serde_json::from_slice(
        &std::fs::read(fixtures.join("devtools-json-file-0.1.0-candidate-91-verification.json"))
            .unwrap(),
    )
    .unwrap();
    for entry in receipt["files"].as_array().unwrap() {
        let bytes = std::fs::read(package.join(entry["path"].as_str().unwrap())).unwrap();
        assert_eq!(entry["size"], bytes.len());
        assert_eq!(entry["sha256"], sha256_hex(&bytes));
    }

    let root = tempfile::tempdir().unwrap();
    let workspace = root.path().join("workspace");
    let public = root.path().join("public");
    std::fs::create_dir(&workspace).unwrap();
    std::fs::create_dir(&public).unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.path().join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    let issued = RuntimeTarget::new(
        "ffffeeee-dddd-4ddd-8ddd-eeeeffffffff",
        "plugin-activation",
        "activation-instance",
    );
    let _runtime = runtimes.register_in_memory(issued.clone()).unwrap();
    let host = HostServer::start_with_mode(
        public,
        runtimes,
        auth,
        HashMap::new(),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    host.state.plugin_tokens.lock().unwrap().insert(
        issued.instance_id.clone(),
        RuntimePluginToken {
            token_hash: sha256_hex(b"generated-plugin-activation-test-token"),
            target: issued.clone(),
            expires_at: SystemTime::now() + PLUGIN_BROKER_TOKEN_TTL,
        },
    );
    let target = host
        .state
        .runtimes
        .bind_session_id(&issued, "activation-session")
        .unwrap();
    host.state
        .data
        .workspace_roots()
        .write()
        .unwrap()
        .insert(target.workspace_id.clone(), workspace);
    *host
        .state
        .plugin_resource_workers
        .executable
        .lock()
        .unwrap() = Some(PathBuf::from(
        std::env::var_os("ZICODE_TEST_RESOURCE_WORKER_EXE").unwrap(),
    ));

    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let post = |route: &str, body: Value, authenticated: bool| {
        let request = client.post(format!("{}{route}", host.origin())).json(&body);
        if authenticated {
            request.header("x-zicode-desktop-token", host.desktop_token())
        } else {
            request
        }
        .send()
    };
    let get = |route: &str, query: &[(&str, &str)]| {
        client
            .get(format!("{}{route}", host.origin()))
            .header("x-zicode-desktop-token", host.desktop_token())
            .query(query)
            .send()
    };
    let installed = async |id: &str| -> Value {
        let response: Value = get(
            "/v2/plugins",
            &[("sceneId", "programming"), ("summary", "true")],
        )
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
        response["plugins"]
            .as_array()
            .unwrap()
            .iter()
            .find(|plugin| plugin["id"] == id)
            .unwrap()
            .clone()
    };
    let directory = async || -> Value {
        get(
            "/v2/plugin-tool-directory",
            &[("sceneId", "programming"), ("pluginId", PLUGIN)],
        )
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap()
    };
    let activation = "/v2/plugins/activate-reviewed";
    let approve = |id: &str, plugin: &Value, grants: &[&str]| {
        json!({
            "sceneId": "programming", "pluginId": id, "review": plugin["activationReview"], "grants": grants,
        })
    };

    let preview = host.preview_developer_plugin(&package).unwrap();
    assert_eq!(preview.plugin_id, PLUGIN);
    let install = host
        .install_previewed_developer_plugin(&package, &preview.content_sha256)
        .unwrap();
    let waiting = installed(PLUGIN).await;
    assert_eq!(
        waiting["activationReview"]["packageRevision"],
        install.package_revision.to_string()
    );
    assert_eq!(waiting["enabled"], false);
    assert_eq!(waiting["permissionGrants"]["resource.read"], false);
    assert!(directory().await["items"]
        .as_array()
        .unwrap()
        .iter()
        .all(|item| item["enabled"] != true));

    let consent = approve(PLUGIN, &waiting, &["resource.read"]);
    assert_eq!(
        post(activation, consent.clone(), false)
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let mut wrong_scope = consent.clone();
    wrong_scope["sceneId"] = json!("other-scene");
    for denied in [
        wrong_scope,
        approve(PLUGIN, &waiting, &[]),
        approve(PLUGIN, &waiting, &["resource.read", "undeclared"]),
    ] {
        assert_eq!(
            post(activation, denied, true).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(installed(PLUGIN).await, waiting);
    }

    let state_file = root.path().join("test-plugin-registry/registry.json");
    // Force the actual atomic replace to fail in this test registry.
    assert!(!state_file.exists());
    std::fs::create_dir(&state_file).unwrap();
    assert_eq!(
        post(activation, consent.clone(), true)
            .await
            .unwrap()
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(installed(PLUGIN).await, waiting);
    std::fs::remove_dir(&state_file).unwrap();

    assert!(post(activation, consent.clone(), true)
        .await
        .unwrap()
        .status()
        .is_success());
    assert_eq!(
        post(activation, consent, true).await.unwrap().status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let enabled = installed(PLUGIN).await;
    assert_eq!(enabled["enabled"], true);
    assert_eq!(enabled["permissionGrants"], json!({"resource.read":true}));
    let catalog = directory().await;
    assert_eq!(catalog["total"], 3, "{catalog}");
    assert!(catalog["items"]
        .as_array()
        .unwrap()
        .iter()
        .all(|item| item["enabled"] == true));
    let detail = get(
        "/v2/plugin-tool-directory/detail",
        &[
            ("sceneId", "programming"),
            ("pluginId", PLUGIN),
            ("capabilityId", PATH),
            ("revision", catalog["revision"].as_str().unwrap()),
        ],
    )
    .await
    .unwrap()
    .error_for_status()
    .unwrap()
    .json::<Value>()
    .await
    .unwrap();
    assert_eq!(detail["enabled"], true);

    let owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,
        "pluginId":PLUGIN,"capabilityId":PATH});
    let access = output_http::material(&host, &client, &owner, br#"{"b":2,"a":1}"#).await;
    let (status, result) = invoke(&host, &client, &access, &[], json!({})).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(
        result["resources"][0]["contentVersion"],
        sha256_hex(b"{\n  \"a\": 1,\n  \"b\": 2\n}")
    );

    let before_reinstall = std::fs::read(&state_file).unwrap();
    assert!(host
        .install_previewed_developer_plugin(&package, &"0".repeat(64))
        .is_err());
    assert_eq!(installed(PLUGIN).await, enabled);
    let reinstalled = host
        .install_previewed_developer_plugin(&package, &preview.content_sha256)
        .unwrap();
    assert_ne!(reinstalled.package_revision, install.package_revision);
    assert_eq!(std::fs::read(&state_file).unwrap(), before_reinstall);
    assert_eq!(installed(PLUGIN).await["enabled"], true);

    assert!(post("/v2/plugins/permission", json!({
        "sceneId":"programming", "pluginId":PLUGIN, "permission":"resource.read", "granted":false,
    }), true).await.unwrap().status().is_success());
    assert!(directory().await["items"]
        .as_array()
        .unwrap()
        .iter()
        .all(|item| item["enabled"] != true));
    let revoked = installed(PLUGIN).await;
    assert_eq!(revoked["enabled"], false);
    assert_eq!(revoked["permissionGrants"]["resource.read"], false);
    assert_eq!(
        post(
            activation,
            approve(PLUGIN, &enabled, &["resource.read"]),
            true
        )
        .await
        .unwrap()
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert!(post(
        activation,
        approve(PLUGIN, &revoked, &["resource.read"]),
        true
    )
    .await
    .unwrap()
    .status()
    .is_success());

    let free_package = root.path().join("permission-free");
    std::fs::create_dir(&free_package).unwrap();
    let free = "com.zicode.activation-no-permission";
    std::fs::write(
        free_package.join("plugin.json"),
        serde_json::to_vec(&json!({
            "schemaVersion":1, "id":free, "name":"Permission-free", "description":"Local test",
            "version":"1.0.0", "publisher":"test",
        }))
        .unwrap(),
    )
    .unwrap();
    let preview = host.preview_developer_plugin(&free_package).unwrap();
    assert!(preview.permissions.is_empty());
    host.install_previewed_developer_plugin(&free_package, &preview.content_sha256)
        .unwrap();
    let disabled = installed(free).await;
    assert_eq!(disabled["enabled"], false);
    assert!(post(activation, approve(free, &disabled, &[]), true)
        .await
        .unwrap()
        .status()
        .is_success());
    let enabled = installed(free).await;
    assert_eq!(enabled["enabled"], true);
    assert_eq!(enabled["permissionGrants"], json!({}));

    let persisted =
        crate::plugin_registry::PluginRegistry::open(root.path().join("test-plugin-registry"))
            .unwrap();
    assert!(persisted
        .list("programming")
        .iter()
        .filter(|plugin| [PLUGIN, free].contains(&plugin.manifest.id.as_str()))
        .all(|plugin| plugin.enabled));
    host.stop();
}
